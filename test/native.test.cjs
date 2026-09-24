const test = require('node:test');
const assert = require('node:assert/strict');
const { Speech, powershellArgs, selectVoice, loginItemState, setLoginItem } = require('../src/native.cjs');
test('PowerShell command encoding preserves a fixed script', () => {
    const script = 'Write-Output "Hello"';
    assert.equal(Buffer.from(powershellArgs(script).at(-1), 'base64').toString('utf16le'), script);
});
test('Stopping while voice discovery is pending prevents speech from starting', async () => {
    const speech = new Speech('darwin');
    let resolve;
    speech.voices = () => new Promise(done => { resolve = done; });
    const pending = speech.speak({ text: 'Hello', lang: 'en', voice: '', rate: 1 });
    speech.stop();
    resolve([{ id: 'Unavailable test voice', lang: 'en-US' }]);
    await pending;
    assert.equal(speech.process, null);
});

const voices = [
    { id: 'Albert', lang: 'en-US' },
    { id: 'Eddy (中文（中国大陆）)', lang: 'zh-CN' },
    { id: 'Daniel', lang: 'en-GB' },
    { id: 'Samantha', lang: 'en-US' },
    { id: 'Meijia', lang: 'zh-TW' },
    { id: 'Sinji', lang: 'zh-HK' },
    { id: 'Tingting', lang: 'zh-CN' }
];
test('Automatic speech prefers standard voices over alphabetically first character voices', () => {
    assert.equal(selectVoice(voices, 'en', '').id, 'Samantha');
    assert.equal(selectVoice(voices, 'zh', '').id, 'Tingting');
    assert.equal(selectVoice([...voices].reverse(), 'en', '').id, 'Samantha');
});
test('Voice selection respects explicit locale and Mandarin fallback', () => {
    assert.equal(selectVoice(voices, 'en-GB', '').id, 'Daniel');
    assert.equal(selectVoice(voices, 'zh-TW', '').id, 'Meijia');
    assert.equal(selectVoice(voices, 'zh-HK', '').id, 'Sinji');
    assert.equal(selectVoice(voices.filter(item => item.id !== 'Tingting'), 'zh', '').id, 'Meijia');
    assert.equal(selectVoice([{ id: 'Sinji', lang: 'zh-HK' }], 'zh', ''), undefined);
});
test('Manual voice is honored only for the spoken language', () => {
    assert.equal(selectVoice(voices, 'en', 'Daniel').id, 'Daniel');
    assert.equal(selectVoice(voices, 'zh', 'Samantha').id, 'Tingting');
    assert.equal(selectVoice(voices, 'en', 'Tingting').id, 'Samantha');
    assert.equal(selectVoice(voices, 'en', 'Removed voice').id, 'Samantha');
});
test('Windows and other installed voices match locale without macOS voice names', () => {
    const installed = [
        { id: 'Microsoft Hazel Desktop', lang: 'en-GB' },
        { id: 'Microsoft Zira Desktop', lang: 'en-US' },
        { id: 'Microsoft Huihui Desktop', lang: 'zh-CN' },
        { id: 'Thomas', lang: 'fr-FR' }
    ];
    assert.equal(selectVoice(installed, 'en', '').id, 'Microsoft Zira Desktop');
    assert.equal(selectVoice(installed, 'zh', '').id, 'Microsoft Huihui Desktop');
    assert.equal(selectVoice(installed, 'fr', '').id, 'Thomas');
    assert.equal(selectVoice(installed, 'ja', ''), undefined);
});
test('Fallback still uses an available same-language voice', () => {
    assert.equal(selectVoice([{ id: 'Albert', lang: 'en-US' }], 'en', '').id, 'Albert');
    assert.equal(selectVoice([], 'en', ''), undefined);
});

test('Login startup registers and removes Windows launch arguments consistently', () => {
    let enabled = false;
    const calls = [];
    const app = { isPackaged: true,
        getLoginItemSettings(options) {
            assert.deepEqual(options.args, ['--login-startup']);
            assert.equal(options.path, process.execPath);
            return { openAtLogin: enabled, executableWillLaunchAtLogin: enabled };
        },
        setLoginItemSettings(options) { calls.push(options); enabled = options.openAtLogin; }
    };
    assert.equal(setLoginItem(app, true, 'win32').enabled, true);
    assert.equal(setLoginItem(app, false, 'win32').enabled, false);
    assert.deepEqual(calls.map(item => item.enabled), [true, false]);
});
test('Login startup reports macOS approval and refuses silent failures or development registration', () => {
    let state = { openAtLogin: false, status: 'not-registered' };
    const app = { isPackaged: true, getLoginItemSettings: () => state,
        setLoginItemSettings() { state = { openAtLogin: false, status: 'requires-approval' }; } };
    assert.match(setLoginItem(app, true, 'darwin').message, /登录项/);
    app.setLoginItemSettings = () => { state = { openAtLogin: false }; };
    assert.throws(() => setLoginItem(app, true, 'darwin'), /未接受/);
    app.isPackaged = false;
    assert.equal(loginItemState(app, 'darwin').supported, false);
    assert.throws(() => setLoginItem(app, true, 'darwin'), /安装/);
});
