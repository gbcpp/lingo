const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
        const result = await application.evaluate(async ({ app, clipboard, ClipboardItem }) => {
            const load = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
            const fs = load('node:fs'), vm = load('node:vm'), path = load('node:path');
            const { readClipboardSnapshot } = load(path.join(app.getAppPath(), 'src/native.cjs'));
            const saved = await readClipboardSnapshot(clipboard);
            const fixtureText = 'Lingo clipboard fixture';
            const selected = 'Lingo selected text';
            const html = '<b>Lingo clipboard fixture</b>';
            const customType = 'web application/x-lingo-test';
            try {
                await clipboard.write([new ClipboardItem({ 'text/plain': fixtureText, 'text/html': html, [customType]: new Blob(['fixture']) })]);
                const sourceFile = path.join(app.getAppPath(), 'src/native.cjs');
                const context = {
                    require: name => name === 'node:child_process' ? { ...load(name), execFile: (...args) => {
                        const callback = args.at(-1);
                        if (args[1].at(-1) === 'read') callback(null, { stdout: '{"pid":123,"text":""}' });
                        else clipboard.writeText(selected).then(() => callback(null, { stdout: 'copied' }), callback);
                    } } : load(name),
                    module: { exports: {} }, __dirname: path.dirname(sourceFile), process, Buffer, setTimeout,
                };
                vm.runInNewContext(fs.readFileSync(sourceFile, 'utf8'), context);
                const captured = await context.module.exports.selectedText(clipboard, 'darwin', { isTrustedAccessibilityClient: () => true });
                const restored = await clipboard.read();
                const restoredHTML = await (await restored[0].getType('text/html')).text();
                const restoredCustom = await (await restored[0].getType(customType)).text();
                return { captured: captured === selected, textRestored: await clipboard.readText() === fixtureText,
                    htmlRestored: restoredHTML.includes(html), customRestored: restoredCustom === 'fixture' };
            } finally {
                const current = await clipboard.readText();
                if (!current || current === fixtureText || current === selected) await clipboard.write(saved);
            }
        });
        assert.deepEqual(result, { captured: true, textRestored: true, htmlRestored: true, customRestored: true });
        console.log('PASS: real Electron clipboard API, asynchronous selection polling, plain/HTML/custom data restoration; Copy event is simulated.');
    } finally {
        await application.close();
        if (userData?.startsWith(path.join(os.tmpdir(), 'lingo-smoke-'))) fs.rmSync(userData, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
