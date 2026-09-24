const $ = id => document.getElementById(id);
const api = window.lingo;
const languages = { auto: '自动检测', zh: '简体中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语' };
let settings, revision = 0, result = null, speechRevision = 0;
let ocrRevision = -1;
let pronunciationRevision = 0, pronunciationTimer;

function refreshPronunciation(language = $('from').value, delay = 0) {
    clearTimeout(pronunciationTimer);
    const token = ++pronunciationRevision;
    const text = $('input').value.trim();
    $('pronunciation').hidden = true;
    $('pronunciationText').textContent = '';
    if (!text || new TextEncoder().encode(text).length > 6000) return;
    pronunciationTimer = setTimeout(async () => {
        try {
            const value = await api.pronunciation({ text, language });
            if (token !== pronunciationRevision || !value) return;
            $('pronunciationLabel').textContent = value.label;
            $('pronunciationText').textContent = value.text;
            $('pronunciation').hidden = false;
        } catch {
            if (token !== pronunciationRevision) return;
            $('pronunciationLabel').textContent = '注音';
            $('pronunciationText').textContent = '暂时无法生成注音';
            $('pronunciation').hidden = false;
        }
    }, delay);
}
let platform, defaultShortcuts;
const shortcutNames = { input: '显示翻译窗口', selection: '划词翻译', clipboard: '剪贴板翻译', capture: '截图翻译' };

function shortcutLabel(value) {
    return value.replace('CommandOrControl', platform === 'darwin' ? '⌘' : 'Ctrl')
        .replace('Alt', platform === 'darwin' ? '⌥' : 'Alt').replace('Shift', platform === 'darwin' ? '⇧' : 'Shift').replaceAll('+', ' ');
}
function renderShortcuts(values) {
    for (const [action, value] of Object.entries(values)) {
        const parts = value.split('+');
        $(`shortcut-${action}-key`).value = parts.pop();
        $(`shortcut-${action}-mod`).value = parts.join('+');
    }
}
function readShortcuts() {
    return Object.fromEntries(Object.keys(shortcutNames).map(action => [action,
        `${$(`shortcut-${action}-mod`).value}+${$(`shortcut-${action}-key`).value}`]));
}
function createShortcutFields() {
    const modifiers = ['CommandOrControl+Alt', 'CommandOrControl+Shift', 'CommandOrControl+Alt+Shift', 'Alt+Shift', 'Alt'];
    const keys = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`), 'Space'];
    for (const [action, name] of Object.entries(shortcutNames)) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const label = document.createElement('span');
        label.textContent = name;
        row.append(label);
        for (const [part, values] of [['mod', modifiers], ['key', keys]]) {
            const select = document.createElement('select');
            select.id = `shortcut-${action}-${part}`;
            select.setAttribute('aria-label', `${name}${part === 'mod' ? '修饰键' : '按键'}`);
            for (const value of values) select.add(new Option(part === 'mod' ? shortcutLabel(value) : value, value));
            row.append(select);
        }
        $('shortcutFields').append(row);
    }
}

let layoutFrame;
function scheduleLayout() {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
        const preferences = !$('settingsView').hidden;
        if (!preferences) {
            const input = $('input');
            input.style.height = '0px';
            input.style.height = `${Math.min(180, Math.max(50, input.scrollHeight))}px`;
        }
        const height = Math.ceil(document.querySelector('.window-bar').offsetHeight + document.querySelector('main').getBoundingClientRect().height);
        api.layout({ preferences, height }).catch(() => {});
    });
}
new ResizeObserver(scheduleLayout).observe(document.querySelector('main'));
const emptyMarkup = $('output').innerHTML;

function status(message, error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('error', error);
}
function switchView(preferences) {
    $('translateView').hidden = preferences;
    $('settingsView').hidden = !preferences;
    $('settingsTab').classList.toggle('active', preferences);
    $('translationTab').classList.toggle('active', !preferences);
    document.scrollingElement.scrollTop = 0;
    scheduleLayout();
}
function stop() {
    speechRevision++;
    api.stop().catch(error => status(error.message, true));
}
function invalidate() {
    revision++;
    result = null;
    refreshPronunciation($('from').value, 180);
    api.cancel().catch(() => {});
    stop();
    $('output').innerHTML = emptyMarkup;
    $('detected').textContent = '';
    $('speak').disabled = true;
    $('copy').disabled = true;
    $('copySource').disabled = !$('input').value;
    busy(false);
    scheduleLayout();
    $('count').textContent = `${new TextEncoder().encode($('input').value).length} / 6000 字节`;
}
function busy(value) {
    $('translate').disabled = value;
    $('cancel').hidden = !value;
}
async function speak(target = 'translation') {
    if (!result) return;
    const token = ++speechRevision;
    const source = target === 'source';
    status(source ? '正在朗读原文…' : '正在朗读译文…');
    try {
        await api.speak({ text: source ? result.source : result.text, lang: source ? result.from : result.to,
            voice: settings.voice, rate: settings.rate });
        if (token === speechRevision) status('朗读结束');
    } catch (error) { if (token === speechRevision) status(error.message, true); }
}
async function translate() {
    if (settings.programmerMode) $('input').value = normalizeCodeText($('input').value);
    const request = { text: $('input').value.trim(), provider: $('provider').value, from: $('from').value, to: $('to').value };
    request.to = translationTarget(request.text, request.from, request.to);
    invalidate();
    if (!request.text) return status('请输入、选取或粘贴要翻译的文字。', true);
    if (new TextEncoder().encode(request.text).length > 6000) return status('文字超过 6000 字节，请分段翻译。', true);
    const token = revision;
    busy(true);
    status('正在翻译…');
    try {
        const translated = await api.translate(request);
        if (token !== revision) return;
        // A detached textarea decodes entities without rendering remote markup.
        const decoder = document.createElement('textarea');
        decoder.innerHTML = request.provider === 'google' ? translated.text.replaceAll('<', '&lt;') : '';
        result = { ...translated, text: request.provider === 'google' ? decoder.value : translated.text, source: request.text };
        $('output').textContent = result.text;
        $('detected').textContent = `${languages[result.from] || result.from || '已检测'} → ${languages[result.to]}`;
        $('speak').disabled = false;
        $('copy').disabled = false;
        status('翻译完成');
        refreshPronunciation(result.from);
        if (settings.autoSpeak) void speak('source');
    } catch (error) {
        if (token === revision) status(error.message, true);
    } finally { if (token === revision) busy(false); }
}
async function fillAndTranslate(text) {
    switchView(false);
    $('input').value = text;
    await translate();
}
function renderSettings() {
    const modifier = platform === 'darwin' ? 'Command' : 'Ctrl';
    $('translateKey').value = settings.translateKey;
    $('translateKey').options[0].textContent = `Enter 翻译 · ${modifier}+Enter 换行`;
    $('translateKey').options[1].textContent = `${modifier}+Enter 翻译 · Enter 换行`;
    $('translateKey').title = $('translateKey').selectedOptions[0].textContent;
    $('enterShortcut').textContent = settings.translateKey === 'enter' ? 'Enter' : `${platform === 'darwin' ? '⌘' : 'Ctrl'} ↵`;
    $('input').title = $('translateKey').title;
    renderShortcuts(settings.shortcuts);
    $('selectionShortcut').textContent = shortcutLabel(settings.shortcuts.selection);
    $('captureShortcut').textContent = shortcutLabel(settings.shortcuts.capture);
    $('captureButton').title = `截图翻译 · ${shortcutLabel(settings.shortcuts.capture)}`;
    $('clipboardButton').title = `剪贴板翻译 · ${shortcutLabel(settings.shortcuts.clipboard)}`;
    $('showDockIcon').checked = settings.showDockIcon;
    $('programmerMode').checked = $('programmerModeQuick').checked = settings.programmerMode;
    $('startAtLogin').checked = settings.startAtLogin;
    if (settings.loginItemMessage) $('startupHelp').textContent = settings.loginItemMessage;
    $('defaultProvider').value = settings.provider;
    $('appId').value = settings.appId;
    $('baiduSecret').value = '';
    $('googleKey').value = '';
    $('baiduSecret').placeholder = settings.hasBaiduSecret ? '已保存；留空保留原密钥' : '填写百度密钥';
    $('googleKey').placeholder = settings.hasGoogleKey ? '已保存；留空保留原密钥' : '填写 Google API Key（可选）';
    $('clearBaidu').checked = false;
    $('clearGoogle').checked = false;
    $('autoSpeak').checked = settings.autoSpeak;
    $('autoSpeakQuick').checked = settings.autoSpeak;
    $('rate').value = String(settings.rate);
    $('voice').value = settings.voice;
    $('speechSummary').textContent = `朗读原文 · ${settings.rate}×`;
}

for (const [code, name] of Object.entries(languages)) {
    $('from').add(new Option(name, code));
    $('to').add(new Option(code === 'auto' ? '自动中英互译' : name, code));
}
$('from').value = 'auto';
$('to').value = 'auto';
$('to').title = '自动中英互译：英文较多译成中文，中文较多译成英文；也可手动指定目标语言。';
$('input').addEventListener('input', () => { invalidate(); status('准备就绪'); });
for (const id of ['from', 'to', 'provider']) $(id).addEventListener('change', invalidate);
$('translate').onclick = translate;
$('cancel').onclick = () => { invalidate(); status('已取消翻译'); };
$('clear').onclick = () => { $('input').value = ''; invalidate(); status('准备就绪'); $('input').focus(); };
$('swap').onclick = () => {
    const from = $('from').value === 'auto' ? result?.from : $('from').value;
    if (!from || !languages[from] || from === 'auto') return status('请先翻译以检测语言，或手动选择原文语言。');
    const oldTarget = result?.to || translationTarget($('input').value, $('from').value, $('to').value);
    if (result) $('input').value = result.text;
    $('to').value = from;
    $('from').value = oldTarget;
    invalidate();
};
$('speak').onclick = () => speak();
$('stop').onclick = () => { stop(); status('已停止朗读'); };
$('copy').onclick = async () => {
    if (!result) return;
    try { await api.copy(result.text); status('译文已复制'); } catch (error) { status(error.message, true); }
};
$('copySource').onclick = async () => {
    try { await api.copy($('input').value); status('原文已复制'); } catch (error) { status(error.message, true); }
};
$('clipboardButton').onclick = async () => {
    try { await fillAndTranslate(await api.readClipboard()); } catch (error) { status(error.message, true); }
};
$('captureButton').onclick = async () => {
    invalidate();
    switchView(false);
    try { await api.capture(); } catch (error) { status(error.message, true); }
};
$('hideWindow').onclick = () => api.hide();
$('resetShortcuts').onclick = () => { renderShortcuts(defaultShortcuts); $('saveStatus').textContent = '已恢复默认组合，保存后生效'; };
$('settingsForm').onchange = () => { $('saveStatus').textContent = '有未保存的修改'; $('saveStatus').classList.remove('error'); };
$('settingsTab').onclick = () => { renderSettings(); switchView(true); };
$('translationTab').onclick = $('back').onclick = () => switchView(false);
$('baiduLink').onclick = () => api.external('baidu');
$('googleLink').onclick = () => api.external('google');
for (const [id, key] of [['autoSpeakQuick', 'autoSpeak'], ['programmerModeQuick', 'programmerMode'], ['translateKey', 'translateKey']]) {
    $(id).onchange = async () => {
        const next = key === 'translateKey' ? $(id).value : $(id).checked;
        $('autoSpeakQuick').disabled = $('programmerModeQuick').disabled = $('translateKey').disabled = true;
        try {
            settings = await api.save({ ...settings, [key]: next, baiduSecret: '', googleKey: '' });
            renderSettings();
            if (key === 'autoSpeak' && !next) stop();
            if (key === 'programmerMode') invalidate();
        } catch (error) { renderSettings(); status(error.message, true); }
        finally { $('autoSpeakQuick').disabled = $('programmerModeQuick').disabled = $('translateKey').disabled = false; }
    };
}
$('settingsForm').onsubmit = async event => {
    event.preventDefault();
    $('save').disabled = true;
    try {
        settings = await api.save({ ...settings, provider: $('defaultProvider').value, appId: $('appId').value,
            baiduSecret: $('baiduSecret').value, googleKey: $('googleKey').value,
            clearBaidu: $('clearBaidu').checked, clearGoogle: $('clearGoogle').checked,
            autoSpeak: $('autoSpeak').checked, speakTarget: 'source',
            programmerMode: $('programmerMode').checked, startAtLogin: $('startAtLogin').checked,
            voice: $('voice').value, rate: Number($('rate').value), shortcuts: readShortcuts(), showDockIcon: $('showDockIcon').checked });
        $('provider').value = settings.provider;
        invalidate();
        renderSettings();
        $('saveStatus').textContent = '已保存';
        $('saveStatus').classList.remove('error');
    } catch (error) { $('saveStatus').textContent = error.message; $('saveStatus').classList.add('error'); }
    finally { $('save').disabled = false; }
};
document.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && event.target === $('input') && settings && !event.shiftKey && !event.altKey) {
        const modifier = platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
        const plain = !event.metaKey && !event.ctrlKey;
        if (!modifier && !plain) return;
        const shouldTranslate = settings.translateKey === 'enter' ? plain : modifier;
        if (shouldTranslate) {
            event.preventDefault();
            if (!event.repeat && !$('translate').disabled) void translate();
        } else if (modifier) {
            event.preventDefault();
            const input = $('input');
            input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    if (event.key === 'Escape') { invalidate(); status('已取消'); void api.hide(); }
});

async function init() {
    const initial = await api.settings();
    settings = initial.settings;
    $('provider').value = settings.provider;
    platform = initial.platform;
    $('startAtLogin').disabled = !initial.loginItemSupported;
    if (!initial.loginItemSupported) $('startupHelp').textContent = '安装打包后的应用后，可启用开机自动启动。';
    $('dockSettings').hidden = platform !== 'darwin';
    defaultShortcuts = initial.defaultShortcuts;
    createShortcutFields();
    $('permissionHelp').textContent = initial.platform === 'darwin' ? 'macOS：划词需辅助功能／自动化权限；截图需屏幕录制权限。允许后如无法使用，请退出并重新启动。' : 'Windows：不能从权限更高的应用或禁止复制的控件中读取选区。请使用剪贴板或截图作为替代。';
    renderSettings();
    api.onAction(action => {
        if (action.type === 'text') void fillAndTranslate(action.text);
        else if (action.type === 'ocr-text' && ocrRevision === revision) void fillAndTranslate(action.text);
        else if (action.type === 'ocr-error' && ocrRevision === revision) status(action.text, true);
        else if (action.type === 'ocr-empty' && ocrRevision === revision) { ocrRevision = -1; status(''); }
        else if (action.type === 'ocr-text' || action.type === 'ocr-error' || action.type === 'ocr-empty') return;
        else if (action.type === 'error') { switchView(false); status(action.text, true); }
        else if (action.type === 'settings') { renderSettings(); switchView(true); }
        else if (action.type === 'ocr-start') { invalidate(); ocrRevision = revision; switchView(false); status('正在本机识别截图文字…'); }
        else { switchView(false); $('input').focus(); }
    });
    api.onProgress(value => { if (ocrRevision === revision) status(`本机 OCR：${Math.round(value.progress * 100)}%`); });
    if (initial.messages.length) status(initial.messages.join(' '), true);
    else if (!settings.hasBaiduSecret) status('首次使用请在“偏好设置”中填写翻译 API 凭据。');
    await api.ready();
    try {
        const voices = await api.voices();
        for (const voice of voices) $('voice').add(new Option(`${voice.name} · ${voice.lang}`, voice.id));
        $('voice').value = settings.voice;
    } catch { $('saveStatus').textContent = '系统语音列表读取失败；翻译仍可使用。'; }
}
init().catch(error => status(error.message, true));
