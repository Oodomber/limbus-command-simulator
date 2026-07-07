/**
 * orb.js — 悬浮球 v3：正九边形 + Canvas 眼睛 + 打字机 + 音频联动
 */

// ══════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════

const WIN_SIZE = 220;
const CX = WIN_SIZE / 2;          // 110
const CY = WIN_SIZE / 2;          // 110
const NONAGON_R = 100;           // 九边形顶点半径
const EYE_CENTER_DIST = 78;      // 眼睛中心到球心的距离
const EYE_OUTER_R = 11;          // 眼睛外圈半径
const EYE_INNER_R = 5;           // 瞳孔半径
const CENTER_BOX_W = 90;
const CENTER_BOX_H = 28;

// Audio files
const PHASE_AUDIO = {
  deploy_identity: '无我梦中.mp3',
  starlight: '阿鼻叫唤.mp3',
  starting_relic: '支离灭裂.mp3',
};
const COUNT_AUDIO = ['一.mp3','二.mp3','三.mp3','四.mp3','五.mp3','六.mp3','七.mp3','八.mp3','九.mp3'];
const FINAL_AUDIO = '啊，结果还是到了这一天啊.mp3';
const AUDIO_BASE = '../resources/sounds/';

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════

let phase = 'idle';              // 'idle' | 'identity_done' | 'starlight_done' | 'relic_done' | 'counting'
let eyesOpen = 0;               // 0-9
let eyesAnimating = [];         // { eyeIdx, startTime, duration } for eye-open animations
let typewriterActive = false;
let typewriterTarget = 'CLEAR';
let typewriterStartTime = 0;
let typewriterDuration = 2000;
let typewriterFadeOut = null;   // timeout ID
let allUnlocked = false;
let finalTextShown = false;
let drag = { active: false, moved: false, startX: 0, startY: 0, winX: 0, winY: 0 };
let dragEnabled = true;
let orbState = {};  // persistent state across expand/collapse cycles

// DOM
let orbView, orbCanvas, orbCtx, typewriterEl, centerBox, sgLabel;
const api = window.orbAPI || {};

// ══════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  orbView = document.getElementById('orb-view');
  orbCanvas = document.getElementById('orb-canvas');
  orbCtx = orbCanvas.getContext('2d');
  typewriterEl = document.getElementById('orb-typewriter');
  centerBox = document.getElementById('orb-center-box');
  sgLabel = document.getElementById('sg-label');

  resizeCanvas();
  drawFrame();

  setupDrag();
  setupIPC();

  console.log('Orb v3 initialized');
});

function resizeCanvas() {
  orbCanvas.width = WIN_SIZE * (window.devicePixelRatio || 1);
  orbCanvas.height = WIN_SIZE * (window.devicePixelRatio || 1);
  orbCanvas.style.width = WIN_SIZE + 'px';
  orbCanvas.style.height = WIN_SIZE + 'px';
  orbCtx.setTransform(1, 0, 0, 1, 0, 0);
  orbCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
}

function setupIPC() {
  // Phase complete (deploy_identity / starlight / starting_relic)
  if (api.onPhaseComplete) {
    api.onPhaseComplete((data) => {
      handlePhaseComplete(data.phase);
    });
  }

  // Dungeon instruction completed → open one eye
  if (api.onInstructionDone) {
    api.onInstructionDone(() => {
      handleInstructionDone();
    });
  }

  // New run started
  if (api.onRunState) {
    api.onRunState((active) => {
      if (active) {
        resetOrb();
        orbView.style.display = 'flex';
        resizeCanvas();
        drawFrame();
      }
    });
  }

  // Run ended — reset everything
  if (api.onReset) {
    api.onReset(() => {
      resetOrb();
    });
  }

  // Show orb when becoming visible
  if (api.onShow) {
    api.onShow(() => {
      orbView.style.display = 'flex';
      resizeCanvas();
      drawFrame();
    });
  }
}

// ══════════════════════════════════════════════
//  PHASE & INSTRUCTION HANDLERS
// ══════════════════════════════════════════════

function handlePhaseComplete(phaseName) {
  if (phaseName === 'deploy_identity') {
    phase = 'identity_done';
  } else if (phaseName === 'starlight') {
    phase = 'starlight_done';
  } else if (phaseName === 'starting_relic') {
    phase = 'relic_done';
    phase = 'counting';  // Enter counting mode for dungeon instructions
  } else {
    return;
  }

  // Play phase audio
  const audioFile = PHASE_AUDIO[phaseName];
  if (audioFile) playSound(audioFile);

  // Trigger typewriter "CLEAR"
  startTypewriter('CLEAR');
}

function handleInstructionDone() {
  if (phase !== 'counting') return;
  if (eyesOpen >= 9) return;  // All eyes already open

  const idx = eyesOpen;  // 0-based index for the next eye
  eyesOpen++;

  // Start eye-opening animation
  const now = performance.now();
  eyesAnimating.push({ eyeIdx: idx, startTime: now, duration: 400 });
  requestAnimationFrame(animLoop);

  // Schedule counting audio 1s after completion (delayed from instruction done sound)
  setTimeout(() => {
    if (idx < COUNT_AUDIO.length) {
      playSound(COUNT_AUDIO[idx]);
    }
  }, 1000);

  // Check if all 9 eyes are open
  if (eyesOpen >= 9) {
    // 2s after 九.mp3 (which is 1s delayed, so 3s from now)
    setTimeout(() => {
      playSound(FINAL_AUDIO);
      // After final audio plays, show 观星
      setTimeout(() => {
        showStargazingButton();
      }, 2000);
    }, 3000);
  }
}

function showStargazingButton() {
  allUnlocked = true;
  finalTextShown = true;
  typewriterEl.textContent = '';
  typewriterEl.style.display = 'none';
  typewriterActive = false;

  // Show 观星 label in center box
  centerBox.classList.add('stargazing-ready');
  sgLabel.style.display = '';

  // Make orb clickable
  orbView.classList.add('clickable');

  // Click handler to open stargazing
  sgLabel.addEventListener('click', (e) => {
    e.stopPropagation();
    expandToStargazing();
  });
}

function resetOrb() {
  phase = 'idle';
  eyesOpen = 0;
  eyesAnimating = [];
  typewriterActive = false;
  if (typewriterFadeOut) { clearTimeout(typewriterFadeOut); typewriterFadeOut = null; }
  allUnlocked = false;
  finalTextShown = false;
  typewriterEl.textContent = '';
  typewriterEl.style.display = '';
  typewriterEl.style.opacity = '';
  typewriterEl.style.color = '';
  sgLabel.style.display = 'none';
  centerBox.classList.remove('stargazing-ready');
  orbView.classList.remove('clickable');
  drawFrame();
}

// ══════════════════════════════════════════════
//  CANVAS RENDERING
// ══════════════════════════════════════════════

function getNonagonVertices() {
  const verts = [];
  for (let k = 0; k < 9; k++) {
    const angle = -Math.PI / 2 + k * 2 * Math.PI / 9;  // clockwise from top
    verts.push({
      x: CX + NONAGON_R * Math.cos(angle),
      y: CY + NONAGON_R * Math.sin(angle),
      angle: angle,
    });
  }
  return verts;
}

function drawFrame() {
  const ctx = orbCtx;
  ctx.clearRect(0, 0, WIN_SIZE, WIN_SIZE);

  const verts = getNonagonVertices();

  // ── Outer glow ──
  ctx.save();
  ctx.shadowColor = 'rgba(30, 80, 180, 0.6)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#0a0a18';
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 9; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // ── Nonagon body ──
  const bodyGrad = ctx.createRadialGradient(CX - 10, CY - 15, NONAGON_R * 0.15, CX, CY, NONAGON_R);
  bodyGrad.addColorStop(0, '#1a2040');
  bodyGrad.addColorStop(0.5, '#0e1228');
  bodyGrad.addColorStop(1, '#060810');
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 9; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.fill();

  // ── Golden border ──
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 2.5;
  ctx.shadowColor = 'rgba(201, 168, 76, 0.4)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < 9; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ── Inner subtle border ──
  ctx.strokeStyle = 'rgba(201, 168, 76, 0.25)';
  ctx.lineWidth = 1;
  const innerR = NONAGON_R - 6;
  ctx.beginPath();
  ctx.moveTo(CX + innerR * Math.cos(verts[0].angle), CY + innerR * Math.sin(verts[0].angle));
  for (let i = 1; i < 9; i++) {
    ctx.lineTo(CX + innerR * Math.cos(verts[i].angle), CY + innerR * Math.sin(verts[i].angle));
  }
  ctx.closePath();
  ctx.stroke();

  // ── Eyes ──
  const now = performance.now();
  for (let k = 0; k < 9; k++) {
    const ex = CX + EYE_CENTER_DIST * Math.cos(verts[k].angle);
    const ey = CY + EYE_CENTER_DIST * Math.sin(verts[k].angle);
    const openState = (k < eyesOpen) ? 'open' : 'closed';

    // Check for active animation
    let animT = 1;
    const anim = eyesAnimating.find(a => a.eyeIdx === k);
    if (anim) {
      animT = Math.min(1, (now - anim.startTime) / anim.duration);
      if (animT >= 1) {
        // Animation complete, remove
        eyesAnimating = eyesAnimating.filter(a => a.eyeIdx !== k);
      }
    }

    drawEye(ctx, ex, ey, EYE_OUTER_R, openState, animT, k);
  }

  // ── Corner decorations (small dots at each vertex) ──
  for (let k = 0; k < 9; k++) {
    ctx.fillStyle = '#c9a84c';
    ctx.shadowColor = 'rgba(201, 168, 76, 0.8)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(verts[k].x, verts[k].y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawEye(ctx, ex, ey, r, state, t, idx) {
  ctx.save();

  // Circle background (dark socket)
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.arc(ex, ey, r, 0, Math.PI * 2);
  ctx.fill();

  if (state === 'closed') {
    // ── Closed: horizontal line, slightly curved down ──
    ctx.strokeStyle = '#667788';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.72, ey + r * 0.15);
    ctx.quadraticCurveTo(ex, ey + r * 0.5, ex + r * 0.72, ey + r * 0.15);
    ctx.stroke();
  } else if (state === 'open' && t >= 1) {
    // ── Fully open: circle with dot ──
    // Outer ring
    ctx.strokeStyle = '#8899bb';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    // Inner pupil dot
    ctx.fillStyle = '#c0d0f0';
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.18, 0, Math.PI * 2);
    ctx.fill();

    // Subtle glow
    ctx.strokeStyle = 'rgba(160, 200, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // ── Opening animation (0 < t < 1) ──
    const easeT = easeOutCubic(t);

    if (t < 0.4) {
      // Phase 1: closed line begins to arc upward
      const p = t / 0.4;
      // The horizontal line fades and curves
      const lineY = ey + r * 0.15 * (1 - p);
      const cpY = ey + r * 0.5 * (1 - p) - r * 0.1 * p;
      const alpha = 1 - p;

      ctx.strokeStyle = `rgba(102,119,136,${alpha})`;
      ctx.lineWidth = 2 * (1 - p * 0.5);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.72, lineY);
      ctx.quadraticCurveTo(ex, cpY, ex + r * 0.72, lineY);
      ctx.stroke();

      // Circle outline fading in
      const circleAlpha = p * 0.6;
      ctx.strokeStyle = `rgba(136,153,187,${circleAlpha})`;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.55 * easeT, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      // Phase 2: circle grows, dot appears
      const p = (t - 0.4) / 0.6;
      const circleR = r * 0.55 * easeT;

      ctx.strokeStyle = '#8899bb';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(ex, ey, circleR, 0, Math.PI * 2);
      ctx.stroke();

      // Pupil dot
      if (p > 0.3) {
        const dotAlpha = (p - 0.3) / 0.7;
        ctx.fillStyle = `rgba(192,208,240,${dotAlpha})`;
        ctx.beginPath();
        ctx.arc(ex, ey, r * 0.18 * dotAlpha, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glow
      const glowAlpha = p * 0.5;
      ctx.strokeStyle = `rgba(160,200,255,${glowAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Flash on open (late animation phase) ──
  if (t < 1 && t > 0.7) {
    const flashAlpha = (1 - t) / 0.3 * 0.5;
    const flashGrad = ctx.createRadialGradient(ex, ey, r * 0.2, ex, ey, r * 1.4);
    flashGrad.addColorStop(0, `rgba(180,220,255,${flashAlpha})`);
    flashGrad.addColorStop(1, 'rgba(180,220,255,0)');
    ctx.fillStyle = flashGrad;
    ctx.beginPath();
    ctx.arc(ex, ey, r * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ══════════════════════════════════════════════
//  TYPEWRITER ANIMATION
// ══════════════════════════════════════════════

function startTypewriter(target) {
  // Clear any previous typewriter
  if (typewriterFadeOut) clearTimeout(typewriterFadeOut);
  typewriterActive = true;
  typewriterTarget = target;
  typewriterStartTime = performance.now();
  typewriterEl.textContent = '';
  typewriterEl.style.color = '#4af';
  typewriterEl.style.opacity = '1';
  centerBox.classList.add('typewriter-active');

  requestAnimationFrame(typewriterLoop);
}

function typewriterLoop(ts) {
  if (!typewriterActive) return;

  const elapsed = ts - typewriterStartTime;
  const duration = typewriterDuration;
  const steps = 20;
  const stepTime = duration / steps;
  const step = Math.min(steps, Math.floor(elapsed / stepTime));
  const p = step / steps;

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const target = typewriterTarget;
  let text = '';
  for (let i = 0; i < target.length; i++) {
    text += Math.random() < p ? target[i] : chars[Math.floor(Math.random() * chars.length)];
  }
  typewriterEl.textContent = text;
  typewriterEl.style.color = p > 0.7
    ? `rgb(${Math.floor(100 + 155 * p)},${Math.floor(200 + 55 * p)},255)`
    : '#4af';

  if (step >= steps) {
    typewriterEl.textContent = target;
    typewriterEl.style.color = '#fff';
    typewriterActive = false;

    // Fade out after 3 seconds
    typewriterFadeOut = setTimeout(() => {
      typewriterEl.style.transition = 'opacity 0.6s ease';
      typewriterEl.style.opacity = '0';
      setTimeout(() => {
        typewriterEl.textContent = '';
        typewriterEl.style.transition = '';
        typewriterEl.style.opacity = '';
        centerBox.classList.remove('typewriter-active');
      }, 600);
    }, 3000);
    return;
  }

  requestAnimationFrame(typewriterLoop);
}

// ══════════════════════════════════════════════
//  AUDIO
// ══════════════════════════════════════════════

function playSound(filename) {
  try {
    const audio = new Audio(AUDIO_BASE + filename);
    audio.volume = 1.0;
    audio.play().catch(e => console.warn('Audio play failed:', filename, e.message));
  } catch (e) {
    console.warn('Audio error:', filename, e.message);
  }
}

// ══════════════════════════════════════════════
//  ANIMATION LOOP (for eye transitions)
// ══════════════════════════════════════════════

let animFrameId = null;

function animLoop() {
  if (eyesAnimating.length > 0) {
    drawFrame();
    animFrameId = requestAnimationFrame(animLoop);
  } else {
    drawFrame();
    animFrameId = null;
  }
}

// ══════════════════════════════════════════════
//  DRAG
// ══════════════════════════════════════════════

function setupDrag() {
  orbView.addEventListener('mousedown', async (e) => {
    if (!dragEnabled) return;

    drag.active = true;
    drag.moved = false;
    drag.startX = e.screenX;
    drag.startY = e.screenY;
    try {
      const b = await api.invoke('orb:get-bounds');
      drag.winX = b.x;
      drag.winY = b.y;
    } catch (err) { /* ignore */ }
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!drag.active) return;
    const dx = e.screenX - drag.startX;
    const dy = e.screenY - drag.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    if (drag.moved) {
      api.invoke('orb:move', Math.round(drag.winX + dx), Math.round(drag.winY + dy));
    }
  });

  document.addEventListener('mouseup', () => {
    if (!drag.active) return;
    const didMove = drag.moved;
    drag.active = false;

    // Click (no drag) → open stargazing if unlocked
    if (!didMove && allUnlocked) {
      expandToStargazing();
    }
  });
}

// ══════════════════════════════════════════════
//  STARGAZING — 观星模式
// ══════════════════════════════════════════════

const SG_WIDTH = 860;
const SG_HEIGHT = 620;

let sgMode = 'accessories';
let relics = [];
let events = [];
let fusions = [];
let cardpacks = [];
let coreMechanic = [];

let sgView, sgContent, sgFilters, detailOverlay;

const SIN_COLORS = {
  '暴怒':'#a0392b','色欲':'#bb521f','怠惰':'#e48801',
  '暴食':'#61822b','忧郁':'#306471','傲慢':'#185188','嫉妒':'#7d4e94'
};

async function loadStargazingData() {
  try {
    const data = await api.invoke('orb:get-data');
    relics = data.relics || [];
    events = data.events || [];
    fusions = data.fusions || [];
    cardpacks = data.cardpacks || [];
    coreMechanic = data.coreMechanic || [];
    console.log(`Stargazing: ${relics.length} relics, ${events.length} events, ${fusions.length} fusions`);
  } catch(e) { console.error('Stargazing load failed:', e); }
}

function initStargazingDOM() {
  sgView = document.getElementById('stargazing-view');
  sgContent = document.getElementById('sg-content');
  sgFilters = document.getElementById('sg-filters');
  detailOverlay = document.getElementById('sg-detail-overlay');

  document.getElementById('sg-close').addEventListener('click', collapseToOrb);
  document.getElementById('sg-detail-close').addEventListener('click', () => { detailOverlay.style.display = 'none'; });
  detailOverlay.addEventListener('click', (e) => { if (e.target === detailOverlay) detailOverlay.style.display = 'none'; });

  document.getElementById('sg-tab-accessories').addEventListener('click', () => switchSgTab('accessories'));
  document.getElementById('sg-tab-cardpacks').addEventListener('click', () => switchSgTab('cardpacks'));
  document.getElementById('sg-tab-events').addEventListener('click', () => switchSgTab('events'));

  const eventSearch = document.getElementById('event-search-input');
  let searchTimer;
  eventSearch.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderEvents(), 150);
  });

  setupFilters();
}

let stargazingLoaded = false;

async function expandToStargazing() {
  if (!stargazingLoaded) {
    await loadStargazingData();
    initStargazingDOM();
    stargazingLoaded = true;
  }

  // Save orb position before expanding
  try { const b = await api.invoke('orb:get-bounds'); orbState.orbPos = { x: b.x, y: b.y }; } catch(e) {}

  // Flash orb bright before transition
  orbCanvas.style.transition = 'filter 0.2s';
  orbCanvas.style.filter = 'brightness(2.5)';

  setTimeout(async () => {
    orbCanvas.style.filter = '';
    orbCanvas.style.transition = '';
    orbView.style.display = 'none';
    sgView.style.display = 'flex';
    await api.invoke('orb:set-size', SG_WIDTH, SG_HEIGHT);
    // Center the stargazing window on screen
    try {
      const display = await api.invoke('orb:get-display');
      await api.invoke('orb:move',
        Math.round((display.width - SG_WIDTH) / 2),
        Math.round((display.height - SG_HEIGHT) / 2)
      );
    } catch(e) {}
    setTimeout(() => { sgView.classList.add('active'); renderStargazing(); }, 150);
  }, 250);
}

async function collapseToOrb() {
  sgView.classList.remove('active');

  setTimeout(async () => {
    sgView.style.display = 'none';
    orbView.style.display = 'flex';
    orbView.style.width = WIN_SIZE + 'px';
    orbView.style.height = WIN_SIZE + 'px';

    await api.invoke('orb:set-size', WIN_SIZE, WIN_SIZE);
    if (orbState.orbPos) {
      await api.invoke('orb:move', orbState.orbPos.x, orbState.orbPos.y);
    }

    await new Promise(r => setTimeout(r, 100));
    resizeCanvas();
    drawFrame();
  }, 350);
}

// ── Tab switching ──

function switchSgTab(mode) {
  sgMode = mode;
  document.getElementById('sg-tab-accessories').classList.toggle('active', mode === 'accessories');
  document.getElementById('sg-tab-cardpacks').classList.toggle('active', mode === 'cardpacks');
  document.getElementById('sg-tab-events').classList.toggle('active', mode === 'events');
  document.getElementById('sg-filters').style.display = mode === 'accessories' ? '' : 'none';
  document.getElementById('sg-content').style.display = mode === 'accessories' ? '' : 'none';
  document.getElementById('sg-cardpacks').style.display = mode === 'cardpacks' ? '' : 'none';
  document.getElementById('sg-events-search').style.display = mode === 'events' ? '' : 'none';
  document.getElementById('sg-events').style.display = mode === 'events' ? '' : 'none';
  if (mode === 'accessories') renderStargazing();
  else if (mode === 'cardpacks') renderCardpacks();
  else if (mode === 'events') { document.getElementById('event-search-input').value = ''; renderEvents(); }
}

// ── Filters ──

function getActiveFilters() {
  const chips = sgFilters.querySelectorAll('.filter-chip.active');
  const f = { tier: [], effect: [], sin: [], acq: [] };
  for (const c of chips) { const t = c.dataset.filter; const v = c.dataset.val; if (f[t]) f[t].push(v); }
  return f;
}

// Mode → community floor offset
const MODE_OFFSET = { normal: 0, hard: 0, parallel: 5, extreme: 10 };
const MODE_CN = { normal: '普通', hard: '困难', parallel: '平行叠加', extreme: '极限' };
// Only these modes indicate pack-exclusive (普通/困难 are difficulty levels, not packs)
const PACK_MODES = ['parallel', 'extreme'];

/** Check if any card pack has availability in a given mode (handles true & arrays). */
function hasModePacks(mode) {
  return cardpacks.some(p => {
    const avail = p.availability && p.availability[mode];
    return Array.isArray(avail) ? avail.length > 0 : avail === true;
  });
}

function isPackExclusive(relic) {
  if (!relic.acquisition) return false;
  const acq = relic.acquisition.trim();
  // Match card pack name directly
  if (cardpacks.some(p => acq.includes(p.name))) return true;
  // Match mode keyword only for pack-specific layers (平行叠加 / 极限)
  // "普通" and "困难" are difficulty levels, not pack indicators
  for (const mode of PACK_MODES) {
    const cnName = MODE_CN[mode];
    if (acq.includes(cnName) && hasModePacks(mode)) return true;
  }
  return false;
}

/** Find the card pack a relic belongs to. Falls back to any pack in the matching mode. */
function getPackForRelic(relic) {
  if (!relic.acquisition) return null;
  const acq = relic.acquisition.trim();
  // Exact pack name match
  const byName = cardpacks.find(p => acq.includes(p.name));
  if (byName) return byName;
  // Fallback: match by pack-layer mode keyword (平行叠加 / 极限 only)
  for (const mode of PACK_MODES) {
    const cnName = MODE_CN[mode];
    if (acq.includes(cnName)) {
      const modePack = cardpacks.find(p => {
        const avail = p.availability && p.availability[mode];
        return Array.isArray(avail) ? avail.length > 0 : avail === true;
      });
      if (modePack) return modePack;
    }
  }
  return null;
}

/** Get the earliest community-numbered floor for a pack. */
function getPackFirstFloor(pack) {
  if (!pack || !pack.availability) return 999;
  let minFloor = Infinity;
  for (const [mode, floors] of Object.entries(pack.availability)) {
    const offset = MODE_OFFSET[mode] || 0;
    if (Array.isArray(floors)) {
      for (const f of floors) {
        if (typeof f === 'number') minFloor = Math.min(minFloor, f + offset);
      }
    } else if (floors === true) {
      minFloor = Math.min(minFloor, 1 + offset);
    }
  }
  return minFloor === Infinity ? 999 : minFloor;
}

/** Get sorted unique community-numbered floors for a pack. */
function getPackFloors(pack) {
  if (!pack || !pack.availability) return [];
  const floorSet = new Set();
  for (const [mode, floors] of Object.entries(pack.availability)) {
    const offset = MODE_OFFSET[mode] || 0;
    if (Array.isArray(floors)) {
      for (const f of floors) {
        if (typeof f === 'number') floorSet.add(f + offset);
      }
    } else if (floors === true) {
      // true = all floors 1~5 of this mode
      for (let f = 1; f <= 5; f++) floorSet.add(f + offset);
    }
  }
  return [...floorSet].sort((a, b) => a - b);
}

/** Annotate pack names AND mode keywords in acquisition text with floor info. */
function annotateAcquisition(text) {
  if (!text) return text;
  let result = text;
  let matchedAny = false;
  // Sort by name length descending to avoid partial matches
  const sortedPacks = [...cardpacks].sort((a, b) => (b.name||'').length - (a.name||'').length);
  for (const pack of sortedPacks) {
    if (!pack.name || !result.includes(pack.name)) continue;
    matchedAny = true;
    const floors = getPackFloors(pack);
    const floorStr = floors.length > 0 ? `（${floors.join('、')}F）` : '';
    const escaped = pack.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, 'g'), `${pack.name}${floorStr}`);
  }
  // If no specific pack matched, annotate pack-layer mode keywords only (平行叠加/极限)
  if (!matchedAny) {
    for (const mode of PACK_MODES) {
      const cnName = MODE_CN[mode];
      if (!result.includes(cnName) || !hasModePacks(mode)) continue;
      const offset = MODE_OFFSET[mode] || 0;
      result = result.replace(new RegExp(cnName, 'g'), `${cnName}（${1+offset}~${5+offset}F）`);
    }
  }
  return result;
}

function setupFilters() {
  const EFFECT_ORDER = ['泛用','烧伤','流血','震颤','破裂','沉沦','呼吸法','充能','斩击','打击','突刺'];
  const allEffects = [...new Set(relics.map(r => (r.tags.effect||[])[0] || '泛用'))];
  allEffects.sort((a,b) => {
    const ai = EFFECT_ORDER.indexOf(a), bi = EFFECT_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });

  const effGroup = document.getElementById('filter-effects');
  effGroup.innerHTML = '<span class="filter-label">效果</span>';
  for (const eff of allEffects) {
    const chip = document.createElement('span');
    chip.className = 'filter-chip'; chip.dataset.filter = 'effect'; chip.dataset.val = eff;
    chip.textContent = eff;
    chip.addEventListener('click', () => { chip.classList.toggle('active'); renderStargazing(); });
    effGroup.appendChild(chip);
  }

  const sinNames = ['暴怒','色欲','怠惰','暴食','忧郁','傲慢','嫉妒'];
  const sinGroup = document.getElementById('filter-sins');
  sinGroup.innerHTML = '<span class="filter-label">罪孽</span>';
  for (const sin of sinNames) {
    const chip = document.createElement('span');
    chip.className = 'filter-chip'; chip.dataset.filter = 'sin'; chip.dataset.val = sin;
    chip.textContent = sin;
    chip.style.borderColor = SIN_COLORS[sin]; chip.style.color = SIN_COLORS[sin];
    chip.addEventListener('click', () => { chip.classList.toggle('active'); renderStargazing(); });
    sinGroup.appendChild(chip);
  }

  document.querySelectorAll('#sg-filters .filter-chip[data-filter="tier"], #sg-filters .filter-chip[data-filter="acq"]').forEach(chip => {
    chip.addEventListener('click', () => { chip.classList.toggle('active'); renderStargazing(); });
  });
}

function filterRelics() {
  const f = getActiveFilters();
  return relics.filter(r => {
    if (f.tier.length && !f.tier.includes(r.tier)) return false;
    if (f.effect.length && !f.effect.some(e => (r.tags.effect||[]).includes(e))) return false;
    if (f.sin.length && !f.sin.some(s => (r.tags.sinAffinity||[]).includes(s))) return false;
    if (f.acq.length) {
      const hasEvent = r.source && r.source.type === 'event';
      const hasFuse = fusions.some(fu => fu.result === r.name);
      const hasPack = isPackExclusive(r);
      if (f.acq.includes('event') && !hasEvent) return false;
      if (f.acq.includes('fuse') && !hasFuse) return false;
      if (f.acq.includes('pack') && !hasPack) return false;
    }
    return true;
  });
}

// ── Rendering ──

function renderStargazing() {
  const filtered = filterRelics();
  const groups = {};
  for (const r of filtered) {
    const eff = (r.tags.effect && r.tags.effect[0]) || '泛用';
    if (!groups[eff]) groups[eff] = [];
    groups[eff].push(r);
  }

  const EFFECT_ORDER = ['泛用','烧伤','流血','震颤','破裂','沉沦','呼吸法','充能','斩击','打击','突刺'];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const aCore = coreMechanic.some(c => a.includes(c));
    const bCore = coreMechanic.some(c => b.includes(c));
    if (aCore && !bCore) return -1;
    if (!aCore && bCore) return 1;
    const ai = EFFECT_ORDER.indexOf(a), bi = EFFECT_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b, 'zh-CN');
  });

  const TIER_ORDER = { 'EX':0,'V':1,'IV':2,'III':3,'II':4,'I':5 };
  for (const key of sortedKeys) {
    groups[key].sort((a, b) => {
      const aPackEx = isPackExclusive(a);
      const bPackEx = isPackExclusive(b);
      // Pack-exclusive first
      if (aPackEx && !bPackEx) return -1;
      if (!aPackEx && bPackEx) return 1;
      if (aPackEx && bPackEx) {
        // Both pack-exclusive: sort by floor, then same pack together, then tier
        const packA = getPackForRelic(a);
        const packB = getPackForRelic(b);
        const floorA = getPackFirstFloor(packA);
        const floorB = getPackFirstFloor(packB);
        if (floorA !== floorB) return floorA - floorB;
        // Same floor: group same pack together
        const nameA = packA ? packA.name : '';
        const nameB = packB ? packB.name : '';
        if (nameA !== nameB) return nameA.localeCompare(nameB, 'zh-CN');
        // Same pack: sort by tier
        return (TIER_ORDER[a.tier]||99) - (TIER_ORDER[b.tier]||99);
      }
      // Non-pack-exclusive: sort by tier
      return (TIER_ORDER[a.tier]||99) - (TIER_ORDER[b.tier]||99);
    });
  }

  let html = '';
  for (const key of sortedKeys) {
    const items = groups[key];
    const isCore = coreMechanic.some(c => key.includes(c));
    html += `<div class="sg-section">`;
    html += `<div class="sg-section-header">${isCore?'★ ':''}${key} <span class="count">${items.length}件</span></div>`;

    const packItems = items.filter(r => isPackExclusive(r));
    const normalItems = items.filter(r => !isPackExclusive(r));

    if (packItems.length > 0) {
      html += `<div class="pack-exclusive-tag">📦 卡包专属</div>`;
      html += `<div class="sg-icon-row pack-exclusive">${packItems.map(renderIconItem).join('')}</div>`;
    }
    html += `<div class="sg-icon-row">${normalItems.map(renderIconItem).join('')}</div>`;
    html += `</div>`;
  }

  sgContent.innerHTML = html || '<div style="color:#888;text-align:center;padding:40px;">无匹配饰品</div>';

  sgContent.querySelectorAll('.sg-icon-item').forEach(el => {
    el.addEventListener('click', () => {
      const relic = relics.find(r => r.id === el.dataset.relicId);
      if (relic) showDetail(relic);
    });
  });
}

function renderIconItem(relic) {
  const imgPath = relic.image || '';
  const imgSrc = imgPath.startsWith('resources/') ? `../${imgPath}` : imgPath;
  return `<div class="sg-icon-item" data-relic-id="${relic.id}" title="${relic.name} (${relic.tier})">
    <span class="tier-badge">${relic.tier}</span>
    <img src="${imgSrc}" alt="${relic.name}" loading="lazy" onerror="this.style.display='none';this.parentElement.textContent='${relic.name[0]}'">
  </div>`;
}

function renderPackItem(relic) {
  const imgPath = relic.image || '';
  const imgSrc = imgPath.startsWith('resources/') ? `../${imgPath}` : imgPath;
  return `<div class="cp-item" data-relic-id="${relic.id}" title="${relic.name} (${relic.tier})">
    <img src="${imgSrc}" alt="${relic.name}" loading="lazy" onerror="this.style.display='none';this.parentElement.querySelector('.cp-item-placeholder').style.display='flex'">
    <span class="cp-item-placeholder" style="display:none;">${relic.name[0]}</span>
    <span class="cp-item-name">${relic.name}</span>
    <span class="cp-item-tier">${relic.tier}</span>
  </div>`;
}

// ── Detail modal ──

function showDetail(relic) {
  document.getElementById('sg-detail').classList.remove('event-detail-mode');
  document.getElementById('sg-detail-info').style.display = '';
  document.getElementById('sg-detail-enhance').style.display = '';
  document.getElementById('sg-detail-fuse').style.display = '';
  document.getElementById('sg-detail-event').style.display = 'none';

  const imgPath = relic.image || '';
  const imgSrc = imgPath.startsWith('resources/') ? `../${imgPath}` : imgPath;
  document.getElementById('sg-detail-icon').src = imgSrc;
  document.getElementById('sg-detail-icon').onerror = function() { this.style.display = 'none'; };

  document.getElementById('sg-detail-name').textContent = relic.name;
  const sin = (relic.tags.sinAffinity||[])[0] || '';
  document.getElementById('sg-detail-meta').innerHTML =
    `等级: ${relic.tier} | 罪孽: <span style="color:${SIN_COLORS[sin]||'#888'}">${sin||'无'}</span> | 价格: ${relic.price||'?'} | 效果: ${(relic.tags.effect||[]).join(',')}`;

  let infoHtml = '';
  if (relic.source && relic.source.type === 'event') {
    const event = events.find(e => e.url === relic.source.url);
    const eventDisplayName = (relic.source.name || '').replace('事件-', '');
    infoHtml += `<div class="event-source-btn" data-event-id="${relic.source.url}">
      📌 来源事件：${eventDisplayName}
      <span class="event-expand-icon">▶</span>
    </div>`;
    infoHtml += `<div class="event-detail" id="ev-${relic.source.url.replace(/[^\w]/g,'_')}" style="display:none;">`;
    if (event && event.options && event.options.length > 0) {
      if (event.options.length > 1) {
        infoHtml += `<div class="ev-option-tabs" style="margin-bottom:8px;">`;
        event.options.forEach((opt, i) => {
          infoHtml += `<span class="ev-option-tab${i === 0 ? ' active' : ''}" data-opt-idx="${i}" data-ev-url="${relic.source.url}">选项${'一二三四五六七八九十'[i] || (i+1)}</span>`;
        });
        infoHtml += `</div>`;
      }
      infoHtml += `<div class="ev-option-content" id="ev-src-${relic.source.url.replace(/[^\w]/g,'_')}">`;
      infoHtml += renderOptionContent(event.options[0], 0);
      infoHtml += `</div>`;
    } else {
      infoHtml += '<div class="event-option"><p style="color:#888;">暂无事件详情数据</p></div>';
    }
    infoHtml += `</div>`;
  }
  if (relic.acquisition) {
    infoHtml += `<div style="margin-top:4px;">📦 获得方式: ${annotateAcquisition(relic.acquisition)}</div>`;
  }
  document.getElementById('sg-detail-info').innerHTML = infoHtml;

  setTimeout(() => {
    document.querySelectorAll('.event-source-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const detailId = btn.dataset.eventId.replace(/[^\w]/g,'_');
        const detail = document.getElementById('ev-' + detailId);
        const icon = btn.querySelector('.event-expand-icon');
        if (detail.style.display === 'none') {
          detail.style.display = 'block';
          if (icon) icon.textContent = '▼';
        } else {
          detail.style.display = 'none';
          if (icon) icon.textContent = '▶';
        }
      });
    });
    document.querySelectorAll('.event-detail .ev-option-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const evUrl = tab.dataset.evUrl;
        const idx = parseInt(tab.dataset.optIdx);
        const event = events.find(e => e.url === evUrl);
        if (!event || !event.options[idx]) return;
        tab.parentElement.querySelectorAll('.ev-option-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const contentEl = document.getElementById('ev-src-' + evUrl.replace(/[^\w]/g,'_'));
        if (contentEl) {
          contentEl.innerHTML = renderOptionContent(event.options[idx], idx);
          bindRelicInlineClicks();
        }
      });
    });
    bindRelicInlineClicks();
  }, 50);

  setupEnhancementTabs(relic);
  renderFusionInfo(relic);

  detailOverlay.style.display = 'flex';
}

function renderFusionInfo(relic) {
  const fuseEl = document.getElementById('sg-detail-fuse');
  const fuse = fusions.find(f => f.result === relic.name);
  let html = '';

  if (fuse) {
    html += '<div class="fuse-title">🔧 合成配方</div><div class="fuse-materials">';
    html += fuse.materials.map(m => {
      const mat = relics.find(r => r.name === m);
      const matImg = mat && mat.image ? (mat.image.startsWith('resources/') ? `../${mat.image}` : mat.image) : '';
      return `<span class="fuse-material">
        ${matImg ? `<img src="${matImg}" class="fuse-mat-icon" onerror="this.style.display='none'">` : ''}
        ${m}
      </span>`;
    }).join(' <span class="fuse-arrow">+</span> ');
    const resultImg = relic.image ? (relic.image.startsWith('resources/') ? `../${relic.image}` : relic.image) : '';
    html += ` <span class="fuse-arrow">→</span> <span class="fuse-result">
      ${resultImg ? `<img src="${resultImg}" class="fuse-mat-icon" onerror="this.style.display='none'">` : ''}
      ${fuse.result}
    </span></div>`;
  }

  const usedIn = fusions.filter(f => f.materials.includes(relic.name));
  if (usedIn.length > 0) {
    html += '<div style="margin-top:6px;font-size:11px;color:#aaa;">作为材料用于: ';
    html += usedIn.map(f => {
      const res = relics.find(r => r.name === f.result);
      const resImg = res && res.image ? (res.image.startsWith('resources/') ? `../${res.image}` : res.image) : '';
      return `<span style="display:inline-flex;align-items:center;gap:2px;margin-right:6px;">
        ${resImg ? `<img src="${resImg}" style="width:20px;height:20px;object-fit:contain;">` : ''}
        ${f.result}
      </span>`;
    }).join(', ');
    html += '</div>';
  }

  if (!fuse && usedIn.length === 0) {
    html = '<div style="color:#888;font-size:11px;">无合成信息</div>';
  }

  fuseEl.innerHTML = html;
}

// ── Enhancement tabs ──

function setupEnhancementTabs(relic) {
  const enh = relic.enhancement;
  const tabsEl = document.getElementById('sg-detail-enhance-tabs');
  const contentEl = document.getElementById('sg-detail-enhance-content');

  if (!enh || !enh.levels || enh.levels.length === 0) {
    tabsEl.innerHTML = '';
    contentEl.innerHTML = '<div style="color:#888;font-size:11px;">无强化信息</div>';
    return;
  }

  let tabsHtml = '';
  const defaultLevel = enh.levels.length - 1;
  for (let i = 0; i < enh.levels.length; i++) {
    tabsHtml += `<span class="enhance-tab${i === defaultLevel ? ' active' : ''}" data-level="${i}">${enh.levels[i].label}</span>`;
  }
  tabsEl.innerHTML = tabsHtml;
  showEnhanceContent(enh, defaultLevel);

  tabsEl.querySelectorAll('.enhance-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabsEl.querySelectorAll('.enhance-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      showEnhanceContent(enh, parseInt(tab.dataset.level));
    });
  });
}

function showEnhanceContent(enh, level) {
  const contentEl = document.getElementById('sg-detail-enhance-content');
  const lvl = enh.levels[level];
  if (!lvl) { contentEl.innerHTML = ''; return; }

  let descHtml = escapeHtml(lvl.description);
  if (level > 0 && enh.levels[level - 1]) {
    const prevText = enh.levels[level - 1].description;
    descHtml = highlightDiff(prevText, lvl.description);
  }

  let html = `<div class="enhance-desc">${descHtml}</div>`;
  if (lvl.tags && lvl.tags.length > 0) {
    html += `<div class="enhance-tags">${lvl.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>`;
  }
  contentEl.innerHTML = html;
}

function highlightDiff(prev, curr) {
  if (!prev) return escapeHtml(curr);
  const prevChars = [...prev];
  const currChars = [...curr];
  let result = '';
  let i = 0, j = 0;
  let inDiff = false;
  while (i < currChars.length || j < prevChars.length) {
    if (j >= prevChars.length) {
      if (!inDiff) { result += '<span class="diff-highlight">'; inDiff = true; }
      result += escapeHtml(currChars[i]||''); i++;
    } else if (i >= currChars.length) {
      break;
    } else if (currChars[i] === prevChars[j]) {
      if (inDiff) { result += '</span>'; inDiff = false; }
      result += escapeHtml(currChars[i]); i++; j++;
    } else {
      if (!inDiff) { result += '<span class="diff-highlight">'; inDiff = true; }
      result += escapeHtml(currChars[i]||''); i++; j++;
    }
  }
  if (inDiff) result += '</span>';
  return result;
}

function escapeHtml(text) {
  return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Cardpack view ──

function renderCardpacks() {
  const container = document.getElementById('sg-cardpacks');
  if (!cardpacks.length) {
    container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">无卡包数据</div>';
    return;
  }

  const packRelics = {};
  for (const pack of cardpacks) {
    packRelics[pack.name] = relics.filter(r => r.acquisition && r.acquisition.includes(pack.name));
  }

  const sorted = [...cardpacks].sort((a, b) => {
    const aCount = (packRelics[a.name]||[]).length;
    const bCount = (packRelics[b.name]||[]).length;
    if (aCount > 0 && bCount === 0) return -1;
    if (bCount > 0 && aCount === 0) return 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });

  let html = '';
  const TIER_ORDER = { 'EX':0,'V':1,'IV':2,'III':3,'II':4,'I':5 };
  for (const pack of sorted) {
    const packItems = packRelics[pack.name] || [];
    packItems.sort((a, b) => (TIER_ORDER[a.tier]||99) - (TIER_ORDER[b.tier]||99));

    const floors = getPackFloors(pack);
    const floorTag = floors.length > 0 ? ` <span style="color:#8a7030;font-size:10px;">${floors.join('、')}F</span>` : '';

    html += `<div class="cp-card">
      <div class="cp-header" data-pack="${pack.name}">
        <span class="cp-name">${pack.name}${floorTag}</span>
        <span class="cp-meta">${packItems.length}件饰品 <span class="cp-expand-icon">▶</span></span>
      </div>
      <div class="cp-relics" id="cp-${pack.name.replace(/[^\w一-鿿]/g,'_')}">`;

    if (packItems.length > 0) {
      html += packItems.map(r => renderPackItem(r)).join('');
    } else {
      html += '<span style="color:#555;font-size:11px;padding:4px;">暂无专属饰品</span>';
    }

    html += `</div></div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.cp-header').forEach(header => {
    header.addEventListener('click', () => {
      const packId = 'cp-' + header.dataset.pack.replace(/[^\w一-鿿]/g, '_');
      const relicsDiv = document.getElementById(packId);
      const icon = header.querySelector('.cp-expand-icon');
      if (relicsDiv) {
        const isOpen = relicsDiv.classList.toggle('open');
        icon.textContent = isOpen ? '▼' : '▶';
      }
    });
  });

  container.querySelectorAll('.cp-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const relic = relics.find(r => r.id === el.dataset.relicId);
      if (relic) showDetail(relic);
    });
  });
}

// ── Events view ──

function fuzzyScore(query, text) {
  if (!query || !text) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 1.0;
  let qi = 0, score = 0, consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 1 + consecutive * 0.5;
      consecutive++;
      qi++;
    } else {
      consecutive = 0;
    }
  }
  if (qi < q.length) return 0;
  return score / (q.length + t.length * 0.1);
}

function renderEvents() {
  const container = document.getElementById('sg-events');
  const searchInput = document.getElementById('event-search-input');
  const query = (searchInput?.value || '').trim();

  if (!events.length) {
    container.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">无事件数据</div>';
    return;
  }

  let filtered = [...events];
  if (query) {
    const lowerQ = query.toLowerCase();
    filtered = events.filter(ev => {
      const name = (ev.name || '').replace('事件-', '');
      if (fuzzyScore(lowerQ, name) >= 0.3) return true;
      if (ev.options) {
        for (const opt of ev.options) {
          if (opt.label && fuzzyScore(lowerQ, opt.label) >= 0.3) return true;
          if (opt.description && fuzzyScore(lowerQ, opt.description) >= 0.3) return true;
          if (opt.results) {
            for (const res of opt.results) {
              if (res.text && fuzzyScore(lowerQ, res.text) >= 0.3) return true;
            }
          }
        }
      }
      return false;
    });
  }

  filtered.sort((a, b) => {
    const aImg = a.image ? 0 : 1;
    const bImg = b.image ? 0 : 1;
    if (aImg !== bImg) return aImg - bImg;
    return (a.name || '').localeCompare(b.name || '', 'zh-CN');
  });

  let html = '';
  for (const ev of filtered) {
    const imgPath = ev.image || '';
    const imgSrc = imgPath.startsWith('resources/') ? `../${imgPath}` : (imgPath || '');
    const optCount = ev.options ? ev.options.length : 0;
    const hasCheck = ev.options && ev.options.some(o => o.check);

    html += `<div class="ev-card" data-event-id="${ev.id}">
      ${imgSrc ? `<img class="ev-card-img" src="${imgSrc}" alt="${ev.name}" loading="lazy" onerror="this.style.display='none'">` : `<div class="ev-card-img" style="display:flex;align-items:center;justify-content:center;color:#444;font-size:14px;">?</div>`}
      <div class="ev-card-body">
        <div class="ev-card-name">${(ev.name || '').replace('事件-', '')}</div>
        <div class="ev-card-meta">
          ${hasCheck ? '<span class="has-check">⚡</span>' : ''}
          <span class="opt-count">${optCount}选项</span>
        </div>
      </div>
    </div>`;
  }

  container.innerHTML = html || `<div style="color:#888;text-align:center;padding:40px;">${query ? '无匹配事件' : '无事件数据'}</div>`;

  container.querySelectorAll('.ev-card').forEach(card => {
    card.addEventListener('click', () => {
      const ev = events.find(e => e.id === card.dataset.eventId);
      if (ev) showEventDetail(ev);
    });
  });
}

function showEventDetail(ev) {
  const detailEl = document.getElementById('sg-detail');
  detailEl.classList.add('event-detail-mode');

  document.getElementById('sg-detail-info').style.display = 'none';
  document.getElementById('sg-detail-enhance').style.display = 'none';
  document.getElementById('sg-detail-fuse').style.display = 'none';
  document.getElementById('sg-detail-event').style.display = '';

  const imgPath = ev.image || '';
  const imgSrc = imgPath.startsWith('resources/') ? `../${imgPath}` : (imgPath || '');
  document.getElementById('sg-detail-icon').src = imgSrc;
  document.getElementById('sg-detail-icon').onerror = function() { this.style.display = 'none'; };
  document.getElementById('sg-detail-icon').style.display = imgSrc ? '' : 'none';
  document.getElementById('sg-detail-name').textContent = (ev.name || '').replace('事件-', '');
  document.getElementById('sg-detail-meta').textContent = `${ev.options ? ev.options.length : 0}个选项`;

  let bodyHtml = '';
  if (imgSrc) {
    bodyHtml += `<img class="ev-detail-image" src="${imgSrc}" alt="${ev.name}" onerror="this.style.display='none'">`;
  }

  if (ev.options && ev.options.length > 1) {
    bodyHtml += `<div class="ev-option-tabs">`;
    ev.options.forEach((opt, i) => {
      bodyHtml += `<span class="ev-option-tab${i === 0 ? ' active' : ''}" data-opt-idx="${i}">选项${'一二三四五六七八九十'[i] || (i+1)}</span>`;
    });
    bodyHtml += `</div>`;
  }

  if (ev.options && ev.options.length > 0) {
    bodyHtml += `<div class="ev-option-content" id="ev-option-content">`;
    bodyHtml += renderOptionContent(ev.options[0], 0);
    bodyHtml += `</div>`;
  } else {
    bodyHtml += `<div class="ev-option-content"><p style="color:#888;">暂无选项数据</p></div>`;
  }

  document.getElementById('sg-detail-event').innerHTML = bodyHtml;

  if (ev.options && ev.options.length > 1) {
    setTimeout(() => {
      const tabs = document.querySelectorAll('.ev-option-tab');
      tabs.forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          const idx = parseInt(tab.dataset.optIdx);
          const contentEl = document.getElementById('ev-option-content');
          if (contentEl && ev.options[idx]) {
            contentEl.innerHTML = renderOptionContent(ev.options[idx], idx);
            bindRelicInlineClicks();
          }
        });
      });
    }, 50);
  }

  detailOverlay.style.display = 'flex';

  setTimeout(() => { bindRelicInlineClicks(); }, 50);
}

function bindRelicInlineClicks() {
  document.querySelectorAll('.ev-relic-inline:not([data-bound])').forEach(el => {
    el.dataset.bound = '1';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const relic = relics.find(r => r.id === el.dataset.relicId);
      if (relic) showDetail(relic);
    });
  });
}

function findRelicInText(text) {
  if (!text || !relics.length) return null;
  const sorted = [...relics].sort((a, b) => (b.name||'').length - (a.name||'').length);
  for (const relic of sorted) {
    if (!relic.name || relic.name.length < 2) continue;
    if (text.includes(relic.name)) return relic;
  }
  const rewardMatch = text.match(/获得.*?饰品\s*(.+?)(?:[！。！，\s]|$)/);
  if (!rewardMatch) return null;
  const candidate = rewardMatch[1].trim();
  if (candidate.length < 2 || /^\d+$/.test(candidate)) return null;
  let bestRelic = null;
  let bestScore = 0;
  for (const relic of relics) {
    const rn = relic.name || '';
    if (rn.length < 2) continue;
    const relicChars = new Set([...rn]);
    let shared = 0;
    for (const ch of candidate) { if (relicChars.has(ch)) shared++; }
    const score = shared / Math.max(candidate.length, rn.length);
    const subBonus = (rn.includes(candidate) || candidate.includes(rn)) ? 0.3 : 0;
    const totalScore = score + subBonus;
    if (totalScore > bestScore && totalScore >= 0.55) { bestScore = totalScore; bestRelic = relic; }
  }
  return bestRelic;
}

function renderOptionContent(opt, optIndex) {
  let html = '';
  const label = (opt.label && !/^选项\d+$/.test(opt.label)) ? opt.label
    : `选项${'一二三四五六七八九十'[optIndex || 0] || (optIndex || 0) + 1}`;
  html += `<span class="ev-option-label">${escapeHtml(label)}</span>`;

  if (opt.subtitle) {
    html += `<div class="ev-option-subtitle">${escapeHtml(opt.subtitle)}</div>`;
  }

  let desc = opt.description || '';
  desc = desc.replace(/^选项[一二三四五六七八九十\d]+[\s：:]*/, '').replace(/^[：:]\s*/, '').trim();
  if (desc && opt.results && opt.results.length > 0) {
    desc = desc.replace(/战斗胜利后[，,]\s*获得[\s]*/g, '');
    desc = desc.replace(/战斗胜利后[，,]?\s*/g, '');
    desc = desc.replace(/战斗失败时[，,]\s*没有奖励/g, '');
    desc = desc.replace(/战斗失败时[，,]?\s*/g, '');
    desc = desc.replace(/<br\s*\/?>/gi, '');
    desc = desc.trim();
    if (!desc || desc === '获得' || desc === '获得！') desc = '';
  }
  if (desc) {
    html += `<div class="ev-option-desc">${escapeHtml(desc)}</div>`;
  }

  if (opt.check) {
    html += `<div class="ev-check-block">`;
    if (opt.check.favorable) {
      const f = opt.check.favorable;
      html += `<div class="ev-check-row">
        <span class="ev-check-label favorable">有利判定</span>`;
      if (f.sins && f.sins.length > 0) {
        html += f.sins.map(s => {
          const sc = SIN_COLORS[s] || '#888';
          return `<span style="display:inline-block;padding:1px 6px;background:${sc};color:#fff;border-radius:2px;font-size:10px;margin:0 2px;">${escapeHtml(s)}</span>`;
        }).join('');
      }
      if (f.value) html += `<span class="ev-check-value">${escapeHtml(f.value)}</span>`;
      html += `</div>`;
    }
    if (opt.check.unfavorable) {
      const u = opt.check.unfavorable;
      html += `<div class="ev-check-row">
        <span class="ev-check-label unfavorable">不利判定</span>`;
      if (u.sins && u.sins.length > 0) {
        html += u.sins.map(s => {
          const sc = SIN_COLORS[s] || '#888';
          return `<span style="display:inline-block;padding:1px 6px;background:${sc};color:#fff;border-radius:2px;font-size:10px;margin:0 2px;">${escapeHtml(s)}</span>`;
        }).join('');
      }
      if (u.value) html += `<span class="ev-check-value">${escapeHtml(u.value)}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  if (opt.results && opt.results.length > 0) {
    for (const res of opt.results) {
      const isSuccess = res.outcome === '判定成功';
      html += `<div class="ev-result-block">
        <span class="ev-result-outcome ${isSuccess ? 'success' : 'failure'}">${escapeHtml(res.outcome)}</span>`;
      if (res.text) {
        let resText = res.text.replace(/^[：:]\s*/, '').trim();
        if (res.effects && res.effects.length > 0) {
          const textRelics = resText.replace(/获得E\.G\.O饰品\s*/g, '').replace(/[、，,\s]/g, '');
          const effectRelics = res.effects.map(e => e.reward || '').join('');
          if (textRelics === effectRelics || /^获得E\.G\.O饰品/.test(resText) && textRelics.length > 0) {
            resText = '';
          }
        }
        if (resText === '获得' || resText === '： 获得' || resText === '获得！') resText = '';
        if (resText) {
          html += `<div class="ev-result-text">${escapeHtml(resText)}</div>`;
        }
      }
      if (res.effects && res.effects.length > 0) {
        html += `<ul class="ev-result-effects">`;
        for (const eff of res.effects) {
          const isCost = /失去|受到|减少|消耗/.test(eff.text);
          const isReward = /获得|恢复|增加/.test(eff.text);
          const cls = isCost ? 'cost' : (isReward ? 'reward' : '');
          let relicHtml = '';
          if (isReward || eff.reward || /饰品/.test(eff.text)) {
            let matchedRelic = null;
            if (eff.reward) { matchedRelic = relics.find(r => r.name === eff.reward); }
            if (!matchedRelic) { matchedRelic = findRelicInText(eff.text); }
            if (matchedRelic) {
              const rImgPath = matchedRelic.image || '';
              const rImgSrc = rImgPath.startsWith('resources/') ? `../${rImgPath}` : rImgPath;
              relicHtml = `<span class="ev-relic-inline" data-relic-id="${matchedRelic.id}" title="点击查看详情">
                ${rImgSrc ? `<img src="${rImgSrc}" class="ev-relic-icon" onerror="this.style.display='none'" alt="">` : ''}
                <span class="ev-relic-name">${escapeHtml(matchedRelic.name)}</span>
              </span>`;
            }
          }
          html += `<li class="ev-effect-item${cls ? ' ' + cls : ''}">
            ${escapeHtml(eff.text)}${relicHtml}
          </li>`;
        }
        html += `</ul>`;
      }
      html += `</div>`;
    }
  }

  return html;
}

// Clean up event-detail-mode when overlay closes
detailOverlay?.addEventListener('click', (e) => {
  if (e.target === detailOverlay) {
    document.getElementById('sg-detail')?.classList.remove('event-detail-mode');
  }
});
document.getElementById('sg-detail-close')?.addEventListener('click', () => {
  document.getElementById('sg-detail')?.classList.remove('event-detail-mode');
});
