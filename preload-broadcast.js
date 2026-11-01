// 广播横幅窗口的 preload：只暴露最少的一对事件通道
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('broadcastAPI', {
  onShow: (cb) => ipcRenderer.on('broadcast:show', (_e, data) => cb(data)),
  onHide: (cb) => ipcRenderer.on('broadcast:hide', () => cb()),
});
