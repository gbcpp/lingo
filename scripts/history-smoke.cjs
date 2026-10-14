const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('API'));
        assert.equal(await page.locator('#historyEmpty').textContent(), '暂无翻译历史');
        assert.equal(await page.locator('#historyLimit').inputValue(), '100');
        assert.equal(await page.locator('#historyDisplayLimit').inputValue(), '5');
        await application.evaluate(({ ipcMain, safeStorage }) => {
            safeStorage.isAsyncEncryptionAvailable = async () => true;
            safeStorage.encryptStringAsync = async value => Buffer.from(value);
            globalThis.translationCalls = 0;
            ipcMain.removeHandler('translate');
            ipcMain.handle('translate', async (_event, request) => {
                globalThis.translationCalls++;
                if (request.text === 'failed') return { ok: false, error: 'Synthetic failure' };
                if (request.text === 'slow' || globalThis.delayTranslation) await new Promise(resolve => setTimeout(resolve, 500));
                return { ok: true, value: { text: request.provider === 'google' ? 'A &amp; B &lt;script&gt;' : `译文 ${request.text}`, from: 'en', to: 'zh' } };
            });
        });
        const translate = async text => {
            await page.locator('#input').fill(text);
            await page.locator('#translate').click();
            await page.waitForFunction(() => !document.querySelector('#translate').disabled);
        };
        const historyFile = path.join(userData, 'history.json');
        const readHistory = () => JSON.parse(fs.readFileSync(historyFile, 'utf8'));
        for (let i = 0; i < 7; i++) await translate(`Entry ${i}`);
        assert.equal(readHistory().length, 7);
        assert.deepEqual(await page.locator('.history-source').allTextContents(), ['Entry 5', 'Entry 4', 'Entry 3', 'Entry 2', 'Entry 1']);
        await page.locator('#toggleHistory').click();
        assert.equal(await page.locator('.history-entry').count(), 6);
        const before = await application.evaluate(() => globalThis.translationCalls);
        await page.locator('.history-entry').last().click();
        assert.equal(await page.locator('#input').inputValue(), 'Entry 0');
        assert.equal(await page.locator('#output').textContent(), '译文 Entry 0');
        assert.equal(await application.evaluate(() => globalThis.translationCalls), before);
        assert.equal(readHistory().length, 7);
        assert.equal((await page.locator('.history-source').allTextContents()).includes('Entry 0'), false);
        const window = await application.browserWindow(page);
        await page.locator('#settingsTab').click();
        await page.locator('#back').click();
        assert.equal(await page.locator('.history-entry').count(), 5);
        await page.locator('#toggleHistory').click();
        await page.locator('#hideWindow').click();
        await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '窗口').submenu.items[0].click());
        await page.waitForFunction(() => document.querySelectorAll('.history-entry').length === 5);
        assert.equal(await window.evaluate(win => win.isVisible()), true);
        await application.evaluate(() => { globalThis.delayTranslation = true; });
        await page.locator('#input').fill('Entry 6');
        await page.locator('#translate').click();
        assert.equal(await page.locator('#translate').isDisabled(), true);
        assert.equal((await page.locator('.history-source').allTextContents()).includes('Entry 6'), false);
        await page.locator('#cancel').click();
        await page.waitForTimeout(600);
        await application.evaluate(() => { globalThis.delayTranslation = false; });
        assert.equal(readHistory().length, 7);
        await translate('failed');
        assert.equal(readHistory().length, 7);
        await page.locator('#input').fill('slow');
        await page.locator('#translate').click();
        await page.locator('#cancel').click();
        await page.waitForTimeout(600);
        assert.equal(readHistory().length, 7);
        await page.locator('#provider').selectOption('google');
        await translate('<script>unsafe</script>');
        assert.equal(readHistory()[0].text, 'A & B <script>');
        assert.equal((await page.locator('.history-source').allTextContents()).includes('<script>unsafe</script>'), false);
        await page.locator('#clear').click();
        assert.equal(await page.locator('.history-source').first().textContent(), '<script>unsafe</script>');
        assert.equal(await page.locator('#historyList script').count(), 0);
        await page.locator('#settingsTab').click();
        await page.locator('#historyLimit').fill('3');
        await page.locator('#historyDisplayLimit').fill('2');
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === '已保存');
        assert.equal(readHistory().length, 3);
        assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'))).preferences.historyLimit, 3);
        assert.equal(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'))).preferences.historyDisplayLimit, 2);
        await page.locator('#back').click();
        assert.equal(await page.locator('.history-entry').count(), 2);
        await page.locator('#toggleHistory').click();
        assert.equal(await page.locator('.history-entry').count(), 3);
        await page.locator('#hideWindow').click();
        await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(item => item.label === '窗口').submenu.items[0].click());
        await page.waitForFunction(() => document.querySelectorAll('.history-entry').length === 2);
        await page.reload();
        await page.waitForFunction(() => document.querySelectorAll('.history-entry').length === 2);
        assert.equal(await page.locator('#historyLimit').inputValue(), '3');
        assert.equal(await page.locator('#historyDisplayLimit').inputValue(), '2');
        assert.equal(await page.locator('.history-source').first().textContent(), '<script>unsafe</script>');
        await application.evaluate(({ app }) => {
            const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
            const { HistoryStore } = load(app.getAppPath() + '/src/history.cjs');
            const reloaded = new HistoryStore(app.getPath('userData'));
            reloaded.load();
            if (reloaded.list(3).length !== 3) throw new Error('History did not survive a store restart');
        });
        fs.mkdirSync(historyFile + '.tmp');
        await translate('Disk failure');
        assert.equal(await page.locator('#output').textContent(), '译文 Disk failure');
        assert.match(await page.locator('#historyEmpty').textContent(), /保存失败/);
        assert.equal(readHistory().length, 3);
        fs.rmdirSync(historyFile + '.tmp');
        await page.locator('#settingsTab').click();
        await page.locator('#historyLimit').fill('100');
        await page.locator('#historyDisplayLimit').fill('5');
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === '已保存');
        await page.locator('#back').click();
        for (const text of ['Welcome', 'Translation history', 'Recent translations', 'Hello world', 'Good morning']) await translate(text);
        await page.locator('#clear').click();
        await page.waitForFunction(() => window.innerHeight === Math.ceil(document.querySelector('main').getBoundingClientRect().height + 40));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'artifacts', 'history-preview.png') });
        assert.deepEqual(errors, []);
        console.log('PASS: configurable display count, current source hidden during and after translation, clear restores history, expand/collapse, local persistence, retention settings, recall without API calls, reopen reset, safe text rendering, decoded Google results, canceled/failed results excluded, disk failure preserves translation');
    } finally {
        await application.close();
        if (userData?.startsWith(path.join(os.tmpdir(), 'lingo-smoke-'))) fs.rmSync(userData, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
