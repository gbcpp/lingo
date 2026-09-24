const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadMain(text, error) {
    const filename = path.join(__dirname, '../src/main.cjs');
    const load = createRequire(filename);
    const events = [];
    const native = load('./native.cjs');
    const context = {
        require: name => name === 'electron' ? {
            app: { requestSingleInstanceLock: () => false, quit() {}, focus() {} },
            clipboard: { readText: async () => text },
            screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) }
        } : name === './native.cjs' ? { ...native, selectedText: async () => { if (error) throw error; return text; } } : load(name),
        process, console, __dirname: path.dirname(filename), module: { exports: {} }, events,
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') + `
        window = { getBounds: () => ({ x: 0, y: 0, width: 500, height: 360 }),
            show: () => events.push('show'), focus() {}, isDestroyed: () => false,
            webContents: { send: (_channel, action) => events.push(action.type) } };
        ready = true;
        captureSession = { active: false };
        module.exports = shortcutActions;
    `, context, { filename });
    return { actions: context.module.exports, events };
}

test('Empty selection and clipboard text do not show the translation window', async () => {
    for (const text of ['', ' \n\t']) {
        const { actions, events } = loadMain(text);
        await actions.selection();
        await actions.clipboard();
        assert.deepEqual(events, []);
    }
});

test('Nonempty text and permission errors still show the window', async () => {
    const content = loadMain('Hello');
    await content.actions.selection();
    assert.deepEqual(content.events, ['show', 'text']);
    await content.actions.clipboard();
    assert.deepEqual(content.events, ['show', 'text', 'show', 'text']);
    const denied = loadMain('', new Error('Permission denied'));
    await denied.actions.selection();
    assert.deepEqual(denied.events, ['show', 'error']);
});

test('Selection timeout returns empty text and restores the clipboard', async () => {
    const filename = path.join(__dirname, '../src/native.cjs');
    const load = createRequire(filename);
    const context = {
        require: name => name === 'node:child_process' ? {
            ...load(name), execFile: (...args) => args.at(-1)(null, { stdout: args[1].at(-1) === 'read' ? '{"pid":123,"text":""}' : 'copied' })
        } : name === 'electron' ? { ClipboardItem: class { constructor(items) { this.text = items['text/plain']; } } } : load(name),
        module: { exports: {} }, __dirname: path.dirname(filename), setTimeout: callback => { callback(); }, Buffer, process,
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
    let text = 'Original clipboard';
    const clipboard = {
        read: async () => [{ types: ['text/plain'], getType: async () => text }], readText: async () => text,
        clear: () => { text = ''; }, write: async saved => { text = saved[0].text; },
    };
    assert.equal(await context.module.exports.selectedText(clipboard, 'darwin', { isTrustedAccessibilityClient: () => true }), '');
    assert.equal(text, 'Original clipboard');
});
