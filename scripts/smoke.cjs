const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

(async () => {
    const root = path.join(__dirname, '..');
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
        const originalWindow = await application.browserWindow(page);
        await page.waitForFunction(() => window.innerWidth === 500 && window.innerHeight < 400);
        await page.waitForFunction(() => window.innerHeight === Math.max(300,
            Math.ceil(document.querySelector('.window-bar').offsetHeight + document.querySelector('main').getBoundingClientRect().height)));
        const shortHeight = await page.evaluate(() => window.innerHeight);
        await page.locator('#input').fill('A line of source text.\n'.repeat(20));
        await page.waitForFunction(height => window.innerHeight > height + 80, shortHeight);
        await page.locator('#clear').click();
        await page.waitForFunction(height => window.innerHeight <= height, shortHeight);
        await page.locator('#input').fill('Hello world');
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#status').textContent.includes('APP ID'));
        await application.evaluate(({ ipcMain }) => {
            globalThis.speechCalls = [];
            globalThis.translationCalls = [];
            ipcMain.removeHandler('translate');
            ipcMain.handle('translate', async (_event, request) => {
                globalThis.translationCalls.push(request);
                if (request.text === 'slow') await new Promise(resolve => setTimeout(resolve, 350));
                return { ok: true, value: { text: request.text === 'unsafe' ? '<script>alert(1)</script>' : request.text === 'long result' ? '这是一段用于验证窗口尺寸的长译文。\n'.repeat(40) : request.to === 'en' ? 'Hello, world.' : '你好，世界。', from: /\p{Script=Han}/u.test(request.text) ? 'zh' : 'en', to: request.to } };
            });
            ipcMain.removeHandler('settings:save');
            ipcMain.handle('settings:save', (_event, input) => ({ ok: true, value: { ...input, hasBaiduSecret: true } }));
            ipcMain.removeHandler('speech:speak');
            ipcMain.handle('speech:speak', (_event, input) => { globalThis.speechCalls.push(input); return { ok: true }; });
        });
        await page.locator('#autoSpeakQuick').check();
        await page.waitForFunction(() => !document.querySelector('#autoSpeakQuick').disabled);
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === '你好，世界。');
        const calls = await application.evaluate(() => globalThis.speechCalls);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].text, 'Hello world');
        assert.equal(calls[0].lang, 'en');
        await page.locator('#input').fill('unsafe');
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === '<script>alert(1)</script>');
        assert.equal(await page.locator('#output script').count(), 0);
        await page.locator('#input').fill('slow');
        await page.locator('#translate').click();
        await page.locator('#input').fill('new input');
        await page.waitForTimeout(500);
        assert.ok((await page.locator('#output').textContent()).includes('译文将显示'));
        await page.locator('#settingsTab').click();
        await page.waitForFunction(() => window.innerWidth === 620);
        await page.locator('#shortcut-input-mod').selectOption('CommandOrControl+Shift');
        await page.locator('#shortcut-input-key').selectOption('F8');
        await page.locator('#shortcut-selection-key').selectOption('F9');
        await page.locator('#rate').selectOption('1.25');
        await page.locator('#save').click();
        await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === '已保存');
        assert.equal(await page.locator('#shortcut-input-key').inputValue(), 'F8');
        await page.locator('#back').click();
        await page.waitForFunction(() => window.innerWidth === 500);
        assert.match(await page.locator('#selectionShortcut').textContent(), /F9/);
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === '你好，世界。');
        const latest = await application.evaluate(() => globalThis.speechCalls.at(-1));
        assert.equal(latest.text, 'new input');
        assert.equal(latest.rate, 1.25);
        await page.locator('#input').fill('Hello, world.');
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === '你好，世界。');
        const artifacts = path.join(root, 'artifacts');
        fs.mkdirSync(artifacts, { recursive: true });
        await page.waitForFunction(() => document.querySelector('#pronunciationText').textContent.includes('həˈɫoʊ'));
        await page.waitForFunction(() => document.querySelector('main').getBoundingClientRect().height + 40 <= window.innerHeight + 1);
        await page.screenshot({ path: path.join(artifacts, 'compact-preview.png') });
        await page.waitForFunction(() => document.querySelector('#pronunciationText').textContent.includes('həˈɫoʊ'));
        const resultHeight = await page.evaluate(() => window.innerHeight);
        await page.locator('#input').fill('long result');
        await page.locator('#translate').click();
        await page.waitForFunction(height => window.innerHeight > height + 150, resultHeight);
        assert.ok(await page.locator('#output').evaluate(el => el.scrollHeight > el.clientHeight));
        await page.screenshot({ path: path.join(artifacts, 'expanded-preview.png') });
        await page.locator('#clear').click();
        await page.waitForFunction(height => window.innerHeight <= height, resultHeight);
        await page.locator('#settingsTab').click();
        await page.waitForFunction(() => window.innerWidth === 620 && window.innerHeight >= 600);
        await page.screenshot({ path: path.join(artifacts, 'settings-preview.png') });
        await page.locator('#back').click();
        if (process.env.LINGO_SKIP_NATIVE_FOCUS === '1') {
            await originalWindow.evaluate(win => win.emit('blur'));
            assert.equal(await originalWindow.evaluate(win => win.isVisible()), false);
            console.log('SKIP: native focus transition; blur handler verified with a synthetic event.');
        } else {
            await application.evaluate(({ app }) => app.focus({ steal: true }));
            await originalWindow.evaluate(win => { win.show(); win.focus(); });
            for (let i = 0; i < 30 && !await originalWindow.evaluate(win => win.isFocused()); i++) await page.waitForTimeout(50);
            assert.equal(await originalWindow.evaluate(win => win.isFocused()), true);
            const focusWindow = await application.evaluateHandle(({ BrowserWindow }) => {
                const other = new BrowserWindow({ width: 100, height: 100, show: true });
                other.focus();
                return other;
            });
            for (let i = 0; i < 30 && await originalWindow.evaluate(win => win.isVisible()); i++) await page.waitForTimeout(50);
            assert.equal(await originalWindow.evaluate(win => win.isVisible()), false);
            await focusWindow.evaluate(win => win.destroy());
        }
        await originalWindow.evaluate(win => { win.show(); win.focus(); });
        await page.locator('#input').fill('Content remains when hidden');
        await page.locator('#hideWindow').click();
        assert.equal(await originalWindow.evaluate(win => win.isVisible()), false);
        await originalWindow.evaluate(win => { win.show(); win.focus(); });
        assert.equal(await page.locator('#input').inputValue(), 'Content remains when hidden');
        await page.locator('#input').fill('你好，世界');
        await page.waitForFunction(() => document.querySelector('#pronunciationText').textContent.includes('nǐ hǎo'));
        assert.equal(await page.locator('#pronunciationLabel').textContent(), '拼音');
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === 'Hello, world.');
        const chineseSpeech = await application.evaluate(() => globalThis.speechCalls.at(-1));
        assert.equal(chineseSpeech.text, '你好，世界');
        assert.equal(chineseSpeech.lang, 'zh');
        await page.waitForFunction(() => document.querySelector('#pronunciationText').textContent.includes('nǐ hǎo'));
        await page.waitForFunction(() => document.querySelector('main').getBoundingClientRect().height + 40 <= window.innerHeight + 1);
        await page.screenshot({ path: path.join(artifacts, 'pinyin-preview.png') });
        assert.equal(await application.evaluate(() => globalThis.translationCalls.at(-1).to), 'en');
        assert.equal(await page.locator('#to').inputValue(), 'auto');
        await page.locator('#clear').click();
        assert.equal(await page.locator('#pronunciation').isVisible(), false);
        await page.locator('#input').fill('qzxnonexistentword');
        await page.waitForFunction(() => document.querySelector('#pronunciationText').textContent.includes('未收录'));
        await page.locator('#input').fill('Hello world');
        await page.waitForFunction(() => document.querySelector('#pronunciationText').textContent.includes('həˈɫoʊ'));
        assert.ok(!(await page.locator('#pronunciationText').textContent()).includes('未收录'));
        await application.evaluate(({ ipcMain }) => {
            globalThis.copyCalls = [];
            ipcMain.removeHandler('clipboard:write');
            ipcMain.handle('clipboard:write', (_event, text) => { globalThis.copyCalls.push(text); return { ok: true }; });
        });
        await page.locator('#input').fill('// get_user-name /* request */');
        await page.locator('#copySource').click();
        assert.equal(await application.evaluate(() => globalThis.copyCalls.at(-1)), '// get_user-name /* request */');
        await page.locator('#programmerModeQuick').check();
        await page.waitForFunction(() => !document.querySelector('#programmerModeQuick').disabled);
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === '你好，世界。');
        assert.equal(await page.locator('#input').inputValue(), 'get user name request');
        assert.equal(await application.evaluate(() => globalThis.speechCalls.at(-1).text), 'get user name request');
        await page.locator('#copy').click();
        assert.equal(await application.evaluate(() => globalThis.copyCalls.at(-1)), '你好，世界。');
        await page.locator('#programmerModeQuick').uncheck();
        await page.waitForFunction(() => !document.querySelector('#programmerModeQuick').disabled);
        await page.locator('#input').fill('// keep_original');
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === '你好，世界。');
        assert.equal(await application.evaluate(() => globalThis.speechCalls.at(-1).text), '// keep_original');
        await page.locator('#clear').click();
        assert.equal(await page.locator('#copySource').isDisabled(), true);
        assert.equal(await page.locator('#copy').isDisabled(), true);
        for (const [text, expected] of [
            ['Please check the API result 返回', 'zh'],
            ['请检查这个 API 返回的结果', 'en'],
            ['Hello world', 'zh']
        ]) {
            await page.locator('#input').fill(text);
            await page.locator('#translate').click();
            await page.waitForFunction(() => !document.querySelector('#translate').disabled);
            assert.equal(await application.evaluate(() => globalThis.translationCalls.at(-1).to), expected);
        }
        await page.locator('#to').selectOption('ja');
        await page.locator('#input').fill('你好');
        await page.locator('#translate').click();
        await page.waitForFunction(() => !document.querySelector('#translate').disabled);
        assert.equal(await application.evaluate(() => globalThis.translationCalls.at(-1).to), 'ja');
        await page.locator('#to').selectOption('auto');
        await page.locator('#translate').click();
        await page.waitForFunction(() => document.querySelector('#output').textContent === 'Hello, world.');
        await page.locator('#swap').click();
        assert.equal(await page.locator('#from').inputValue(), 'en');
        assert.equal(await page.locator('#to').inputValue(), 'zh');
        const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
        const input = page.locator('#input');
        const requestCount = () => application.evaluate(() => globalThis.translationCalls.length);
        assert.equal(await page.locator('#translateKey').inputValue(), 'enter');
        await input.fill('Hello world');
        await input.press('End');
        const before = await requestCount();
        await input.press(`${modifier}+Enter`);
        assert.equal(await input.inputValue(), 'Hello world\n');
        assert.equal(await requestCount(), before);
        await input.press('Enter');
        await page.waitForFunction(() => !document.querySelector('#translate').disabled);
        assert.equal(await requestCount(), before + 1);
        await page.locator('#translateKey').selectOption('modifier-enter');
        await page.waitForFunction(() => !document.querySelector('#translateKey').disabled);
        await input.fill('First');
        await input.press('End');
        await input.press('Enter');
        assert.equal(await input.inputValue(), 'First\n');
        assert.equal(await requestCount(), before + 1);
        await input.press(`${modifier}+Enter`);
        await page.waitForFunction(() => !document.querySelector('#translate').disabled);
        assert.equal(await requestCount(), before + 2);
        await page.locator('#translateKey').selectOption('enter');
        await page.waitForFunction(() => !document.querySelector('#translateKey').disabled);
        const composing = await input.evaluate(el => {
            const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
            el.dispatchEvent(event);
            return event.defaultPrevented;
        });
        assert.equal(composing, false);
        await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true })));
        await page.locator('#translateKey').dispatchEvent('keydown', { key: 'Enter' });
        assert.equal(await requestCount(), before + 2);
        await input.fill('First second');
        await input.evaluate(el => el.setSelectionRange(5, 6));
        await input.press(`${modifier}+Enter`);
        assert.equal(await input.inputValue(), 'First\nsecond');
        await application.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('settings:save');
            ipcMain.handle('settings:save', () => ({ ok: false, error: 'Synthetic save failure' }));
        });
        await page.locator('#translateKey').selectOption('modifier-enter');
        await page.waitForFunction(() => !document.querySelector('#translateKey').disabled);
        assert.equal(await page.locator('#translateKey').inputValue(), 'enter');
        assert.equal(await page.locator('#enterShortcut').textContent(), 'Enter');
        assert.deepEqual(errors, []);
        const fixturePath = path.join(root, 'test', 'ocr-fixture.png');
        const fixture = fs.existsSync(fixturePath) ? fs.readFileSync(fixturePath).toString('base64') : await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = 800; canvas.height = 140;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 140);
            ctx.fillStyle = 'black'; ctx.font = '42px Arial';
            ctx.fillText('Hello world 你好世界', 25, 85);
            return canvas.toDataURL('image/png').split(',')[1];
        });
        if (!fs.existsSync(fixturePath)) fs.writeFileSync(fixturePath, Buffer.from(fixture, 'base64'));
        const recognized = await application.evaluate(async ({ app }, image) => {
            const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
            const path = load('node:path');
            const { createOCR } = load(path.join(app.getAppPath(), 'src/ocr.cjs'));
            const langPath = app.isPackaged ? path.join(process.resourcesPath, 'tessdata') : path.join(app.getAppPath(), 'resources', 'tessdata');
            const worker = await createOCR(langPath);
            try { return (await worker.recognize(Buffer.from(image, 'base64'))).data.text; }
            finally { await worker.terminate(); }
        }, fixture);
        assert.match(recognized, /Hello world/i);
        assert.match(recognized.replaceAll(' ', ''), /你好世界/);
        console.log('PASS: configurable Enter/newline, IME guard, selected-text replacement, save failure rollback, compact/expanded layout, shortcut settings, blur hiding, desktop UI, missing credentials, result escaping, cancellation, automatic speech, preferences and offline Chinese/English OCR');
    } finally {
        await application.close();
        if (userData?.startsWith(path.join(os.tmpdir(), 'lingo-smoke-'))) fs.rmSync(userData, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
