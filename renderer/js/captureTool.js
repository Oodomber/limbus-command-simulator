/* renderer/js/captureTool.js — 视觉采集面板（Phase 0）
 *
 * 职责：
 *   1. 持有游戏窗口的 MediaStream（getUserMedia + chromeMediaSourceId）
 *   2. 响应主进程的取帧请求，把 PNG dataURL 回传
 *   3. 面板 UI：窗口选择、环节切换、手动/自动保存
 *
 * 为什么 MediaStream 放在这个可见窗口里而不是隐藏窗口：
 *   窗口捕获的目标是「游戏窗口」，与承载流的窗口无关 ——
 *   所以这个面板自己永远不可能被拍进画面（这正是旧 mss 方案的根本缺陷）。
 */

const api = window.electronAPI;

const $ = (id) => document.getElementById(id);

const els = {
  winSelect: $('winSelect'),
  btnRefresh: $('btnRefresh'),
  btnAttach: $('btnAttach'),
  connDot: $('connDot'),
  connState: $('connState'),
  preview: document.querySelector('.preview'),
  video: $('video'),
  sizeBadge: $('sizeBadge'),
  phaseGrid: $('phaseGrid'),
  phaseHint: $('phaseHint'),
  btnSave: $('btnSave'),
  btnAuto: $('btnAuto'),
  interval: $('interval'),
  status: $('status'),
  btnDir: $('btnDir'),
  btnClose: $('btnClose'),
  btnLive: $('btnLive'),
  liveInterval: $('liveInterval'),
  livePhase: $('livePhase'),
  liveScores: $('liveScores'),
};

// 环节中文名（与主进程 PHASES 的 label 保持一致）
const PHASE_LABEL = {
  cardpack: '卡包选择',
  route: '路线',
  combat: '战斗（指令选择）',
  combat_battle: '战斗（交战进行中）',
  event: '事件',
  judgment: '判定',
  event_reward: '奖励卡',
  shop: '商店',
  boss_reward: '关底奖励',
  combat_reward: '关卡饰品奖励',
};

let liveOn = false;

// 离屏画布：只在取帧时使用，不插入 DOM
const scratch = document.createElement('canvas');
const scratchCtx = scratch.getContext('2d', { alpha: false });

// 缩略探针画布：把画面降到 64×36 判断是不是空白帧
const probe = document.createElement('canvas');
probe.width = 64;
probe.height = 36;
const probeCtx = probe.getContext('2d', { alpha: false, willReadFrequently: true });

/** 判断一帧是不是「空白」——全黑/全透明/单色，说明窗口根本没被真正抓到
 *  注意不能只看 max-min：鼠标指针就是一个高亮像素，会把差值拉到 255。 */
function looksBlank(source) {
  try {
    probeCtx.drawImage(source, 0, 0, 64, 36);
    const d = probeCtx.getImageData(0, 0, 64, 36).data;
    let bright = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 114 + d[i + 1] * 587 + d[i + 2] * 299) / 1000;
      if (lum > 40) bright += 1;
      sum += lum;
      n += 1;
    }
    return bright / n < 0.004 && sum / n < 16;
  } catch (_e) {
    return false;
  }
}

const state = {
  phase: 'cardpack',
  phases: [],
  sourceId: null,
  sourceName: '',
  mode: 'none', // 'stream' | 'thumb' | 'none'
  stream: null,
  auto: false,
  saved: 0,
};

// ── 小工具 ──

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = 'status' + (kind ? ' ' + kind : '');
}

function setConn(kind, text) {
  els.connDot.className = 'dot' + (kind ? ' ' + kind : '');
  els.connState.textContent = text;
  els.connState.title = text;
}

function setPhaseHint() {
  const p = state.phases.find((x) => x.id === state.phase);
  els.phaseHint.textContent = p ? p.hint : '';
}

function renderPhases() {
  els.phaseGrid.innerHTML = '';
  for (const p of state.phases) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.dataset.phase = p.id;
    b.title = p.hint;
    if (p.id === state.phase) b.classList.add('active');
    b.addEventListener('click', () => selectPhase(p.id));
    els.phaseGrid.appendChild(b);
  }
  setPhaseHint();
}

async function selectPhase(id) {
  state.phase = id;
  for (const b of els.phaseGrid.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.phase === id);
  }
  setPhaseHint();
  await api.vision2SetPhase(id);
}

// ── 窗口枚举与连接 ──

async function refreshWindows() {
  els.winSelect.innerHTML = '<option value="">正在扫描…</option>';
  let list = [];
  try {
    list = await api.vision2ListWindows();
  } catch (e) {
    els.winSelect.innerHTML = '<option value="">扫描失败</option>';
    setStatus('窗口扫描失败: ' + e.message, 'err');
    return;
  }

  els.winSelect.innerHTML = '';
  if (!list.length) {
    els.winSelect.innerHTML = '<option value="">没找到可捕获的窗口</option>';
    return;
  }

  for (const w of list) {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = (w.isGame ? '★ ' : '') + w.name + (w.blank ? '（画面为空）' : '');
    els.winSelect.appendChild(opt);
  }

  const game = list.find((w) => w.isGame && !w.blank) || list.find((w) => !w.blank);
  if (game) {
    els.winSelect.value = game.id;
    if (game.isGame) setStatus(`已自动选中疑似游戏窗口：${game.name}`, 'warn');
  }
}

function stopStream() {
  if (state.stream) {
    for (const t of state.stream.getTracks()) {
      try { t.stop(); } catch (_e) { /* ignore */ }
    }
    state.stream = null;
  }
  els.video.srcObject = null;
  els.preview.classList.remove('live');
  els.sizeBadge.textContent = '';
}

function waitForVideoSize(timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (els.video.videoWidth > 0 && els.video.videoHeight > 0) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('等待画面超时'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function doAttach(sourceId, name) {
  stopStream();
  state.mode = 'none';
  setConn('warn', '连接中…');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 30,
        },
      },
    });

    state.stream = stream;
    els.video.srcObject = stream;
    await els.video.play();
    await waitForVideoSize();

    state.mode = 'stream';
    state.sourceId = sourceId;
    state.sourceName = name || '';

    const w = els.video.videoWidth;
    const h = els.video.videoHeight;
    els.preview.classList.add('live');
    els.sizeBadge.textContent = `${w}×${h}`;
    setConn('ok', name || '已连接');
    setStatus(`已连接（窗口流）· ${w}×${h}`, 'ok');
    api.vision2Attached({ transport: 'stream', width: w, height: h });
  } catch (e) {
    // 降级：主进程直接取窗口缩略图（帧率低、可能被缩放，仅作兜底）
    state.mode = 'thumb';
    state.sourceId = sourceId;
    state.sourceName = name || '';
    setConn('warn', '已连接（降级）');
    setStatus('窗口流失败，改用缩略图模式：' + e.message, 'warn');
    api.vision2Attached({ transport: 'thumb' });
  }
}

async function connectSelected() {
  const sourceId = els.winSelect.value;
  if (!sourceId) {
    setStatus('请先选择一个窗口', 'err');
    return;
  }
  const name = els.winSelect.selectedOptions[0]
    ? els.winSelect.selectedOptions[0].textContent.replace(/^★\s*/, '')
    : '';
  els.btnAttach.disabled = true;
  try {
    await api.vision2Attach(sourceId, name);
  } finally {
    els.btnAttach.disabled = false;
  }
}

// ── 取帧 ──

async function grabToDataURL() {
  if (state.mode === 'stream') {
    const w = els.video.videoWidth;
    const h = els.video.videoHeight;
    if (!w || !h) throw new Error('尚未收到画面');
    if (scratch.width !== w || scratch.height !== h) {
      scratch.width = w;
      scratch.height = h;
    }
    scratchCtx.drawImage(els.video, 0, 0, w, h);
    const blank = looksBlank(els.video);
    return { dataURL: scratch.toDataURL('image/png'), width: w, height: h, blank };
  }

  if (state.mode === 'thumb') {
    const r = await api.vision2GrabThumb();
    if (!r || !r.ok) throw new Error((r && r.error) || '缩略图捕获失败');
    els.sizeBadge.textContent = `${r.width}×${r.height}`;
    return { dataURL: r.dataURL, width: r.width, height: r.height, blank: false };
  }

  throw new Error('尚未连接游戏窗口');
}

async function handleGrab(reqId) {
  try {
    const frame = await grabToDataURL();
    api.vision2Frame({ reqId, ...frame });
  } catch (e) {
    api.vision2CaptureError({ reqId, error: e.message });
  }
}

async function saveOne() {
  if (state.mode === 'none') {
    setStatus('尚未连接游戏窗口', 'err');
    return;
  }
  els.btnSave.disabled = true;
  try {
    // 主进程会经由本窗口取帧，因此这里只发命令
    const r = await api.vision2SaveFrame(state.phase);
    if (!r || !r.ok) {
      setStatus('保存失败: ' + ((r && r.error) || '未知错误'), 'err');
      return;
    }
    state.saved = r.count;
    const short = String(r.file).split('/').pop();
    setStatus(`已保存 ${r.count} 张 · 最新 ${short}`, 'ok');
  } finally {
    els.btnSave.disabled = false;
  }
}

async function toggleAuto() {
  if (state.auto) {
    await api.vision2Auto(false);
    state.auto = false;
    els.btnAuto.classList.remove('on');
    els.btnAuto.textContent = '自动连拍';
    setStatus('已停止连拍');
    return;
  }
  const ms = Math.max(600, Number(els.interval.value) || 1500);
  const r = await api.vision2Auto(true, ms);
  if (!r || !r.ok) {
    setStatus('无法连拍: ' + ((r && r.error) || '未知错误'), 'err');
    return;
  }
  state.auto = true;
  els.btnAuto.classList.add('on');
  els.btnAuto.textContent = '停止连拍';
  setStatus(`连拍中，每 ${ms}ms 一张 → ${state.phase}`);
}

// ── 主进程事件 ──

function subscribe() {
  api.onVision2DoAttach((payload) => doAttach(payload.sourceId, payload.name));

  api.onVision2DoDetach(() => {
    stopStream();
    state.mode = 'none';
    state.sourceId = null;
    state.sourceName = '';
    setConn('', '未连接');
    setStatus('已断开');
  });

  api.onVision2Grab((payload) => handleGrab(payload.reqId));

  api.onVision2State((payload = {}) => {
    if (payload.phase) {
      state.phase = payload.phase;
      for (const b of els.phaseGrid.querySelectorAll('button')) {
        b.classList.toggle('active', b.dataset.phase === payload.phase);
      }
      setPhaseHint();
    }
    if (typeof payload.saved === 'number') {
      state.saved = payload.saved;
      const short = String(payload.lastFile || '').split('/').pop();
      setStatus(`已保存 ${payload.saved} 张 · 最新 ${short}`, 'ok');
    }
    if (payload.auto === false) {
      state.auto = false;
      els.btnAuto.classList.remove('on');
      els.btnAuto.textContent = '自动连拍';
    }
    if (payload.error) setStatus(payload.error, 'err');
  });
}

// ── 启动 ──

// ── 实时识别 ──
async function toggleLive() {
  if (!liveOn) {
    const res = await api.vision2LiveStart(Number(els.liveInterval.value) || 400);
    if (!res || !res.ok) {
      els.liveScores.textContent = '启动失败：' + ((res && res.error) || '未知错误');
      return;
    }
    liveOn = true;
    els.btnLive.textContent = '停止实时识别';
    els.btnLive.classList.add('on');
    pollLive();
  } else {
    await api.vision2LiveStop();
    liveOn = false;
    els.btnLive.textContent = '开始实时识别';
    els.btnLive.classList.remove('on');
    els.liveScores.textContent = '已停止';
  }
}

function readingsText(r) {
  if (!r) return '';
  if (r.error) return '读数失败：' + r.error;
  if (r.kind === 'shop') {
    const type = r.shopType === 'special' ? '特殊商店' : '普通商店';
    const dir = r.scroll ? `　上${r.scroll.moreAbove ? '有' : '无'}/下${r.scroll.moreBelow ? '有' : '无'}` : '';
    return `${type}${dir}`;
  }
  if (r.kind === 'event') return `选项 ${r.options}`;
  if (r.kind === 'cardpack') return `卡包 ${r.packs} 个`;
  if (r.kind === 'boss_reward') {
    if (r.rewardType === 'floor') {
      return `关底饰品奖励：${r.difficulty === 'hard' ? '四选二' : '三选一'}（苦难 ${r.hardshipScore}）`;
    }
    return `关卡饰品奖励：多选一（苦难 ${r.hardshipScore}）`;
  }
  return '';
}

async function pollLive() {
  if (!liveOn) return;
  try {
    const s = await api.vision2LiveStatus();
    const top = s.lastScores
      ? Object.entries(s.lastScores).sort((a, b) => b[1] - a[1]).slice(0, 3)
      : [];
    const cur = s.phase ? PHASE_LABEL[s.phase] || s.phase : '未定格';
    els.livePhase.textContent = `当前环节：${cur}　已处理 ${s.frames} 帧`;
    const rtxt = readingsText(s.lastReadings);
    els.liveScores.textContent = [rtxt, top.length ? top.map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ') : '']
      .filter(Boolean)
      .join('　|　') || '等待首帧…';
  } catch (e) {
    els.liveScores.textContent = '状态查询失败：' + e.message;
  }
  setTimeout(pollLive, 700);
}

async function init() {  els.btnRefresh.addEventListener('click', refreshWindows);
  els.btnAttach.addEventListener('click', connectSelected);
  els.btnSave.addEventListener('click', saveOne);
  els.btnAuto.addEventListener('click', toggleAuto);
  els.btnDir.addEventListener('click', () => api.vision2OpenDir());
  els.btnClose.addEventListener('click', () => window.close());
  els.btnLive.addEventListener('click', toggleLive);
  // 难度：开局设定，决定关底奖励是三选一还是四选二
  for (const btn of document.querySelectorAll('button.diff')) {
    btn.addEventListener('click', async () => {
      const v = btn.dataset.diff;
      try {
        await api.vision2SetDifficulty(v);
        for (const b of document.querySelectorAll('button.diff')) b.classList.toggle('active', b === btn);
      } catch (e) {
        els.liveScores.textContent = '设置难度失败：' + e.message;
      }
    });
  }
  if (api.onVision2Phase) {
    api.onVision2Phase((p) => {
      els.livePhase.textContent = `当前环节：${PHASE_LABEL[p.phase] || p.phase}（${p.from || '—'} → ${p.phase}）`;
    });
  }

  els.btnSave.disabled = true;
  subscribe();

  try {
    const stats = await api.vision2Stats();
    state.phases = stats.phases || [];
    state.phase = stats.phase || 'cardpack';
    state.saved = stats.savedCount || 0;
    renderPhases();
    els.interval.value = stats.autoInterval || 1500;
    if (stats.savedCount) setStatus(`已保存 ${stats.savedCount} 张`);
  } catch (e) {
    setStatus('初始化失败: ' + e.message, 'err');
  }

  await refreshWindows();
  els.btnSave.disabled = false;
  console.log('[captureTool] ready · phases:', state.phases.length, '· windows:', els.winSelect.options.length);
}

window.addEventListener('DOMContentLoaded', init);
