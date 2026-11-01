// 把采集器取到的帧喂进视觉管线，对外只暴露「现在在哪一页」
// 数据流：CaptureController._requestFrame() → nativeImage → 灰度 → VisionPipeline.classify()
const { nativeImage, ipcMain } = require('electron');
const { VisionPipeline } = require('./visionPipeline');
const { PHASES } = require('./stateMachine');
const readers = require('./readers');

const DEFAULT_INTERVAL = 400; // ms，250ms 采样太快，先按 2.5fps 起步
const MIN_CONFIDENT = 0.45;
const PRESENCE_THRESHOLD = 0.45; // 实测：三角存在 ≥0.78，不存在 ≤−0.07
// 「追加的苦难」：关底奖励 0.672~0.701，关卡饰品奖励 0.345，其他页 ≤0.448 —— 取中间
const HARDSHIP_THRESHOLD = 0.55;

class LiveVision {
  constructor(captureController, opts = {}) {
    this.cc = captureController;
    this.pipeline = new VisionPipeline(opts);
    this.interval = opts.intervalMs || DEFAULT_INTERVAL;
    this.timer = null;
    this.busy = false;
    this.running = false;
    this.lastPhase = null;
    this.lastResult = null;
    // 饰品奖励（关底/关卡）发过指令后上锁，避免弹窗遮挡导致重复发指令
    this._rewardLocked = false;
    this.history = [];
    this.window = null;
    this.errors = 0;
    this._subs = [];
    // 本次游玩的难度：开局设定、中途不改。决定关底奖励是三选一（普通）还是四选二（困难）。
    this.difficulty = opts.difficulty === 'hard' ? 'hard' : 'normal';
    this.persist = typeof opts.persist === 'function' ? opts.persist : null;
  }

  init() {
    ipcMain.handle('vision2:live-start', (_e, intervalMs) => this.start(intervalMs));
    ipcMain.handle('vision2:live-stop', () => this.stop());
    ipcMain.handle('vision2:live-status', () => this.status());
    ipcMain.handle('vision2:live-classify', () => this.classifyOnce());
    ipcMain.handle('vision2:set-difficulty', (_e, v) => this.setDifficulty(v));
  }

  /** 难度只能在开局设定；给定后关底奖励的卡片数与可选数就固定了 */
  setDifficulty(v) {
    this.difficulty = v === 'hard' ? 'hard' : 'normal';
    if (this.persist) this.persist('vision.difficulty', this.difficulty);
    return { ok: true, difficulty: this.difficulty };
  }

  setWindow(win) {
    this.window = win;
  }

  start(intervalMs) {
    if (intervalMs) this.interval = Math.max(120, Number(intervalMs) || DEFAULT_INTERVAL);
    if (this.running) return { ok: true, running: true, interval: this.interval };
    this.running = true;
    this.pipeline.reset();
    this.lastPhase = null;
    this._rewardLocked = false;
    this._loop();
    return { ok: true, running: true, interval: this.interval };
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return { ok: true, running: false };
  }

  _loop() {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.classifyOnce();
        this._failStreak = 0;
      } catch (e) {
        this.errors++;
        // 连续取帧失败通常意味着游戏窗口关了/最小化了。再继续空转只会
        // 每 400ms 报一次超时，所以到这里就停下来等用户重新连接。
        this._failStreak = (this._failStreak || 0) + 1;
        if (this._failStreak >= 5) {
          this.stop();
          this._emit({ phase: null, from: this.lastPhase, stopped: true, reason: '连续取帧失败，已停止实时识别' });
          return;
        }
      }
      this._loop();
    }, this.interval);
  }

  /** 抓一帧分类一次，返回 {ok, phase, changed, confident, scores} */
  async classifyOnce() {
    if (this.busy) return { ok: false, error: '上一帧还在处理' };
    if (!this.cc || !this.cc.sourceId) return { ok: false, error: '尚未连接游戏窗口' };
    this.busy = true;
    try {
      const frame = await this.cc._requestFrame(4000, { live: true });
      if (!frame || frame.blank) return { ok: false, error: '取到空白帧' };

      const img = nativeImage.createFromDataURL(frame.dataURL);
      if (img.isEmpty()) return { ok: false, error: '帧解码失败' };
      const { width, height } = img.getSize();
      const bmp = img.toBitmap(); // BGRA
      const n = width * height;
      const gray = new Float32Array(n);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        gray[i] = 0.114 * bmp[p] + 0.587 * bmp[p + 1] + 0.299 * bmp[p + 2];
      }

      const res = this.pipeline.classify(gray, width, height);
      this.lastResult = res;

      // 关底/关卡饰品奖励的画面锚点（底部「拒绝饰品」）在选完之后会被
      // 「获得饰品」弹窗遮住，弹窗消失后锚点又回来，于是同一个画面会被
      // 反复判成关底奖励、重复发指令。这里在发过一次之后直接停掉对这两个
      // 环节的判定，直到画面真的走到卡包/路线（= 已经进入下一个环节）。
      if (this._rewardLocked && res.phase === 'boss_reward') {
        return {
          ok: true,
          phase: this.lastPhase,
          changed: false,
          confident: false,
          suppressed: true,
          reason: '饰品奖励已发放，等离开该画面',
          scores: this._round(res.scores),
          readings: null,
          width,
          height,
        };
      }

      const confident = (res.confident === undefined ? true : res.confident) && res.phase !== null;

      // 只对当前环节算结构化读数，别的环节没必要花时间
      let readings = null;
      if (confident && res.phase) {
        try {
          readings = this._readings(gray, bmp, width, height, res.phase);
        } catch (e) {
          readings = { error: e.message };
        }
      }
      this.lastReadings = readings;

      // 「关卡饰品奖励」与「关底奖励」共用同一个锚点（底部都有「拒绝饰品」），
      // 靠卡片上有没有「追加的苦难」分开：有=关底，没有=关卡。
      // 这里只把对外报的环节名改掉，生成逻辑仍走 boss_reward。
      const reported = (res.phase === 'boss_reward' && readings && readings.rewardType === 'node')
        ? 'combat_reward'
        : res.phase;

      let changed = false;
      if (confident && reported && reported !== this.lastPhase) {
        // 饰品奖励发过指令后上锁；等真正走到卡包/路线再解锁
        if (reported === 'boss_reward' || reported === 'combat_reward') {
          this._rewardLocked = true;
        } else if (reported === 'cardpack' || reported === 'route') {
          this._rewardLocked = false;
        }
        const from = this.lastPhase;
        this.lastPhase = reported;
        changed = true;
        this.history.push({ from, to: reported, at: Date.now() });
        if (this.history.length > 200) this.history.shift();
        this._emit({ phase: reported, from, scores: this._round(res.scores), readings });
      }

      return {
        ok: true,
        phase: reported,
        changed,
        confident,
        reason: res.reason,
        scores: this._round(res.scores),
        readings,
        width,
        height,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      this.busy = false;
    }
  }

  /** 按环节算结构化读数：数格子、看标签 */
  _readings(gray, bmp, width, height, phase) {
    if (phase === 'shop') {
      const n = width * height;
      const rgba = new Uint8Array(n * 4);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        rgba[i * 4] = bmp[p + 2]; // BGR(A) -> RGB(A)
        rgba[i * 4 + 1] = bmp[p + 1];
        rgba[i * 4 + 2] = bmp[p];
        rgba[i * 4 + 3] = 255;
      }
      // 商店只判普通 / 特殊：商品格子会滚动、数量会变、已购会挪到末尾，一律不读。
      const shop = readers.readShopType(rgba, width, height);

      // 上下三角：有 = 那个方向还有内容（这是商店唯一能判断「能不能继续往下买」的依据）
      const up = this.pipeline.scorePresence(gray, width, height, 'shop_arrow_up');
      const down = this.pipeline.scorePresence(gray, width, height, 'shop_arrow_down');
      const present = (v) => (v === null ? null : v >= PRESENCE_THRESHOLD);
      const scroll = {
        upScore: up === null ? null : Math.round(up * 1000) / 1000,
        downScore: down === null ? null : Math.round(down * 1000) / 1000,
        moreAbove: present(up),
        moreBelow: present(down),
      };

      return { kind: 'shop', shopType: shop.type, redRatio: Math.round(shop.redRatio * 1000) / 1000, scroll };
    }
    if (phase === 'event') {
      const r = readers.countEventOptions(gray, width, height);
      return { kind: 'event', options: r.count };
    }
    if (phase === 'cardpack') {
      const r = readers.countCardpacks(gray, width, height);
      return { kind: 'cardpack', packs: r.count, ranges: r.runs.map((v) => v.map((n) => Math.round(n * 1000) / 1000)) };
    }
    if (phase === 'boss_reward') {
      // 关底奖励的每张卡底部都有「追加的苦难」；关卡饰品奖励没有。
      // 卡片数量不同 -> 标签横向位置会变，所以这个锚点带 scan 横扫。
      const h = this.pipeline.scorePresence(gray, width, height, 'boss_reward_hardship');
      const floor = h !== null && h >= HARDSHIP_THRESHOLD;
      const hard = this.difficulty === 'hard';
      return {
        kind: 'boss_reward',
        rewardType: floor ? 'floor' : 'node',
        hardshipScore: h === null ? null : Math.round(h * 1000) / 1000,
        difficulty: this.difficulty,
        // 关底：普通三选一、困难四选二；关卡：多选一
        cards: floor ? (hard ? 4 : 3) : null,
        picks: floor ? (hard ? 2 : 1) : 1,
      };
    }
    return null;
  }

  _round(scores) {    const out = {};
    for (const k of Object.keys(scores || {})) out[k] = Math.round(scores[k] * 1000) / 1000;
    return out;
  }

  _emit(payload) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('vision2:phase', payload);
    }
    // 主进程内部监听（自动推进指令用）
    for (const fn of this._subs) {
      try {
        // 订阅方可能是 async，同步 try/catch 接不住它的 rejection，得单独兜
        const r = fn(payload);
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch (_e) {
        // 订阅方抛错不能影响环节切换本身，也不要把它算进 this.errors（那是数字计数）
      }
    }
  }

  /** 订阅环节切换（返回取消函数） */
  onPhase(fn) {
    this._subs.push(fn);
    return () => {
      const i = this._subs.indexOf(fn);
      if (i >= 0) this._subs.splice(i, 1);
    };
  }

  status() {
    return {
      ok: true,
      running: this.running,
      interval: this.interval,
      phase: this.lastPhase,
      errors: this.errors,
      phases: PHASES,
      frames: this.pipeline.framesSeen,
      lastScores: this.lastResult ? this._round(this.lastResult.scores) : null,
      lastReadings: this.lastReadings || null,
      difficulty: this.difficulty,
      minScore: MIN_CONFIDENT,
      gate: this.gateReason || '',
    };
  }

  destroy() {
    this.stop();
  }
}

module.exports = { LiveVision };
