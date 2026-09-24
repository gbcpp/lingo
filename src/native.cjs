const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function powershellArgs(script) {
    return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
}

async function readClipboardSnapshot(clipboard) {
    const { ClipboardItem } = require('electron');
    const items = await clipboard.read();
    return Promise.all(items.map(async item => new ClipboardItem(Object.fromEntries(
        await Promise.all(item.types.map(async type => [type, await item.getType(type)]))
    ))));
}

async function selectedText(clipboard, platform, systemPreferences) {
    if (platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
        throw new Error('请在系统设置 → 隐私与安全性 → 辅助功能中允许 Lingo，然后重新尝试。');
    }
    let macScript, targetPid;
    if (platform === 'darwin') {
        macScript = require('node:fs').readFileSync(require('node:path').join(__dirname, 'selection-macos.js'), 'utf8');
        try {
            const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macScript, 'read'], { timeout: 5000 });
            const selection = JSON.parse(stdout);
            if (selection.text) return selection.text;
            targetPid = selection.pid;
            if (!targetPid) return '';
        } catch {
            throw new Error('无法读取选中文字。请在系统设置 → 隐私与安全性中允许 Lingo 的辅助功能，以及自动化 → System Events 权限。更新应用后请退出并重新打开 Lingo。');
        }
    } else {
        await delay(200);
    }
    const original = await readClipboardSnapshot(clipboard);
    let captured = '';
    clipboard.clear();
    try {
        if (platform === 'darwin') {
            const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', macScript, 'copy', String(targetPid)], { timeout: 5000 });
            if (stdout.trim() !== 'copied') return '';
        } else if (platform === 'win32') {
            await execute('powershell.exe', powershellArgs("Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')"), { timeout: 5000, windowsHide: true });
        } else throw new Error('划词翻译目前支持 macOS 和 Windows。');
        for (let i = 0; i < 20; i++) {
            await delay(60);
            captured = await clipboard.readText();
            if (captured) return captured;
        }
        return '';
    } catch (error) {
        if (error.code) throw new Error('无法复制选中文字，请检查系统辅助功能或自动化权限。');
        throw error;
    } finally {
        // Do not overwrite clipboard changes made after selection capture.
        if (await clipboard.readText() === captured) await clipboard.write(original);
    }
}

function loginItemState(app, platform = process.platform) {
    const supported = app.isPackaged && ['darwin', 'win32'].includes(platform);
    if (!supported) return { supported: false, enabled: false };
    const options = platform === 'win32' ? { path: process.execPath, args: ['--login-startup'] } : {};
    const state = app.getLoginItemSettings(options);
    const pending = state.status === 'requires-approval';
    return { supported, options, wasOpenedAtLogin: state.wasOpenedAtLogin,
        enabled: pending || (state.openAtLogin && (platform !== 'win32' || state.executableWillLaunchAtLogin)),
        message: pending ? '请在系统设置 → 通用 → 登录项中允许 Lingo 自动启动。' : '登录系统后自动启动并常驻菜单栏／托盘，不弹出翻译窗口。' };
}

function setLoginItem(app, enabled, platform = process.platform) {
    const previous = loginItemState(app, platform);
    if (!previous.supported) throw new Error('请安装打包后的应用，再设置开机自动启动。');
    app.setLoginItemSettings({ ...previous.options, openAtLogin: enabled,
        ...(platform === 'win32' ? { enabled } : {}) });
    const current = loginItemState(app, platform);
    if (Boolean(current.enabled) !== enabled) throw new Error('系统未接受开机启动设置，请确认应用已安装，并检查系统登录项权限。');
    return current;
}

function selectVoice(voices, lang, requestedVoice) {
    const locale = lang.toLowerCase().replaceAll('_', '-');
    const language = locale.split('-')[0];
    const matching = voices.filter(item => item.lang.toLowerCase().split('-')[0] === language);
    const requested = matching.find(item => item.id === requestedVoice);
    if (requested) return requested;
    const preferredLocale = { en: 'en-us', zh: 'zh-cn' }[locale] || locale;
    // Generic Chinese means Mandarin; Cantonese requires an explicit locale or voice.
    const candidates = language === 'zh' && !['zh-hk', 'zh-mo'].includes(locale)
        ? matching.filter(item => !/^zh-(hk|mo)$/i.test(item.lang)) : matching;
    const exact = candidates.filter(item => item.lang.toLowerCase() === preferredLocale);
    const preferred = language === 'en' ? ['Samantha', 'Alex', 'Daniel', 'Karen', 'Moira', 'Tessa', 'Rishi']
        : language === 'zh' ? ['Tingting', 'Meijia', 'Sinji'] : [];
    const characterVoice = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Eddy|Flo|Fred|Good News|Grandma|Grandpa|Jester|Junior|Kathy|Organ|Superstar|Ralph|Reed|Rocko|Sandy|Shelley|Trinoids|Whisper|Wobble|Zarvox)(?:$|[ (])/i;
    const best = items => preferred.map(name => items.find(item => item.id === name)).find(Boolean)
        || items.find(item => !characterVoice.test(item.id));
    return best(exact) || best(candidates) || exact[0] || candidates[0];
}

class Speech {
    constructor(platform = process.platform) {
        this.platform = platform;
        this.process = null;
        this.cachedVoices = null;
        this.generation = 0;
    }
    async voices() {
        if (this.cachedVoices) return this.cachedVoices;
        if (this.platform === 'darwin') {
            const { stdout } = await execute('/usr/bin/say', ['-v', '?'], { timeout: 8000 });
            this.cachedVoices = stdout.split('\n').map(line => {
                const match = line.match(/^(.+?)\s+([a-z]{2,3}_[A-Za-z_]+)\s+#/);
                return match ? { id: match[1].trim(), name: match[1].trim(), lang: match[2].replaceAll('_', '-') } : null;
            }).filter(Boolean);
        } else if (this.platform === 'win32') {
            const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
Add-Type -AssemblyName System.Speech;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
@($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
    @{ id = $_.VoiceInfo.Name; name = $_.VoiceInfo.Name; lang = $_.VoiceInfo.Culture.Name }
}) | ConvertTo-Json -Compress;
$synth.Dispose();`;
            const { stdout } = await execute('powershell.exe', powershellArgs(script), { timeout: 10000, windowsHide: true });
            const data = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
            this.cachedVoices = Array.isArray(data) ? data : [data];
        } else this.cachedVoices = [];
        return this.cachedVoices;
    }
    stop() {
        this.generation++;
        if (this.process) this.process.kill();
        this.process = null;
    }
    async speak({ text, lang, voice, rate }) {
        if (typeof text !== 'string' || !text.trim() || text.length > 12000 ||
            typeof lang !== 'string' || !Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error('朗读参数无效。');
        this.stop();
        const generation = this.generation;
        const voices = await this.voices();
        if (generation !== this.generation) return;
        const selected = selectVoice(voices, lang, voice);
        if (!selected) throw new Error('未找到对应语言的系统语音，请在系统设置中安装该语言的语音。');
        return new Promise((resolve, reject) => {
            let child;
            if (this.platform === 'darwin') {
                child = spawn('/usr/bin/say', ['-v', selected.id, '-r', String(Math.round(180 * rate))], { stdio: ['pipe', 'ignore', 'pipe'] });
                child.stdin.end(text);
            } else {
                const script = `[Console]::InputEncoding = [System.Text.Encoding]::UTF8;
$ErrorActionPreference = 'Stop';
Add-Type -AssemblyName System.Speech;
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json;
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
try { $synth.SelectVoice($payload.voice); $synth.Rate = [int]$payload.rate; $synth.Speak([string]$payload.text) }
finally { $synth.Dispose() }`;
                child = spawn('powershell.exe', powershellArgs(script), { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
                child.stdin.end(JSON.stringify({ text, voice: selected.id, rate: Math.max(-10, Math.min(10, Math.round(10 * Math.log2(rate)))) }));
            }
            this.process = child;
            child.stdin.on('error', () => {});
            child.on('error', () => reject(new Error('系统朗读启动失败，请检查语音是否可用。')));
            child.on('exit', (code, signal) => {
                if (this.process === child) this.process = null;
                if (code === 0 || signal || code === null) resolve();
                else reject(new Error('系统朗读未完成，请检查语音设置。'));
            });
        });
    }
}

module.exports = { readClipboardSnapshot, selectedText, Speech, powershellArgs, selectVoice, loginItemState, setLoginItem };
