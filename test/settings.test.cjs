const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { SettingsStore, defaults, validateSettings } = require('../src/settings.cjs');
const key = randomBytes(32);
const encryption = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async value => {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptStringAsync: async value => {
        const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
        cipher.setAuthTag(value.subarray(12, 28));
        return { result: Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString() };
    },
};
test('Persists encrypted credentials, masks public values and preserves blank secrets', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new SettingsStore(directory, encryption);
    await store.save({ ...defaults, appId: '12345', baiduSecret: 'never-plain', googleKey: 'google-secret', autoSpeak: true });
    const raw = fs.readFileSync(store.file, 'utf8');
    assert.ok(!raw.includes('never-plain'));
    assert.ok(!raw.includes('google-secret'));
    assert.equal(store.publicSettings().baiduSecret, undefined);
    const loaded = new SettingsStore(directory, encryption);
    await loaded.load();
    assert.equal(loaded.credentials.baidu.secret, 'never-plain');
    assert.equal(loaded.preferences.autoSpeak, true);
    await loaded.save({ ...loaded.publicSettings(), baiduSecret: '', googleKey: '' });
    assert.equal(loaded.credentials.baidu.secret, 'never-plain');
    await loaded.save({ ...loaded.publicSettings(), baiduSecret: '', googleKey: '', clearBaidu: true });
    assert.equal(loaded.publicSettings().hasBaiduSecret, false);
    assert.equal(loaded.credentials.google.key, 'google-secret');
});
test('Unavailable encryption never falls back to plaintext or changes live settings', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const store = new SettingsStore(directory, { ...encryption, isAsyncEncryptionAvailable: async () => false });
    await assert.rejects(store.save({ ...defaults, appId: '123', baiduSecret: 'secret', googleKey: '' }), /不可用/);
    assert.equal(fs.existsSync(store.file), false);
    assert.equal(store.credentials.baidu.secret, '');
});

test('Migrates legacy preferences and persists custom shortcuts across reloads', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { shortcuts, ...legacy } = defaults;
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ preferences: legacy }));
    const store = new SettingsStore(directory, encryption);
    await store.load();
    assert.deepEqual(store.publicSettings().shortcuts, shortcuts);
    const custom = { ...shortcuts, input: 'CommandOrControl+Shift+F8' };
    await store.save({ ...store.publicSettings(), shortcuts: custom, baiduSecret: '', googleKey: '' });
    const loaded = new SettingsStore(directory, encryption);
    await loaded.load();
    assert.deepEqual(loaded.publicSettings().shortcuts, custom);
    const exposed = loaded.publicSettings();
    exposed.shortcuts.input = 'A';
    assert.equal(loaded.publicSettings().shortcuts.input, custom.input);
});

test('Dock preference defaults to hidden for old settings and survives reload', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { showDockIcon, ...legacy } = defaults;
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ preferences: legacy }));
    const store = new SettingsStore(directory, encryption);
    await store.load();
    assert.equal(store.preferences.showDockIcon, false);
    await store.save({ ...store.publicSettings(), showDockIcon: true, baiduSecret: '', googleKey: '' });
    const loaded = new SettingsStore(directory, encryption);
    await loaded.load();
    assert.equal(loaded.preferences.showDockIcon, true);
    await assert.rejects(loaded.save({ ...loaded.publicSettings(), showDockIcon: 'false' }), /无效/);
});

test('Migrates automatic speech from translation to source without changing its enabled state', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ preferences: { ...defaults, speakTarget: 'translation', autoSpeak: true } }));
    const store = new SettingsStore(directory, encryption);
    await store.load();
    assert.equal(store.preferences.speakTarget, 'source');
    assert.equal(store.preferences.autoSpeak, true);
    await store.save({ ...store.publicSettings(), speakTarget: 'translation', baiduSecret: '', googleKey: '' });
    assert.equal(store.publicSettings().speakTarget, 'source');
});

test('Programmer mode and login startup default off and persist across reloads', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { programmerMode, startAtLogin, ...legacy } = defaults;
    fs.writeFileSync(path.join(directory, 'settings.json'), JSON.stringify({ preferences: legacy }));
    const store = new SettingsStore(directory, encryption);
    await store.load();
    assert.equal(store.preferences.programmerMode, false);
    assert.equal(store.preferences.startAtLogin, false);
    await store.save({ ...store.publicSettings(), programmerMode: true, startAtLogin: true, baiduSecret: '', googleKey: '' });
    const loaded = new SettingsStore(directory, encryption);
    await loaded.load();
    assert.equal(loaded.preferences.programmerMode, true);
    assert.equal(loaded.preferences.startAtLogin, true);
    for (const field of ['programmerMode', 'startAtLogin']) {
        await assert.rejects(loaded.save({ ...loaded.publicSettings(), [field]: 'true' }), /无效/);
    }
});

test('Translation key defaults to Enter, persists the alternative and rejects invalid modes', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const { translateKey, ...legacy } = defaults;
    assert.equal(validateSettings(legacy).translateKey, 'enter');
    assert.throws(() => validateSettings({ ...defaults, translateKey: 'Space' }), /无效/);
    const store = new SettingsStore(directory, encryption);
    await store.save({ ...defaults, translateKey: 'modifier-enter', appId: '', baiduSecret: '', googleKey: '' });
    const loaded = new SettingsStore(directory, encryption);
    await loaded.load();
    assert.equal(loaded.preferences.translateKey, 'modifier-enter');
});
