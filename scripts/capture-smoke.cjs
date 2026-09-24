const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.join(__dirname, '..');

(async () => {
    const application = await electron.launch({
        ...(process.env.LINGO_EXECUTABLE_PATH ? { executablePath: process.env.LINGO_EXECUTABLE_PATH } : {}),
        args: process.env.LINGO_EXECUTABLE_PATH ? ['--smoke-test'] : [root, '--smoke-test'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
    });
    let userData;
    try {
        userData = await application.evaluate(({ app }) => app.getPath('userData'));
        const page = await application.firstWindow();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('API'));
        const original = await application.browserWindow(page);
        const traySizes = await application.evaluate(({ app, nativeImage }) => {
            const icon = nativeImage.createFromPath(app.getAppPath() + '/src/tray.png');
            return { size: icon.getSize(), scales: icon.getScaleFactors() };
        });
        assert.deepEqual(traySizes.size, { width: 18, height: 18 });
        assert.ok(traySizes.scales.includes(2));

        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (process.platform === 'darwin') assert.equal(await application.evaluate(({ app }) => app.dock.isVisible()), false);
        await application.evaluate(({ safeStorage }) => {
            safeStorage.isAsyncEncryptionAvailable = async () => true;
            safeStorage.encryptStringAsync = async value => Buffer.from(value);
        });
        await application.evaluate(({ app }) => {
            const descriptor = Object.getOwnPropertyDescriptor(app, 'isPackaged');
            const get = app.getLoginItemSettings, set = app.setLoginItemSettings;
            globalThis.loginCalls = [];
            globalThis.loginEnabled = false;
            Object.defineProperty(app, 'isPackaged', { configurable: true, value: true });
            app.getLoginItemSettings = () => ({ openAtLogin: globalThis.loginEnabled, executableWillLaunchAtLogin: globalThis.loginEnabled });
            app.setLoginItemSettings = options => { globalThis.loginCalls.push(options.openAtLogin); globalThis.loginEnabled = options.openAtLogin; };
            globalThis.restoreLogin = () => {
                Object.defineProperty(app, 'isPackaged', descriptor);
                app.getLoginItemSettings = get;
                app.setLoginItemSettings = set;
            };
        });
        const saveStartup = enabled => page.evaluate(async startAtLogin => {
            const { settings } = await window.lingo.settings();
            return window.lingo.save({ ...settings, startAtLogin, baiduSecret: '', googleKey: '' });
        }, enabled);
        assert.equal((await saveStartup(true)).startAtLogin, true);
        assert.equal((await saveStartup(false)).startAtLogin, false);
        await application.evaluate(({ safeStorage }) => { safeStorage.isAsyncEncryptionAvailable = async () => false; });
        await assert.rejects(saveStartup(true), /密钥存储不可用/);
        assert.equal(await application.evaluate(() => globalThis.loginEnabled), false);
        assert.deepEqual(await application.evaluate(() => globalThis.loginCalls), [true, false, true, false]);
        await application.evaluate(({ safeStorage }) => {
            safeStorage.isAsyncEncryptionAvailable = async () => true;
            globalThis.restoreLogin();
        });
        await page.locator('#settingsTab').click();
        await page.locator('#shortcut-selection-mod').selectOption('Alt');
        if (process.platform === 'darwin') await page.locator('#showDockIcon').check();
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === '已保存');
        if (process.platform === 'darwin') {
            assert.equal(await application.evaluate(({ app }) => app.dock.isVisible()), true);
            await original.evaluate(win => { win.show(); win.focus(); });
            await page.locator('#showDockIcon').uncheck();
            await page.locator('#save').click();
            await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === '已保存');
            for (let i = 0; i < 50 && await application.evaluate(({ app }) => app.dock.isVisible()); i++) await new Promise(resolve => setTimeout(resolve, 100));
            assert.equal(await application.evaluate(({ app }) => app.dock.isVisible()), false);
        }
        const stored = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'));
        assert.equal(stored.preferences.shortcuts.selection, 'Alt+D');
        assert.equal(stored.preferences.showDockIcon, false);
        await original.evaluate(win => { win.show(); win.focus(); });
        await page.locator('#back').click();
        const images = await page.evaluate(() => ['#ff0000', '#0000ff'].map((color, i) => {
            const canvas = document.createElement('canvas');
            canvas.width = 300 * (i + 1); canvas.height = 200 * (i + 1);
            const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
        }));
        const origin = await application.evaluate(({ app, screen, desktopCapturer, nativeImage, ipcMain }, images) => {
            const real = screen.getPrimaryDisplay();
            globalThis.realDisplayCount = screen.getAllDisplays().length;
            const x = real.bounds.x + 100, y = real.bounds.y + 100;
            const displays = [1, 2].map((id, i) => ({ id, bounds: { x: x + i * 300, y, width: 300, height: 200 }, size: { width: 300, height: 200 }, scaleFactor: id }));
            screen.getAllDisplays = () => displays;
            screen.getDisplayNearestPoint = point => displays[point.x < x + 300 ? 0 : 1];
            globalThis.capturePoint = { x: x + 250, y: y + 40 };
            screen.getCursorScreenPoint = () => globalThis.capturePoint;
            globalThis.captureReads = 0;
            desktopCapturer.getSources = async () => { globalThis.captureReads++; return images.map((image, i) => ({ display_id: String(i + 1), thumbnail: nativeImage.createFromDataURL(image) })); };
            const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
            globalThis.captured = [];
            load(app.getAppPath() + '/src/ocr.cjs').createOCR = async () => ({
                async recognize(buffer) {
                    const image = nativeImage.createFromBuffer(buffer), size = image.getSize(), bitmap = image.toBitmap();
                    const pixel = x => Array.from(bitmap.subarray((Math.floor(size.height / 2) * size.width + x) * 4, (Math.floor(size.height / 2) * size.width + x) * 4 + 4));
                    globalThis.captured.push({ size, left: pixel(5), right: pixel(size.width - 5) });
                    if (globalThis.delayOCR) await new Promise(resolve => { globalThis.finishOCR = resolve; });
                    if (globalThis.failOCR) throw new Error('Synthetic OCR failure');
                    return { data: { text: globalThis.emptyOCR ? ' \n\t' : 'Synthetic capture' } };
                }, terminate() {},
            });
            ipcMain.removeHandler('translate');
            ipcMain.handle('translate', () => ({ ok: true, value: { text: '截图翻译测试', from: 'en', to: 'zh' } }));
            return { x, y };
        }, images);
        const getOverlays = async () => {
            for (let n = 0; n < 100; n++) {
                const overlays = application.windows().filter(win => win.url().endsWith('/capture.html') && !win.isClosed());
                if (overlays.length === 2 && await Promise.all(overlays.map(win => win.evaluate(() => document.body.dataset.ready === 'true'))).then(v => v.every(Boolean))) return overlays;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error('Expected two capture overlays');
        };
        for (const secondOnly of [false, true]) {
            await original.evaluate(win => { win.show(); win.focus(); });
            await page.locator('#captureButton').click();
            const overlays = await getOverlays();
            for (const overlay of overlays) overlay.on('pageerror', error => errors.push(error.message));
            const ordered = [];
            for (const overlay of overlays) {
                const surface = await overlay.evaluate(() => ({
                    pixel: Array.from(document.querySelector('canvas').getContext('2d').getImageData(5, 5, 1, 1).data),
                    background: getComputedStyle(document.body).backgroundColor,
                    cursor: getComputedStyle(document.body).cursor,
                    text: document.body.textContent.trim()
                }));
                assert.deepEqual(surface.pixel, [0, 0, 0, 0]);
                assert.equal(surface.background, 'rgba(0, 0, 0, 0)');
                assert.match(surface.cursor, /crosshair\.svg.*10 10, crosshair/);
                assert.equal(surface.text, '');
                const win = await application.browserWindow(overlay);
                assert.equal(await win.evaluate(win => win.isFocusable()), true);
                const bounds = await win.evaluate(win => win.getBounds());
                ordered[bounds.x === origin.x ? 0 : 1] = overlay;
            }
            assert.equal(await application.evaluate(() => globalThis.captureReads), secondOnly ? 1 : 0);
            const start = { x: origin.x + (secondOnly ? 330 : 250), y: origin.y + 40 };
            const end = { x: origin.x + 380, y: origin.y + 140 };
            await application.evaluate((_electron, point) => { globalThis.capturePoint = point; }, start);
            const target = ordered[secondOnly ? 1 : 0];
            await target.mouse.move(secondOnly ? 30 : 250, 40);
            await target.mouse.down();
            await new Promise(resolve => setTimeout(resolve, 60));
            await application.evaluate((_electron, point) => { globalThis.capturePoint = point; }, end);
            await target.mouse.move(end.x - origin.x - (secondOnly ? 300 : 0), end.y - origin.y);
            await new Promise(resolve => setTimeout(resolve, 60));
            for (const [index, overlay] of ordered.entries()) {
                const pixels = await overlay.evaluate(({ start, end, origin, index }) => {
                    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
                    const x = Math.max(start.x - origin.x - index * 300 + 10, 10);
                    const y = start.y - origin.y;
                    const read = (x, y) => Array.from(ctx.getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data);
                    return { border: read(x, y), inside: read(x, y + 10), outside: read(5, 5) };
                }, { start, end, origin, index });
                if (!secondOnly || index === 1) {
                    assert.deepEqual(pixels.border.slice(0, 3), [0, 0, 0]);
                    assert.ok(pixels.border[3] > 0);
                }
                assert.equal(pixels.inside[3], 0);
                assert.equal(pixels.outside[3], 0);
            }

            if (!secondOnly) await target.screenshot({ path: path.join(root, 'artifacts', 'capture-border-preview.png'), omitBackground: true });
            await target.mouse.up();
            await page.waitForFunction(() => document.querySelector('#output').textContent === '截图翻译测试');
            const result = await application.evaluate(() => globalThis.captured.at(-1));
            assert.deepEqual(result.size, { width: secondOnly ? 100 : 260, height: 200 });
            assert.deepEqual(result.left, secondOnly ? [255, 0, 0, 255] : [0, 0, 255, 255]);
            assert.deepEqual(result.right, [255, 0, 0, 255]);
        }
        await page.locator('#captureButton').click();
        const overlays = await getOverlays();
        await overlays[1].keyboard.down('Escape');
        await page.waitForTimeout(100);
        assert.ok(overlays.every(win => win.isClosed()));
        assert.equal(await original.evaluate(win => win.isVisible()), false);
        assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Escape')), false);
        await page.evaluate(() => window.lingo.capture());
        const zeroOverlays = await getOverlays();
        await zeroOverlays[0].mouse.click(20, 20);
        await page.waitForTimeout(100);
        assert.ok(zeroOverlays.every(win => win.isClosed()));
        assert.equal(await original.evaluate(win => win.isVisible()), false);
        await original.evaluate(win => {
            globalThis.mainShowCount = 0;
            win.on('show', () => globalThis.mainShowCount++);
        });
        for (const fail of [false, true]) {
            await application.evaluate((_electron, fail) => {
                globalThis.emptyOCR = !fail;
                globalThis.failOCR = fail;
                globalThis.delayOCR = true;
                globalThis.finishOCR = null;
            }, fail);
            await page.evaluate(() => window.lingo.capture());
            const emptyOverlays = await getOverlays();
            await emptyOverlays[0].mouse.move(20, 20);
            await emptyOverlays[0].mouse.down();
            await emptyOverlays[0].mouse.move(80, 80);
            await emptyOverlays[0].mouse.up();
            for (let n = 0; n < 100 && !await application.evaluate(() => Boolean(globalThis.finishOCR)); n++) await page.waitForTimeout(30);
            assert.equal(await application.evaluate(() => Boolean(globalThis.finishOCR)), true);
            assert.equal(await original.evaluate(win => win.isVisible()), false);
            assert.equal(await application.evaluate(() => globalThis.mainShowCount), 0);
            await application.evaluate(() => globalThis.finishOCR());
            if (fail) await page.waitForFunction(() => document.querySelector('#status').textContent.includes('OCR 识别失败'));
            else await page.waitForFunction(() => document.querySelector('#status').textContent === '');
            assert.equal(await original.evaluate(win => win.isVisible()), fail);
            assert.equal(await application.evaluate(() => globalThis.mainShowCount), fail ? 1 : 0);
        }
        await application.evaluate(({ desktopCapturer }) => { desktopCapturer.getSources = async () => []; });
        await page.locator('#captureButton').click();
        const failedOverlays = await getOverlays();
        await application.evaluate((_electron, point) => { globalThis.capturePoint = point; }, { x: origin.x + 20, y: origin.y + 20 });
        await failedOverlays[0].mouse.move(20, 20);
        await failedOverlays[0].mouse.down();
        await application.evaluate((_electron, point) => { globalThis.capturePoint = point; }, { x: origin.x + 80, y: origin.y + 80 });
        await failedOverlays[0].mouse.move(80, 80);
        await failedOverlays[0].mouse.up();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('屏幕录制权限'));
        assert.ok(failedOverlays.every(win => win.isClosed()));
        assert.equal(await application.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Escape')), false);
        assert.deepEqual(errors, []);
        console.log('PASS: Option-only saved, real Dock show/hide, transparent focusable overlays, custom crosshair, visible cross-screen border without dimming, capture only after release, mixed-DPI cross-screen crop, second-screen crop, empty OCR without window flashes, silent cancel/zero-area selection, OCR failure reporting, cancel/error cleanup, login registration and save rollback (system login API stubbed)');
        console.log('Physical displays available: ' + await application.evaluate(() => globalThis.realDisplayCount));
    } finally {
        await application.close();
        if (userData?.startsWith(path.join(os.tmpdir(), 'lingo-smoke-'))) fs.rmSync(userData, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
