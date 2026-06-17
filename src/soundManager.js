/**
 * SoundManager — sends sound names to overlay for playback.
 * Overlay has <audio> elements directly in HTML (no IPC file paths needed).
 */

class SoundManager {
  constructor(soundsDir) {
    this._overlayWindow = null;
  }

  setOverlay(win) { this._overlayWindow = win; }
  setMain(win) { this._mainWindow = win; }

  play(name) {
    try {
      if (this._overlayWindow && !this._overlayWindow.isDestroyed()) {
        this._overlayWindow.webContents.send('pager:play-sound', name);
      }
      if (this._mainWindow && !this._mainWindow.isDestroyed()) {
        this._mainWindow.webContents.send('pager:play-sound', name);
      }
    } catch {}
  }
}

module.exports = { SoundManager };
