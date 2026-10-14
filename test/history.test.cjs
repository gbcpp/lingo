const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HistoryStore } = require('../src/history.cjs');

function createStore(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-history-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return new HistoryStore(directory);
}
const entry = { source: 'Hello', text: '你好', provider: 'baidu', from: 'en', to: 'zh' };

test('Persists newest-first history, evicts oldest entries and reloads', t => {
    const store = createStore(t);
    store.load();
    for (let i = 0; i < 105; i++) store.add({ ...entry, source: String(i) }, 100);
    const loaded = new HistoryStore(path.dirname(store.file));
    loaded.load();
    assert.equal(loaded.list(100).length, 100);
    assert.deepEqual(loaded.list(5).map(value => value.source), ['104', '103', '102', '101', '100']);
    assert.equal(loaded.list(100).at(-1).source, '5');
    assert.equal(new Set(loaded.list(100).map(value => value.id)).size, 100);
    loaded.trim(3);
    assert.deepEqual(JSON.parse(fs.readFileSync(store.file)).map(value => value.source), ['104', '103', '102']);
    loaded.list(3)[0].source = 'Changed';
    assert.equal(loaded.list(3)[0].source, '104');
});

test('Keeps successful history unchanged on invalid entries or failed disk writes', t => {
    const store = createStore(t);
    store.add(entry, 100);
    const original = store.list(100);
    assert.throws(() => store.add({ ...entry, source: '' }, 100), /无效/);
    fs.mkdirSync(store.file + '.tmp');
    assert.throws(() => store.add({ ...entry, source: 'Second' }, 100));
    assert.deepEqual(store.list(100), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(store.file)), original);
});

test('Preserves unreadable history rather than overwriting it', t => {
    const store = createStore(t);
    fs.writeFileSync(store.file, '{broken');
    assert.throws(() => store.load(), /无法读取/);
    assert.throws(() => store.add(entry, 100), /无法读取/);
    assert.throws(() => store.trim(5), /无法读取/);
    assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken');
});
