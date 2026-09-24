const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, ...args) => {
    const result = await ipcRenderer.invoke(`capture:${name}`, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
};
contextBridge.exposeInMainWorld('capture', {
    bounds: () => invoke('bounds'), ready: () => invoke('ready'),
    onSelection: callback => ipcRenderer.on('capture:selection', (_event, rect) => callback(rect)),
    begin: point => invoke('begin', point), move: point => invoke('move', point),
    finish: point => invoke('finish', point), cancel: () => invoke('cancel'),
    recognize: image => invoke('recognize', image), error: () => invoke('error'),
    onCompose: callback => ipcRenderer.on('capture:compose', (_event, plan) => callback(plan)),
});
