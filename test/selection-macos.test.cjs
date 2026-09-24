const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, '../src/selection-macos.js');
const source = fs.readFileSync(filename, 'utf8');

function script({ text = '', flags = [0], pids = [123], error } = {}) {
    let sleeps = 0, copies = 0;
    const events = {
        applicationProcesses: { whose: () => () => [{
            unixId: () => pids.length > 1 ? pids.shift() : pids[0],
            attributes: { byName: name => {
                assert.equal(name, 'AXFocusedUIElement');
                return { value: () => ({ attributes: { byName: name => {
                    assert.equal(name, 'AXSelectedText');
                    return { value: () => { if (error) throw error; return text; } };
                } } }) };
            } },
        }] },
        keyCode: (code, options) => { assert.equal(code, 8); assert.equal(options.using[0], 'command down'); copies++; },
    };
    const context = { ObjC: { import() {} }, Application: () => events, $: {
        NSEvent: { get modifierFlags() { return flags.length > 1 ? flags.shift() : flags[0]; } },
        NSThread: { sleepForTimeInterval: () => sleeps++ },
    } };
    vm.runInNewContext(source, context);
    return { run: context.run, stats: () => ({ copies, sleeps }) };
}

test('macOS reads selected accessibility text without simulating Copy', () => {
    const instance = script({ text: 'Selected English 和中文' });
    assert.deepEqual(JSON.parse(instance.run(['read'])), { pid: 123, text: 'Selected English 和中文' });
    assert.equal(instance.stats().copies, 0);
});
test('macOS waits for Option and Command release before sending physical Copy key', () => {
    const instance = script({ flags: [(1 << 19) | (1 << 20), 1 << 19, 0] });
    assert.equal(instance.run(['copy', '123']), 'copied');
    assert.deepEqual(instance.stats(), { copies: 1, sleeps: 2 });
});
test('macOS cancels Copy if focus changes or shortcut modifiers remain held', () => {
    const changed = script({ pids: [123, 456] });
    assert.equal(changed.run(['copy', '123']), 'cancelled');
    assert.equal(changed.stats().copies, 0);
    const held = script({ flags: [1 << 19] });
    assert.equal(held.run(['copy', '123']), 'cancelled');
    assert.deepEqual(held.stats(), { copies: 0, sleeps: 150 });
});
test('Unsupported selected-text attributes fall back, permission failures are reported', () => {
    assert.equal(JSON.parse(script({ error: { errorNumber: -1728 } }).run(['read'])).text, '');
    for (const errorNumber of [-1743, -25211]) {
        assert.throws(() => script({ error: { errorNumber } }).run(['read']));
    }
});
test('Native selection returns direct text without reading or clearing the clipboard', async () => {
    const nativeFile = path.join(__dirname, '../src/native.cjs');
    const load = createRequire(nativeFile);
    const context = {
        require: name => name === 'node:child_process' ? {
            ...load(name), execFile: (...args) => args.at(-1)(null, { stdout: JSON.stringify({ pid: 123, text: 'Selection' }) }),
        } : load(name),
        module: { exports: {} }, __dirname: path.dirname(nativeFile), process, Buffer, setTimeout,
    };
    vm.runInNewContext(fs.readFileSync(nativeFile, 'utf8'), context);
    const clipboard = new Proxy({}, { get() { throw new Error('Clipboard must not be accessed'); } });
    assert.equal(await context.module.exports.selectedText(clipboard, 'darwin', { isTrustedAccessibilityClient: () => true }), 'Selection');
});
