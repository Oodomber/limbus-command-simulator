// 广播横幅窗口的 preload：只暴露最少的事件通道
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('broadcastAPI', {
  onShow: (cb) => ipcRenderer.on('broadcast:show', (_e, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on('broadcast:hide', () => cb()),
  onPlaySound: (cb) => ipcRenderer.on('broadcast:play-sound', (_e, name) => cb(name)),
});
