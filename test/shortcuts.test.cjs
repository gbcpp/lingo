const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultShortcuts, validateShortcuts, saveShortcuts } = require('../src/shortcuts.cjs');

function fixture(blocked = []) {
    const callbacks = Object.fromEntries(Object.keys(defaultShortcuts).map(action => [action, () => action]));
    const active = new Map(Object.entries(defaultShortcuts).map(([action, key]) => [key, callbacks[action]]));
    const registry = {
        register(key, callback) {
            if (active.has(key) || blocked.includes(key)) return false;
            active.set(key, callback);
            return true;
        },
        unregister(key) { active.delete(key); },
    };
    return { callbacks, active, registry };
}

test('Rejects duplicate, missing and unsafe shortcuts before touching registrations', async () => {
    assert.deepEqual(validateShortcuts(), defaultShortcuts);
    for (const value of [null, {}, { ...defaultShortcuts, input: 'A' }, { ...defaultShortcuts, input: defaultShortcuts.capture }]) {
        assert.throws(() => validateShortcuts(value));
    }
    const { callbacks, active, registry } = fixture();
    await assert.rejects(saveShortcuts(registry, callbacks, defaultShortcuts, {}, () => assert.fail('Unexpected save')));
    assert.equal(active.size, 4);
});

test('Swaps bindings without collisions and calls the matching action', async () => {
    const { callbacks, active, registry } = fixture();
    const next = { ...defaultShortcuts, input: defaultShortcuts.capture, capture: defaultShortcuts.input };
    assert.equal(await saveShortcuts(registry, callbacks, defaultShortcuts, next, async () => 'saved'), 'saved');
    assert.equal(active.get(next.input)(), 'input');
    assert.equal(active.get(next.capture)(), 'capture');
    assert.equal(active.size, 4);
});

test('Registration conflict restores all old bindings without persisting', async () => {
    const next = { ...defaultShortcuts, selection: 'CommandOrControl+Shift+F8' };
    const { callbacks, active, registry } = fixture([next.selection]);
    await assert.rejects(saveShortcuts(registry, callbacks, defaultShortcuts, next, () => assert.fail('Unexpected save')), /被占用/);
    for (const [action, key] of Object.entries(defaultShortcuts)) assert.equal(active.get(key), callbacks[action]);
    assert.equal(active.size, 4);
});

test('Persistence failure restores old bindings and removes new bindings', async () => {
    const next = { ...defaultShortcuts, capture: 'Alt+Shift+F9' };
    const { callbacks, active, registry } = fixture();
    await assert.rejects(saveShortcuts(registry, callbacks, defaultShortcuts, next, async () => { throw new Error('Disk unavailable'); }), /Disk unavailable/);
    assert.equal(active.has(next.capture), false);
    for (const [action, key] of Object.entries(defaultShortcuts)) assert.equal(active.get(key), callbacks[action]);
});

test('Accepts Option-only combinations and still rejects duplicate bindings', async () => {
    const next = { ...defaultShortcuts, selection: 'Alt+D', capture: 'Alt+S' };
    assert.deepEqual(validateShortcuts(next), next);
    const { callbacks, active, registry } = fixture();
    await saveShortcuts(registry, callbacks, defaultShortcuts, next, async () => {});
    assert.equal(active.get('Alt+D')(), 'selection');
    assert.throws(() => validateShortcuts({ ...next, capture: 'Alt+D' }), /相同/);
});
