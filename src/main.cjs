const { app, BrowserWindow, ipcMain, clipboard, globalShortcut, Menu, Tray, nativeImage,
    safeStorage, screen, systemPreferences, shell, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { translate } = require('./translation.cjs');
const { SettingsStore, validateSettings } = require('./settings.cjs');
const { saveShortcuts, defaultShortcuts } = require('./shortcuts.cjs');
const { ScreenCapture } = require('./screen-capture.cjs');
const { selectedText, Speech, loginItemState, setLoginItem } = require('./native.cjs');

const smoke = process.argv.includes('--smoke-test');
if (smoke) app.setPath('userData', path.join(require('node:os').tmpdir(), `lingo-smoke-${process.pid}`));
const page = pathToFileURL(path.join(__dirname, 'index.html')).href;
let window, tray, store, captureSession, ocrWorker, ocrPromise;
let currentRequest, quitting = false, selecting = false, ready = false;
let ocrBusy = false;
let pendingAction = null;
let settingsQueue = Promise.resolve();
const startupMessages = [];
const speech = new Speech();
let activeShortcuts = {};
let layout = { preferences: false, height: 360 };
const shortcutActions = {
    input: () => show({ type: 'focus' }), selection,
    clipboard: translateClipboard, capture,
};

function fitWindow() {
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(layout.preferences ? 620 : 500, area.width);
    const height = Math.min(layout.preferences ? 720 : Math.max(300, Math.ceil(layout.height)), area.height);
    const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - height));
    if (bounds.width !== width || bounds.height !== height || bounds.x !== x || bounds.y !== y) {
        window.setBounds({ x, y, width, height });
    }
}

function send(channel, payload) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
}

function show(action) {
    if (action?.type === 'text' && !action.text.trim()) return;
    fitWindow();
    window.show();
    if (process.platform === 'darwin') app.focus({ steal: true });
    window.focus();
    if (action) {
        if (ready) send('action', action);
        else pendingAction = action;
    }
}

function trusted(event) {
    const expected = window;
    if (!expected || event.sender !== expected.webContents || event.senderFrame !== expected.webContents.mainFrame ||
        event.senderFrame.url !== page) throw new Error('Unauthorized IPC sender');
}

function handle(name, callback) {
    ipcMain.handle(name, async (event, ...args) => {
        trusted(event);
        try { return { ok: true, value: await callback(...args) }; }
        catch (error) { return { ok: false, error: error.message || '操作失败，请重试。' }; }
    });
}

function cancelTranslation() {
    currentRequest?.abort();
    currentRequest = null;
}

async function translateClipboard() {
    try { show({ type: 'text', text: await clipboard.readText() }); }
    catch (error) { show({ type: 'error', text: error.message }); }
}

async function selection() {
    if (selecting || captureSession.active) return;
    selecting = true;
    try {
        const text = await selectedText(clipboard, process.platform, systemPreferences);
        show({ type: 'text', text });
    } catch (error) { show({ type: 'error', text: error.message }); }
    finally { selecting = false; }
}

async function worker() {
    if (!ocrPromise) {
        const { createOCR } = require('./ocr.cjs');
        const langPath = app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : path.join(__dirname, '..', 'resources', 'tessdata');
        ocrPromise = createOCR(langPath, status => send('ocr-progress', { progress: status.progress || 0, status: status.status }))
            .then(value => { ocrWorker = value; return value; }).catch(error => { ocrPromise = null; throw error; });
    }
    return ocrPromise;
}

async function capture() {
    if (captureSession.active || selecting || ocrBusy) return;
    speech.stop();
    cancelTranslation();
    window.hide();
    await captureSession.start();
}

async function recognizeCapture(buffer) {
    ocrBusy = true;
    send('action', { type: 'ocr-start' });
    try {
        const engine = await worker();
        const result = await engine.recognize(buffer);
        const text = result.data.text.trim();
        if (!text) { send('action', { type: 'ocr-empty' }); return; }
        show({ type: 'ocr-text', text });
    } catch { show({ type: 'ocr-error', text: 'OCR 识别失败，请重新截图或重启应用后重试。' }); }
    finally { ocrBusy = false; }
}

let lastDockChange = 0;
async function applyDockPreference() {
    if (process.platform !== 'darwin') return;
    if (store.preferences.showDockIcon) {
        if (!app.dock.isVisible()) {
            await app.dock.show();
            lastDockChange = Date.now();
        }
    }
    else if (app.dock.isVisible()) {
        // macOS may ignore hiding during a recent Dock visibility transition.
        const delay = Math.max(0, 1100 - (Date.now() - lastDockChange));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        app.dock.hide();
        lastDockChange = Date.now();
    }
}

function publicPreferences() {
    const login = loginItemState(app);
    return { ...store.publicSettings(), ...(login.supported ? { startAtLogin: Boolean(login.enabled), loginItemMessage: login.message } : {}) };
}

async function savePreferences(input) {
    const next = validateSettings(input);
    const previous = loginItemState(app);
    const changed = next.startAtLogin !== Boolean(previous.enabled);
    try {
        if (changed) setLoginItem(app, next.startAtLogin);
        await store.save(input);
    } catch (error) {
        if (changed && previous.supported) {
            try { setLoginItem(app, Boolean(previous.enabled)); }
            catch { throw new Error(`${error.message} 开机启动状态恢复失败，请检查系统登录项。`); }
        }
        throw error;
    }
    return publicPreferences();
}

function setupIPC() {
    handle('settings:get', () => ({ settings: publicPreferences(), platform: process.platform, loginItemSupported: loginItemState(app).supported, defaultShortcuts, messages: startupMessages }));
    handle('settings:save', input => {
        const task = settingsQueue.then(async () => {
            const next = validateSettings(input).shortcuts;
            if (smoke || JSON.stringify(next) === JSON.stringify(store.preferences.shortcuts)) {
                const saved = await savePreferences(input);
                await applyDockPreference();
                return saved;
            }
            const previous = Object.fromEntries(Object.entries(activeShortcuts).filter(([, key]) => globalShortcut.isRegistered(key)));
            const saved = await saveShortcuts(globalShortcut, shortcutActions, previous, next, () => savePreferences(input));
            activeShortcuts = next;
            await applyDockPreference();
            return saved;
        });
        settingsQueue = task.catch(() => {});
        return task;
    });
    handle('window:layout', input => {
        if (!input || typeof input.preferences !== 'boolean' || !Number.isFinite(input.height) || input.height < 0 || input.height > 10000) {
            throw new Error('窗口尺寸无效。');
        }
        layout = input;
        fitWindow();
    });
    handle('window:hide', () => window.hide());
    handle('pronunciation', request => require('./pronunciation.cjs').pronunciation(request));
    handle('voices', () => speech.voices());
    handle('speech:speak', input => speech.speak(input));
    handle('speech:stop', () => speech.stop());
    handle('clipboard:read', () => clipboard.readText());
    handle('clipboard:write', text => {
        if (typeof text !== 'string' || text.length > 20000) throw new Error('复制内容无效。');
        return clipboard.writeText(text);
    });
    handle('translate:cancel', cancelTranslation);
    handle('translate', async request => {
        cancelTranslation();
        const controller = new AbortController();
        currentRequest = controller;
        const timer = setTimeout(() => controller.abort('timeout'), 20000);
        try {
            return await translate(request, store.credentials, controller.signal);
        } catch (error) {
            if (controller.signal.aborted) throw new Error(controller.signal.reason === 'timeout' ? '翻译超时，请检查网络后重试。' : '翻译已取消。');
            throw error;
        } finally {
            clearTimeout(timer);
            if (currentRequest === controller) currentRequest = null;
        }
    });
    handle('capture:start', capture);
    handle('ready', () => {
        ready = true;
        if (pendingAction) { send('action', pendingAction); pendingAction = null; }
    });
    handle('external', kind => {
        const urls = { baidu: 'https://api.fanyi.baidu.com/', google: 'https://console.cloud.google.com/apis/library/translate.googleapis.com' };
        if (!urls[kind]) throw new Error('链接无效。');
        return shell.openExternal(urls[kind]);
    });

}

if (!app.requestSingleInstanceLock()) app.quit();
else {
    app.on('second-instance', () => { if (window) show(); });
    app.whenReady().then(async () => {
        store = new SettingsStore(app.getPath('userData'), safeStorage);
        try { await store.load(); } catch (error) { startupMessages.push(error.message); }
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        setupIPC();
        captureSession = new ScreenCapture({ onCancel: () => {}, onImage: recognizeCapture, onError: text => show({ type: 'error', text }) });
        window = new BrowserWindow({ width: 500, height: 360, frame: false, resizable: false, maximizable: false, fullscreenable: false,
            icon: path.join(__dirname, 'icon.png'),
            title: 'Lingo', backgroundColor: '#ffffff', show: false,
            webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', event => event.preventDefault());
        window.on('blur', () => window.hide());
        screen.on('display-metrics-changed', fitWindow);
        screen.on('display-removed', fitWindow);
        window.on('close', event => {
            speech.stop();
            if (!quitting) { event.preventDefault(); window.hide(); }
        });
        const menu = [
            ...(process.platform === 'darwin' ? [{ label: 'Lingo', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
            { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
            { label: '窗口', submenu: [{ label: '显示翻译窗口', click: () => show() }, { label: '设置', accelerator: 'CommandOrControl+,', click: () => show({ type: 'settings' }) }, { role: 'quit' }] },
        ];
        Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
        if (!smoke) {
            for (const [action, key] of Object.entries(store.preferences.shortcuts)) {
                if (globalShortcut.register(key, shortcutActions[action])) activeShortcuts[action] = key;
                else startupMessages.push(`快捷键 ${key} 被其他程序占用，可在设置中修改。`);
            }
            const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
            icon.setTemplateImage(process.platform === 'darwin');
            tray = new Tray(icon);
            tray.setToolTip('Lingo · 翻译与朗读');
            tray.setContextMenu(Menu.buildFromTemplate([
                { label: '打开翻译', click: () => show({ type: 'focus' }) },
                { label: '翻译剪贴板', click: translateClipboard },
                { label: '截图翻译', click: capture },
                { label: '设置', click: () => show({ type: 'settings' }) },
                { type: 'separator' }, { label: '退出', click: () => app.quit() },
            ]));
            tray.on('click', () => show());
        }
        if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, 'icon.png'));
        await applyDockPreference();
        await window.loadURL(page);
        const loginLaunch = !smoke && (process.argv.includes('--login-startup') || loginItemState(app).wasOpenedAtLogin);
        if (!loginLaunch) show();
    }).catch(error => { console.error('Application startup failed:', error); app.quit(); });
    app.on('activate', () => { if (window && !captureSession?.active && !ocrBusy && !selecting) show(); });
    app.on('before-quit', () => { quitting = true; cancelTranslation(); speech.stop(); captureSession?.close(); });
    app.on('will-quit', () => { globalShortcut.unregisterAll(); ocrWorker?.terminate(); });
}
