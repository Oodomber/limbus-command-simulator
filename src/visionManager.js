/**
 * visionManager.js — Manages the Python vision_server.py subprocess lifecycle.
 *
 * Communicates via newline-delimited JSON on stdin/stdout.
 * Each request gets a unique `reqId` echoed back in the response so we can
 * reliably match responses to pending promises even when responses arrive
 * out of order.
 */

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

// ── Constants ──
const DEFAULT_TIMEOUT = 15000;   // ms
const SHUTDOWN_TIMEOUT = 5000;   // ms — shorter for graceful shutdown

class VisionManager extends EventEmitter {
  /**
   * @param {string} userDataPath  — app.getPath('userData')
   * @param {string} bundledPath   — path to bundled data/ directory
   */
  constructor(userDataPath, bundledPath) {
    super();
    this._proc = null;
    this._available = false;
    this._pending = new Map();    // reqId -> { resolve, reject, timer }
    this._reqId = 0;
    this._pythonPath = null;      // resolved executable name: 'python' or 'python3'
    this._buffer = '';            // partial line buffer for stdout
    this._refsDir = path.join(userDataPath, 'refs');
    this._bundledDir = path.join(bundledPath, '..');  // app root
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Detect Python and spawn the vision server.
   * @returns {Promise<boolean>} true if the server started successfully
   */
  async start() {
    if (this._available) return true;

    // 1. Find Python executable
    if (!this._pythonPath) {
      this._pythonPath = await this._findPython();
      if (!this._pythonPath) {
        this.emit('error', 'Python 未安装或不在 PATH 中。请安装 Python 3.9+ 并添加到 PATH。');
        return false;
      }
    }

    // 2. Resolve server script path
    const scriptPath = path.join(this._bundledDir, 'tools', 'vision_server.py');

    // 3. Spawn
    try {
      this._proc = spawn(this._pythonPath, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this._bundledDir,
      });

      this._proc.on('exit', (code, signal) => {
        this._handleExit(code, signal);
      });

      this._proc.on('error', (err) => {
        this._handleError(err);
      });

      this._proc.stdout.on('data', (chunk) => {
        this._handleStdout(chunk);
      });

      this._proc.stderr.on('data', (chunk) => {
        // Log stderr for debugging but don't treat as fatal
        const msg = chunk.toString().trim();
        if (msg) console.log('[vision:stderr]', msg);
      });
    } catch (e) {
      this.emit('error', `无法启动 Python 进程: ${e.message}`);
      return false;
    }

    // 4. Health check
    try {
      const resp = await this._sendCommand('health_check', {}, 10000);
      if (resp.ok) {
        this._available = true;
        this.emit('status-changed', { available: true });
        console.log(`[vision] Server started — OpenCV ${resp.opencv_version}, ${resp.monitor_count} monitor(s)`);
        return true;
      } else {
        this.emit('error', `健康检查失败: ${resp.error}`);
        await this.stop();
        return false;
      }
    } catch (e) {
      this.emit('error', `启动超时或错误: ${e.message}`);
      await this.stop();
      return false;
    }
  }

  /**
   * Gracefully stop the Python server.
   */
  async stop() {
    if (!this._proc) return;

    // Reject all pending requests
    for (const [reqId, entry] of this._pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Vision server shutting down'));
    }
    this._pending.clear();

    // Try graceful shutdown
    try {
      await this._sendCommand('shutdown', {}, SHUTDOWN_TIMEOUT);
    } catch (e) {
      // Ignore — we'll kill anyway
    }

    // Force kill if still alive
    try {
      if (this._proc && !this._proc.killed) {
        this._proc.kill('SIGTERM');
        setTimeout(() => {
          if (this._proc && !this._proc.killed) {
            this._proc.kill('SIGKILL');
          }
        }, 2000);
      }
    } catch (e) { /* ignore */ }

    this._proc = null;
    this._available = false;
    this.emit('status-changed', { available: false });
    console.log('[vision] Server stopped');
  }

  /** Whether the Python server is currently running and healthy. */
  get available() {
    return this._available;
  }

  // ── Command shortcuts ───────────────────────────────────────────

  async detectPhase(opts = {}) {
    return this._sendCommand('detect_phase', opts);
  }

  async recognizeShop(opts = {}) {
    return this._sendCommand('recognize_shop', opts);
  }

  async calibrateCapture(region, label) {
    const savePath = path.join(this._refsDir, `${label}.png`);
    return this._sendCommand('calibrate_capture', { region, label, save_path: savePath });
  }

  async rebuildRelicIndex(sourceDir, destDir) {
    return this._sendCommand('rebuild_relic_icon_index', {
      source_dir: sourceDir,
      dest_dir: destDir || path.join(this._refsDir, 'relics'),
      target_size: [64, 64],
    });
  }

  async healthCheck() {
    return this._sendCommand('health_check');
  }

  // ── Internals ───────────────────────────────────────────────────

  /**
   * Find a working Python executable on the system PATH.
   * @returns {Promise<string|null>} 'python' or 'python3' or null
   */
  async _findPython() {
    for (const name of ['python', 'python3']) {
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn(name, ['--version'], { stdio: 'pipe' });
          proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
          proc.on('error', reject);
        });
        return name;
      } catch (e) {
        continue;
      }
    }
    return null;
  }

  /**
   * Send a JSON command and wait for the matching response.
   *
   * @param {string} action   — command action name
   * @param {object} params   — command parameters (merged with action + reqId)
   * @param {number} timeout  — timeout in ms
   * @returns {Promise<object>} parsed JSON response
   */
  _sendCommand(action, params = {}, timeout = DEFAULT_TIMEOUT) {
    if (!this._proc || this._proc.killed) {
      return Promise.reject(new Error('Vision server not running'));
    }

    const reqId = ++this._reqId;
    const cmd = { reqId, action, ...params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(reqId);
        reject(new Error(`Vision command "${action}" timed out after ${timeout}ms`));
      }, timeout);

      this._pending.set(reqId, { resolve, reject, timer });

      try {
        this._proc.stdin.write(JSON.stringify(cmd) + '\n');
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(reqId);
        reject(new Error(`Failed to write to vision server: ${e.message}`));
      }
    });
  }

  /**
   * Process a chunk of stdout data — split into JSON lines and resolve
   * pending promises by matching `reqId`.
   */
  _handleStdout(chunk) {
    this._buffer += chunk.toString();
    const lines = this._buffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    this._buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let resp;
      try {
        resp = JSON.parse(trimmed);
      } catch (e) {
        console.log('[vision:stdout] (unparseable):', trimmed.slice(0, 200));
        continue;
      }

      const reqId = resp.reqId;
      if (reqId && this._pending.has(reqId)) {
        const entry = this._pending.get(reqId);
        clearTimeout(entry.timer);
        this._pending.delete(reqId);
        if (resp.ok === false) {
          entry.reject(new Error(resp.error || 'Vision server returned error'));
        } else {
          entry.resolve(resp);
        }
      } else {
        // Unsolicited message (e.g. log) — ignore
        console.log('[vision:stdout] (unsolicited):', trimmed.slice(0, 200));
      }
    }
  }

  /**
   * Handle unexpected subprocess exit.
   */
  _handleExit(code, signal) {
    console.log(`[vision] Server exited (code=${code}, signal=${signal})`);
    this._proc = null;

    if (this._available) {
      this._available = false;
      this.emit('status-changed', { available: false });

      // Reject all pending requests
      for (const [reqId, entry] of this._pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Vision server exited unexpectedly (code=${code})`));
      }
      this._pending.clear();
    }
  }

  /**
   * Handle spawn error.
   */
  _handleError(err) {
    console.error('[vision] Spawn error:', err.message);
    this._proc = null;
    this._available = false;
    this.emit('status-changed', { available: false });
  }
}

module.exports = { VisionManager };
