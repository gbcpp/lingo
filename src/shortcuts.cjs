const defaultShortcuts = Object.freeze({
    input: 'CommandOrControl+Alt+A', selection: 'CommandOrControl+Alt+D',
    clipboard: 'CommandOrControl+Alt+C', capture: 'CommandOrControl+Alt+S',
});
const modifiers = ['CommandOrControl+Alt', 'CommandOrControl+Shift', 'CommandOrControl+Alt+Shift', 'Alt+Shift', 'Alt'];

function validateShortcuts(input = defaultShortcuts) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('快捷键设置无效。');
    const result = {};
    const used = new Set();
    for (const action of Object.keys(defaultShortcuts)) {
        const value = input[action];
        if (typeof value !== 'string') throw new Error('请为每项功能选择快捷键。');
        const parts = value.split('+');
        const key = parts.pop();
        if (!modifiers.includes(parts.join('+')) || !/^([A-Z0-9]|F([1-9]|1[0-2])|Space)$/.test(key)) {
            throw new Error('快捷键组合无效，请重新选择。');
        }
        if (used.has(value)) throw new Error('不同功能不能使用相同的快捷键。');
        used.add(value);
        result[action] = value;
    }
    return result;
}

async function saveShortcuts(registry, callbacks, previous, next, persist) {
    next = validateShortcuts(next);
    const installed = [];
    for (const key of Object.values(previous)) registry.unregister(key);
    try {
        for (const [action, key] of Object.entries(next)) {
            if (!registry.register(key, callbacks[action])) throw new Error(`快捷键 ${key} 被占用或不受系统支持，请更换组合。`);
            installed.push(key);
        }
        return await persist();
    } catch (error) {
        for (const key of installed) registry.unregister(key);
        const failed = [];
        for (const [action, key] of Object.entries(previous)) {
            try { if (!registry.register(key, callbacks[action])) failed.push(key); }
            catch { failed.push(key); }
        }
        if (failed.length) throw new Error(`${error.message} 部分原快捷键恢复失败：${failed.join('、')}，请通过托盘打开设置。`);
        throw error;
    }
}

module.exports = { defaultShortcuts, validateShortcuts, saveShortcuts };
