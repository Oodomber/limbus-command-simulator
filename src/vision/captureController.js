'use strict';

/**
 * src/vision/captureController.js — 阶段 0：游戏窗口采集器
 *
 * 目标
 *   1. 只捕获「游戏窗口」，绝不让软件自己的窗口进入画面（旧 mss 全屏方案的致命 bug）
 *   2. 允许按「环节」把帧存成带标签的数据集，供后续离线回放调阈值
 *   3. 零外部依赖：只用 Electron 内置 desktopCapturer + getUserMedia
 *
 * 取帧路径（首选）
 *   主进程 desktopCapturer.getSources({types:['window']}) 拿到游戏窗口的 sourceId
 *   → 渲染进程 getUserMedia({video:{mandatory:{chromeMediaSource:'desktop', chromeMediaSourceId}}})
 *   → <video> 保留 MediaStream
 *   → 需要时 drawImage 到离屏 canvas → toDataURL('image/png') → IPC 回主进程落盘
 *
 * 降级路径（getUserMedia 被拒时）
 *   主进程 desktopCapturer.getSources({thumbnailSize:{1920x1080}}) 直接取缩略图
 *
 * 数据结构
 *   datasets/
 *     frames/<phase>/<YYYYMMDD-HHMMSS-mmm>.png
 *     manifest.jsonl            每行一条 {file, phase, ts, width, height, source}
 */

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  globalShortcut,
  screen,
  shell,
} = require('electron');

// 与 runState 中的地牢环节保持一致（见 main.js scheduleAutoDetect 的 dungeonPhases）
const PHASES = [
  { id: 'cardpack',      label: '卡包选择', hint: '选卡包页：顶部有「选择N层主题卡包」橙金大标题' },
  { id: 'route',         label: '路线',     hint: '地牢地图 / 选择下一个节点' },
  { id: 'combat',        label: '战斗',     hint: '战斗界面（指令选择）：左上 WAVE x/x 与 TURN n 铭牌' },
  { id: 'combat_battle', label: '战斗交战', hint: '交战进行中：左上铭牌消失，右上只剩暂停按钮与绿色齿轮' },
  { id: 'event',         label: '事件',     hint: '事件对话与选项列表' },
  { id: 'judgment',      label: '判定',     hint: '判定环节（能力检定动画 / 结果页）' },
  { id: 'event_reward',  label: '奖励卡',   hint: '事件结束后的奖励卡选择' },
  { id: 'shop',          label: '商店',     hint: '商店页：4 列 × 最多 3 行饰品网格' },
  { id: 'boss_reward',   label: '关底奖励', hint: '关底饰品奖励 / 关卡饰品奖励' },
];

const PHASE_IDS = PHASES.map((p) => p.id);
const OPEN_HOTKEY = 'F7';
const SAVE_HOTKEY = 'F8';

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function stamp(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}` +
    `-${pad(date.getMilliseconds(), 3)}`
  );
}

class CaptureController {
  constructor(options = {}) {
    this.datasetRoot =
      options.datasetRoot ||
      (app.isPackaged
        ? path.join(app.getPath('userData'), 'datasets')
        : path.join(app.getAppPath(), 'datasets'));

    this.framesRoot = path.join(this.datasetRoot, 'frames');
    this.manifestPath = path.join(this.datasetRoot, 'manifest.jsonl');

    this.window = null;
    this.sourceId = null;
    this.sourceName = '';
    this.phase = PHASE_IDS[0];
    this.savedCount = 0;
    this.transport = 'none'; // 'stream' | 'thumb' | 'none'

    this._pending = new Map();
    this._seq = 0;
    this._autoTimer = null;
    this._autoBusy = false;
    this._autoInterval = 1500;
    this._ipcReady = false;
    this._openHotkeyOk = false;
    this._saveHotkeyOk = false;
  }

  // ── 初始化：只注册 IPC 与打开热键，不创建窗口 ──
  init() {
    if (this._ipcReady) return;
    this._ipcReady = true;

    fs.mkdirSync(this.framesRoot, { recursive: true });

    ipcMain.handle('vision2:open', () => this.open());
    ipcMain.handle('vision2:phases', () => PHASES);
    ipcMain.handle('vision2:list-windows', () => this.listWindows());
    ipcMain.handle('vision2:attach', (_e, sourceId, name) => this.attach(sourceId, name));
    ipcMain.handle('vision2:detach', () => this.detach());
    ipcMain.handle('vision2:set-phase', (_e, phase) => this.setPhase(phase));
    ipcMain.handle('vision2:save-frame', (_e, label) => this.saveFrame(label));
    ipcMain.handle('vision2:auto', (_e, on, intervalMs) => this.setAuto(on, intervalMs));
    ipcMain.handle('vision2:open-dir', () => this.openDatasetDir());
    ipcMain.handle('vision2:stats', () => this.stats());
    ipcMain.handle('vision2:grab-thumb', () => this.grabViaThumb());

    ipcMain.on('vision2:frame', (_e, payload) => this._onFrame(payload));
    ipcMain.on('vision2:capture-error', (_e, payload) => this._onCaptureError(payload));
    ipcMain.on('vision2:attached', (_e, payload) => this._onAttached(payload));

    this._registerOpenHotkey();
    console.log('[vision2] capture controller ready, dataset root =', this.datasetRoot);

    // 开发期便利开关：VISION2_AUTOPEN=1 启动后自动打开采集面板
    if (!app.isPackaged && process.env.VISION2_AUTOPEN === '1') {
      setTimeout(() => this.open(), 1200);
    }
  }

  // ── 面板窗口 ──
  open() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      this.window.focus();
      return { ok: true, reopened: true };
    }

    // 固定停在副屏/主屏右侧，避免每次打开位置漂移或掉出屏幕底边
    const PANEL_W = 384;
    const PANEL_H = 744;
    let px;
    let py;
    try {
      const wa = screen.getPrimaryDisplay().workArea;
      px = wa.x + wa.width - PANEL_W - 24;
      py = wa.y + 32;
    } catch (_e) {
      px = undefined;
      py = undefined;
    }

    this.window = new BrowserWindow({
      width: PANEL_W,
      height: PANEL_H,
      x: px,
      y: py,
      minWidth: 340,
      minHeight: 520,
      frame: false,
      hasShadow: true,
      resizable: true,
      skipTaskbar: false,
      alwaysOnTop: true,
      backgroundColor: '#14121a',
      title: '视觉采集',
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    this.window.setMenuBarVisibility(false);
    this.window.loadFile(path.join(__dirname, '..', '..', 'renderer', 'captureTool.html'));

    // 开发期把渲染进程日志转到主进程控制台，便于排查
    if (!app.isPackaged) {
      this.window.webContents.on('console-message', (_e, level, message) => {
        console.log('[vision2/renderer]', message);
      });
    }
    // 'screen-saver' 层级可压在无边框全屏的游戏之上
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.window.on('closed', () => {
      this.window = null;
      this.setAuto(false);
      this.detach();
      this._unregisterSaveHotkey();
    });

    // 开发期自检：VISION2_AUTOCONNECT=1 时自动连第一个窗口并落一张帧
    if (!app.isPackaged && process.env.VISION2_AUTOCONNECT === '1') {
      this.window.webContents.once('did-finish-load', async () => {
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const wins = await this.listWindows();
          console.log('[vision2/autotest] windows =', wins.map((w) => w.name));
          const target = wins.find((w) => w.isGame && !w.blank) ||
            wins.find((w) => !w.blank) ||
            wins[0];
          if (!target) return console.log('[vision2/autotest] 没有可捕获窗口');
          this.attach(target.id, target.name);
          await new Promise((r) => setTimeout(r, 2500));
          console.log('[vision2/autotest] transport =', this.transport);
          const r = await this.saveFrame('cardpack');
          console.log('[vision2/autotest] saveFrame =>', JSON.stringify(r));
        } catch (e) {
          console.log('[vision2/autotest] 失败:', e.message);
        }
      });
    }

    return { ok: true };
  }

  // ── 枚举可捕获的窗口 ──
  async listWindows() {
    const own = new Set();
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w || w.isDestroyed()) continue;
      try {
        const id = w.getMediaSourceId();
        if (id) own.add(id);
      } catch (_e) {
        /* 某些窗口类型没有 mediaSourceId，忽略 */
      }
    }

    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 360, height: 202 },
      fetchWindowIcons: false,
    });

    const out = [];
    for (const s of sources) {
      if (!s.name || own.has(s.id)) continue;
      let thumb = null;
      // 缩略图近全黑/全透明 —— 这类窗口（NVIDIA 覆盖层、IME、Program Manager 等）
      // ?WGC 抓取时只会不断报 ProcessFrame failed，或者干脆给一张空白图
      const blank = this._looksBlank(s.thumbnail);
      try {
        if (s.thumbnail && !s.thumbnail.isEmpty()) thumb = s.thumbnail.toDataURL();
      } catch (_e) {
        /* 空缩略图 */
      }
      out.push({
        id: s.id,
        name: s.name,
        thumbnail: thumb,
        blank,
        isGame: this._isGameWindow(s.name),
      });
    }

    // 排序：疑似游戏窗口最前，画面为空的排最后
    out.sort((a, b) => {
      if (a.blank !== b.blank) return Number(a.blank) - Number(b.blank);
      return Number(b.isGame) - Number(a.isGame);
    });
    return out;
  }

  /**
   * 判断一个窗口是不是「边狱巴士」游戏本体。
   *
   * 这里不能只用「名字里含 limbus」——机器上同时装着 Ahab Assistant Limbus Company
   * 这类第三方工具，标题里同样带 Limbus Company，会被误抓（实测就把它的窗口抓了进来，
   * 识别得分全在 0 附近）。游戏本体标题是 `LimbusCompany`，所以改成「以游戏名开头 +
   * 不命中黑名单」。
   */
  _isGameWindow(name) {
    if (!name) return false;
    const n = String(name).trim();
    if (/assistant|ahab|overlay|harness|deepseek|explorer|资源管理器|文件管理器|electron/i.test(n)) return false;
    return /^limbus\s*company\b/i.test(n) || /^limbuscompany\b/i.test(n) || /^边狱公司|^边狱巴士/.test(n);
  }

  /** 缩略图是否近全黑/全透明 —— 用来提前排除不可捕获的窗口 */
  _looksBlank(image) {
    if (!image || image.isEmpty()) return true;
    try {
      const size = image.getSize();
      const total = size.width * size.height;
      if (!total) return true;
      const bmp = image.getBitmap(); // BGRA
      if (!bmp || bmp.length < total * 4) return true;
      const step = Math.max(1, Math.floor(total / 8192));
      let bright = 0;
      let alpha = 0;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < total; i += step) {
        const o = i * 4;
        const lum = (bmp[o] * 114 + bmp[o + 1] * 587 + bmp[o + 2] * 299) / 1000;
        if (lum > 40) bright += 1;
        alpha += bmp[o + 3];
        sum += lum;
        n += 1;
      }
      // 只有零星几个亮点（鼠标指针）也算空白：亮像素占比 < 0.4% 且整体极暗
      return bright / Math.max(1, n) < 0.004 && sum / Math.max(1, n) < 16;
    } catch (_e) {
      return false;
    }
  }

  // ── 连接目标窗口 ──
  attach(sourceId, name) {
    if (!sourceId) return { ok: false, error: '未提供窗口 sourceId' };
    this.sourceId = sourceId;
    this.sourceName = name || '';
    this.transport = 'none';

    if (!this.window || this.window.isDestroyed()) return { ok: false, error: '采集面板未打开' };

    // 渲染进程负责 getUserMedia，主进程只下发目标
    this.window.webContents.send('vision2:do-attach', {
      sourceId,
      name: this.sourceName,
    });
    this._registerSaveHotkey();
    return { ok: true, sourceId, name: this.sourceName };
  }

  detach() {
    this.sourceId = null;
    this.sourceName = '';
    this.transport = 'none';
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('vision2:do-detach');
    }
    return { ok: true };
  }

  _onAttached(payload = {}) {
    this.transport = payload.transport || 'stream';
    this._broadcast({ transport: this.transport, width: payload.width, height: payload.height });
  }

  /** 面板窗口是否已经加载完（loadFile 是异步的，早发 IPC 会丢） */
  _waitPanelReady(timeoutMs = 8000) {
    return new Promise((resolve) => {
      const wc = this.window && !this.window.isDestroyed() ? this.window.webContents : null;
      if (!wc) return resolve(false);
      if (!wc.isLoading()) return resolve(true);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(finish, timeoutMs);
      wc.once('did-finish-load', finish);
    });
  }

  /** 等渲染进程把 MediaStream 接上（transport 从 none 变 stream/thumb） */
  _waitTransport(timeoutMs = 12000) {
    return new Promise((resolve) => {
      if (this.transport === 'stream' || this.transport === 'thumb') return resolve(true);
      const startedAt = Date.now();
      const tick = setInterval(() => {
        if (this.transport === 'stream' || this.transport === 'thumb') {
          clearInterval(tick);
          resolve(true);
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(tick);
          resolve(false);
        }
      }, 120);
    });
  }

  /**
   * 自动连接游戏窗口：没有面板就先开面板，挑「疑似游戏且画面不空」的窗口连上，
   * 并等到画面流真的就绪。用于「点开始一局后自动开启视觉」，玩家不需要按 F7。
   */
  async autoAttachGame({ timeoutMs = 12000 } = {}) {
    try {
      if (!this.window || this.window.isDestroyed()) this.open();
      const ready = await this._waitPanelReady(8000);
      if (!ready) return { ok: false, error: '采集面板未能加载' };

      const wins = await this.listWindows();
      // 只认游戏窗口。之前这里是「找不到游戏就退回第一个非空窗口」，
      // 结果把资源管理器/浏览器抓了进来——识别全错而且看不出原因。
      const games = wins.filter((w) => w.isGame);
      // 缩略图空白通常意味着独占全屏/最小化；独占全屏下 getUserMedia 反而可能成功，
      // 所以「名字对得上」就先用，缩略图是否空白只用来决定优先级。
      const target = games.find((w) => !w.blank) || games[0];
      if (!target) {
        const seen = wins.filter((w) => w.name).slice(0, 5).map((w) => w.name).join(' / ') || '（无）';
        return {
          ok: false,
          error: `没找到 LimbusCompany 游戏窗口（当前可捕获窗口：${seen}）`,
        };
      }
      if (target.blank) {
        console.log('[vision] 游戏窗口缩略图为空（可能独占全屏/最小化），仍尝试连接');
      }

      this.attach(target.id, target.name);
      const connected = await this._waitTransport(timeoutMs);
      return {
        ok: connected,
        name: target.name,
        transport: this.transport,
        error: connected ? null : '窗口已选中但画面流没有建立，请确认游戏不是独占全屏',
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  _onCaptureError(payload = {}) {
    const { reqId, error, fatal } = payload || {};
    if (reqId && this._pending.has(reqId)) {
      const p = this._pending.get(reqId);
      this._pending.delete(reqId);
      clearTimeout(p.timer);
      p.reject(new Error(error || '取帧失败'));
    }
    if (fatal) {
      this.transport = 'none';
      this._broadcast({ transport: 'none', error: error || '连接中断' });
    }
  }

  setPhase(phase) {
    if (!PHASE_IDS.includes(phase)) return { ok: false, error: `未知环节: ${phase}` };
    this.phase = phase;
    this._broadcast({ phase });
    return { ok: true, phase };
  }

  // ── 向渲染进程要一帧 ──
  _requestFrame(timeoutMs = 6000, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this.window || this.window.isDestroyed()) {
        return reject(new Error('采集面板未打开'));
      }
      if (!this.sourceId) return reject(new Error('尚未连接游戏窗口'));

      const reqId = ++this._seq;
      const timer = setTimeout(() => {
        this._pending.delete(reqId);
        reject(new Error('取帧超时（游戏窗口是否已最小化？）'));
      }, timeoutMs);

      this._pending.set(reqId, { resolve, reject, timer });
      // live=true 用于实时识别：只要 1280 宽的 JPEG，编码耗时从 ~200ms 降到 ~10ms。
      // 存数据集时仍是原分辨率 PNG。
      const live = !!opts.live;
      this.window.webContents.send('vision2:grab', { reqId, live });
    });
  }

  _onFrame(payload = {}) {
    const { reqId, dataURL, width, height, error, blank } = payload || {};
    const p = this._pending.get(reqId);
    if (!p) return;
    this._pending.delete(reqId);
    clearTimeout(p.timer);
    if (error) p.reject(new Error(error));
    else p.resolve({ dataURL, width, height, blank: !!blank });
  }

  // ── 保存一张带标签的帧 ──
  async saveFrame(label) {
    const phase = PHASE_IDS.includes(label) ? label : this.phase;
    if (!this.sourceId) return { ok: false, error: '尚未连接游戏窗口' };

    let frame;
    try {
      frame = await this._requestFrame();
    } catch (e) {
      return { ok: false, error: e.message };
    }

    if (frame.blank) {
      const msg = '捕获到空白画面：该窗口可能不可捕获（透明覆盖层 / 已最小化），请改选游戏窗口';
      this._broadcast({ error: msg });
      return { ok: false, error: msg };
    }

    try {
      const dir = path.join(this.framesRoot, phase);
      fs.mkdirSync(dir, { recursive: true });
      const name = `${stamp()}.png`;
      const file = path.join(dir, name);
      const base64 = String(frame.dataURL).split(',')[1] || '';
      fs.writeFileSync(file, Buffer.from(base64, 'base64'));

      this.savedCount += 1;
      const entry = {
        file: path.relative(this.datasetRoot, file).replace(/\\/g, '/'),
        phase,
        ts: new Date().toISOString(),
        width: frame.width,
        height: frame.height,
        source: this.sourceName,
        transport: this.transport,
        appVersion: app.getVersion(),
      };
      fs.appendFileSync(this.manifestPath, JSON.stringify(entry) + '\n');

      this._broadcast({ saved: this.savedCount, lastFile: entry.file, phase });
      return { ok: true, file: entry.file, count: this.savedCount, width: frame.width, height: frame.height };
    } catch (e) {
      return { ok: false, error: `写入失败: ${e.message}` };
    }
  }

  // ── 连拍 ──
  setAuto(on, intervalMs) {
    if (intervalMs && Number.isFinite(intervalMs)) {
      this._autoInterval = Math.max(600, Math.round(intervalMs));
    }
    if (!on) {
      if (this._autoTimer) clearInterval(this._autoTimer);
      this._autoTimer = null;
      this._broadcast({ auto: false });
      return { ok: true, auto: false };
    }
    if (!this.sourceId) return { ok: false, error: '尚未连接游戏窗口' };
    if (this._autoTimer) clearInterval(this._autoTimer);

    this._autoTimer = setInterval(async () => {
      if (this._autoBusy) return;
      this._autoBusy = true;
      try {
        await this.saveFrame(this.phase);
      } catch (_e) {
        /* 单帧失败不影响连拍 */
      } finally {
        this._autoBusy = false;
      }
    }, this._autoInterval);

    this._broadcast({ auto: true, interval: this._autoInterval });
    return { ok: true, auto: true, interval: this._autoInterval };
  }

  // ── 降级：直接取窗口缩略图 ──
  async grabViaThumb() {
    if (!this.sourceId) return { ok: false, error: '尚未连接游戏窗口' };
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
      fetchWindowIcons: false,
    });
    const s = sources.find((x) => x.id === this.sourceId);
    if (!s || !s.thumbnail || s.thumbnail.isEmpty()) {
      return { ok: false, error: '缩略图捕获失败' };
    }
    const size = s.thumbnail.getSize();
    this.transport = 'thumb';
    return { ok: true, dataURL: s.thumbnail.toDataURL(), width: size.width, height: size.height };
  }

  stats() {
    const counts = {};
    for (const id of PHASE_IDS) {
      const dir = path.join(this.framesRoot, id);
      try {
        counts[id] = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length;
      } catch (_e) {
        counts[id] = 0;
      }
    }
    return {
      ok: true,
      phase: this.phase,
      phases: PHASES,
      sourceId: this.sourceId,
      sourceName: this.sourceName,
      transport: this.transport,
      datasetRoot: this.datasetRoot,
      counts,
      savedCount: this.savedCount,
      saveHotkey: SAVE_HOTKEY,
      auto: !!this._autoTimer,
      autoInterval: this._autoInterval,
    };
  }

  openDatasetDir() {
    fs.mkdirSync(this.framesRoot, { recursive: true });
    shell.openPath(this.datasetRoot);
    return { ok: true, path: this.datasetRoot };
  }

  // ── 热键 ──
  _registerOpenHotkey() {
    try {
      if (globalShortcut.isRegistered(OPEN_HOTKEY)) return;
      this._openHotkeyOk = globalShortcut.register(OPEN_HOTKEY, () => this.open());
    } catch (_e) {
      this._openHotkeyOk = false;
    }
    if (!this._openHotkeyOk) {
      console.warn(`[vision2] 无法注册 ${OPEN_HOTKEY}（可能被占用），请从控制面板打开采集器`);
    }
  }

  _registerSaveHotkey() {
    try {
      if (globalShortcut.isRegistered(SAVE_HOTKEY)) return;
      this._saveHotkeyOk = globalShortcut.register(SAVE_HOTKEY, () => {
        this.saveFrame(this.phase).catch(() => {});
      });
    } catch (_e) {
      this._saveHotkeyOk = false;
    }
    if (!this._saveHotkeyOk) {
      console.warn(`[vision2] 无法注册 ${SAVE_HOTKEY}，请用面板按钮保存`);
    }
  }

  _unregisterSaveHotkey() {
    try { globalShortcut.unregister(SAVE_HOTKEY); } catch (_e) { /* ignore */ }
    this._saveHotkeyOk = false;
  }

  /** 供外部（如 dev:enable-shortcuts）在被全局注销后重新注册 F7/F8。
   *  不这么做的话，开发面板开关一次快捷键就会把采集热键弄丢到重启为止。 */
  reregisterHotkeys() {
    this._registerOpenHotkey();
    this._registerSaveHotkey();
    return { open: !!this._openHotkeyOk, save: !!this._saveHotkeyOk };
  }

  _broadcast(payload) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('vision2:state', payload);
    }
  }

  destroy() {
    this.setAuto(false);
    this._unregisterSaveHotkey();
    try { globalShortcut.unregister(OPEN_HOTKEY); } catch (_e) { /* ignore */ }
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }
}

module.exports = { CaptureController, PHASES, PHASE_IDS, OPEN_HOTKEY, SAVE_HOTKEY };
