const { app, BrowserWindow, ipcMain, desktopCapturer, screen, globalShortcut } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { rectangle, cropPlan } = require('./capture-geometry.cjs');
const page = pathToFileURL(path.join(__dirname, 'capture.html')).href;

class ScreenCapture {
    constructor({ onCancel, onImage, onError }) {
        this.onCancel = onCancel;
        this.onImage = onImage;
        this.onError = onError;
        this.windows = new Map();
        this.active = false;
        this.session = 0;
        for (const [name, callback] of Object.entries({
            bounds: entry => entry.display.bounds,
            ready: entry => { entry.ready(); },
            begin: (entry, point) => this.begin(entry, point),
            move: (entry, point) => { if (this.origin === entry) this.paintSelection(rectangle(this.startPoint, this.checkPoint(point))); },
            finish: (entry, point) => this.finish(entry, point),
            cancel: () => this.cancel(),
            recognize: (entry, data) => {
                if (this.composer !== entry || typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > 50_000_000) {
                    throw new Error('截图无效。');
                }
                const buffer = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
                this.close();
                void this.onImage(buffer);
            },
            error: () => { this.close(); this.onError('截图处理失败，请重新框选。'); },
        })) {
            ipcMain.handle(`capture:${name}`, async (event, ...args) => {
                const entry = this.windows.get(event.sender.id);
                if (!entry || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== page) {
                    throw new Error('Unauthorized capture IPC sender');
                }
                try { return { ok: true, value: await callback(entry, ...args) }; }
                catch (error) { return { ok: false, error: error.message }; }
            });
        }
        this.displaysChanged = () => { if (this.active) { this.close(); this.onError('屏幕布局已变化，请重新截图。'); } };
        for (const event of ['display-added', 'display-removed']) screen.on(event, this.displaysChanged);
        screen.on('display-metrics-changed', (_event, _display, metrics) => {
            if (metrics.some(value => ['bounds', 'scaleFactor', 'rotation'].includes(value))) this.displaysChanged();
        });
    }

    async start() {
        if (this.active) return;
        this.active = true;
        const session = ++this.session;
        try {
            await new Promise(resolve => setTimeout(resolve, 250));
            if (session !== this.session) return;
            const displays = screen.getAllDisplays();
            this.displays = displays.map(display => ({ id: display.id, bounds: display.bounds }));
            await Promise.all(this.displays.map(async display => {
                const win = new BrowserWindow({ ...display.bounds, show: false, frame: false, resizable: false, movable: false,
                    enableLargerThanScreen: true, alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
                    transparent: true, backgroundColor: '#00000000', focusable: true, acceptFirstMouse: true, roundedCorners: false,
                    webPreferences: { preload: path.join(__dirname, 'capture-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
                });
                let ready;
                const painted = new Promise(resolve => { ready = resolve; });
                const entry = { win, display, ready };
                const id = win.webContents.id;
                this.windows.set(win.webContents.id, entry);
                win.setAlwaysOnTop(true, 'screen-saver');
                win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
                win.setBounds(display.bounds);
                win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
                win.webContents.on('will-navigate', event => event.preventDefault());
                win.webContents.on('render-process-gone', () => { if (this.active) { this.close(); this.onError('截图窗口已关闭，请重试。'); } });
                win.on('closed', () => { ready(); if (this.active && this.windows.has(id)) this.cancel(); });
                await win.loadURL(page);
                const timeout = setTimeout(() => { if (session === this.session) { this.close(); this.onError('截图加载超时，请重试。'); } ready(); }, 10000);
                await painted;
                clearTimeout(timeout);
            }));
            if (session !== this.session) return;
            for (const { win } of this.windows.values()) win.showInactive();
            const displayId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
            const target = [...this.windows.values()].find(entry => entry.display.id === displayId) || this.windows.values().next().value;
            if (process.platform === 'darwin') app.focus({ steal: true });
            target.win.focus();
            target.win.webContents.focus();
            this.escapeRegistered = !globalShortcut.isRegistered('Escape') && globalShortcut.register('Escape', () => this.cancel());
        } catch (error) {
            if (session !== this.session) return;
            this.close();
            this.onError(error.message);
        }
    }

    checkPoint(point) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 100000 || Math.abs(point.y) > 100000) {
            throw new Error('截图坐标无效。');
        }
        return point;
    }

    begin(entry, point) {
        if (this.composer || this.origin) return;
        this.startPoint = this.checkPoint(point);
        this.origin = entry;
        this.paintSelection(rectangle(this.startPoint, this.startPoint));
    }

    paintSelection(rect = null) {
        for (const { win } of this.windows.values()) win.webContents.send('capture:selection', rect);
    }

    async finish(entry, point) {
        if (this.origin !== entry || this.composer) return;
        clearTimeout(this.timer);
        const rect = rectangle(this.startPoint, this.checkPoint(point));
        this.origin = null;
        this.startPoint = null;
        this.paintSelection();
        if (rect.width < 1 || rect.height < 1) { this.cancel(); return; }
        this.composer = entry;
        const session = this.session;
        for (const { win } of this.windows.values()) win.hide();
        this.timer = setTimeout(() => { this.close(); this.onError('截图处理超时，请重试。'); }, 15000);
        try {
            // Capture after hiding overlays so the live desktop remains unchanged while selecting.
            await new Promise(resolve => setTimeout(resolve, 100));
            if (session !== this.session) return;
            const displays = screen.getAllDisplays();
            const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: {
                width: Math.max(...displays.map(d => Math.round(d.size.width * d.scaleFactor))),
                height: Math.max(...displays.map(d => Math.round(d.size.height * d.scaleFactor))),
            } });
            if (session !== this.session) return;
            this.displays = this.displays.map(display => {
                const source = sources.find(item => item.display_id === String(display.id)) || (displays.length === 1 && sources.length === 1 ? sources[0] : null);
                if (!source || source.thumbnail.isEmpty()) throw new Error('无法读取全部屏幕，请检查屏幕录制权限后重试。');
                return { ...display, size: source.thumbnail.getSize(), image: source.thumbnail.toDataURL() };
            });
            const plan = cropPlan(rect, this.displays);
            entry.win.webContents.send('capture:compose', { ...plan, tiles: plan.tiles.map(tile => ({ ...tile, image: this.displays.find(d => d.id === tile.id).image })) });
        } catch (error) {
            if (session !== this.session) return;
            this.close();
            this.onError(error.message);
        }
    }

    cancel() { this.close(); this.onCancel(); }

    close() {
        this.active = false;
        this.session++;
        clearTimeout(this.timer);
        if (this.escapeRegistered) globalShortcut.unregister('Escape');
        this.escapeRegistered = false;
        this.origin = this.startPoint = this.composer = null;
        const entries = [...this.windows.values()];
        this.windows.clear();
        for (const { win } of entries) if (!win.isDestroyed()) win.destroy();
        this.displays = [];
    }
}
module.exports = { ScreenCapture };
