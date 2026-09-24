const fs = require('node:fs');
const path = require('node:path');
const { defaultShortcuts, validateShortcuts } = require('./shortcuts.cjs');

const defaults = {
    provider: 'baidu', from: 'auto', to: 'auto', autoSpeak: false,
    programmerMode: false, startAtLogin: false, translateKey: 'enter',
    speakTarget: 'source', voice: '', rate: 1, showDockIcon: false, shortcuts: defaultShortcuts,
};

function validateSettings(input) {
    if (!input || !['baidu', 'google'].includes(input.provider) || typeof input.autoSpeak !== 'boolean' ||
        !['source', 'translation'].includes(input.speakTarget) || typeof input.voice !== 'string' ||
        input.voice.length > 300 || !Number.isFinite(input.rate) || input.rate < 0.5 || input.rate > 2 ||
        (input.translateKey !== undefined && !['enter', 'modifier-enter'].includes(input.translateKey)) ||
        (input.programmerMode !== undefined && typeof input.programmerMode !== 'boolean') ||
        (input.startAtLogin !== undefined && typeof input.startAtLogin !== 'boolean') ||
        (input.showDockIcon !== undefined && typeof input.showDockIcon !== 'boolean')) {
        throw new Error('设置内容无效。');
    }
    return { ...defaults, provider: input.provider, autoSpeak: input.autoSpeak,
        translateKey: input.translateKey ?? 'enter',
        programmerMode: input.programmerMode ?? false, startAtLogin: input.startAtLogin ?? false,
        speakTarget: 'source', voice: input.voice, rate: input.rate, showDockIcon: input.showDockIcon ?? false, shortcuts: validateShortcuts(input.shortcuts) };
}

class SettingsStore {
    constructor(directory, encryption) {
        this.file = path.join(directory, 'settings.json');
        this.encryption = encryption;
        this.preferences = { ...defaults };
        this.credentials = { baidu: { appId: '', secret: '' }, google: { key: '' } };
    }
    async load() {
        let stored;
        try { stored = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return; throw new Error('本地设置无法读取，请检查设置文件。'); }
        this.preferences = validateSettings(stored.preferences);
        if (stored.credentials) {
            try {
                const decrypted = await this.encryption.decryptStringAsync(Buffer.from(stored.credentials, 'base64'));
                this.credentials = JSON.parse(decrypted.result);
            } catch { throw new Error('密钥无法解密，请在设置中重新填写并保存。'); }
        }
    }
    publicSettings() {
        return { ...this.preferences, shortcuts: { ...this.preferences.shortcuts }, appId: this.credentials.baidu.appId,
            hasBaiduSecret: Boolean(this.credentials.baidu.secret), hasGoogleKey: Boolean(this.credentials.google.key) };
    }
    async save(input) {
        const preferences = validateSettings(input);
        const credentials = structuredClone(this.credentials);
        for (const field of ['appId', 'baiduSecret', 'googleKey']) {
            if (typeof input[field] !== 'string' || input[field].length > 1000) throw new Error('API 凭据格式无效。');
        }
        credentials.baidu.appId = input.appId.trim();
        if (input.baiduSecret.trim()) credentials.baidu.secret = input.baiduSecret.trim();
        if (input.googleKey.trim()) credentials.google.key = input.googleKey.trim();
        if (input.clearBaidu) credentials.baidu = { appId: '', secret: '' };
        if (input.clearGoogle) credentials.google.key = '';
        if (!await this.encryption.isAsyncEncryptionAvailable()) throw new Error('系统密钥存储不可用，未保存设置。');
        const encrypted = await this.encryption.encryptStringAsync(JSON.stringify(credentials));
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const temporary = this.file + '.tmp';
        fs.writeFileSync(temporary, JSON.stringify({ preferences, credentials: encrypted.toString('base64') }, null, 4), { mode: 0o600 });
        fs.renameSync(temporary, this.file);
        this.preferences = preferences;
        this.credentials = credentials;
        return this.publicSettings();
    }
}

module.exports = { SettingsStore, validateSettings, defaults };
