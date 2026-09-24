const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
    const result = await ipcRenderer.invoke(channel, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
};
contextBridge.exposeInMainWorld('lingo', {
    layout: input => invoke('window:layout', input), hide: () => invoke('window:hide'),
    settings: () => invoke('settings:get'), save: input => invoke('settings:save', input),
    voices: () => invoke('voices'), speak: input => invoke('speech:speak', input), stop: () => invoke('speech:stop'),
    pronunciation: input => invoke('pronunciation', input),
    translate: input => invoke('translate', input), cancel: () => invoke('translate:cancel'),
    readClipboard: () => invoke('clipboard:read'), copy: text => invoke('clipboard:write', text),
    capture: () => invoke('capture:start'), external: kind => invoke('external', kind), ready: () => invoke('ready'),
    onAction: callback => ipcRenderer.on('action', (_event, value) => callback(value)),
    onProgress: callback => ipcRenderer.on('ocr-progress', (_event, value) => callback(value)),
});
