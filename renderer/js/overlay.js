/**
 * overlay.js — Pager window renderer logic.
 * Handles typewriter animation, button interactions, and IPC events.
 */

// ── DOM refs ──
const pagerText = document.getElementById('pager-text');
const pagerCursor = document.getElementById('pager-cursor');
const pagerButtons = document.getElementById('pager-buttons');
const pagerGuidanceNav = document.getElementById('pager-guidance-nav');
const guidanceInfo = document.getElementById('guidance-info');
const pagerBlessing = document.getElementById('pager-blessing');
const pagerKarma = document.getElementById('pager-karma');
const btnComplete = document.getElementById('btn-complete');
const btnFail = document.getElementById('btn-fail');
const btnRequest = document.getElementById('pager-request');
const btnFormation = document.getElementById('pager-formation');
const btnClose = document.getElementById('pager-close');
const pagerEl = document.getElementById('pager');

// ── State ──
let isAnimating = false;
let currentInstructionId = null;
let currentIsGuidance = false;
let currentBatchIndex = -1;
let currentBatchTotal = 0;
let typewriterTimer = null;
let seenInstructions = new Set(); // track already-animated instruction IDs

// ── Scramble characters (Chinese only) ──
const SCRAMBLE_CHARS = '日月金木水火土天地玄黃宇宙洪荒龍鳳鬼神乾坤陰陽風雲雷電山澤河海春秋冬夏仁義禮智忠孝廉恥文武劍刀槍戟弓箭矛盾甲冑城郭宮殿樓閣花草竹石鳥獸蟲魚魂魄精氣神魔仙妖';

function randomScramble() {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

// ── Matrix typewriter animation ──
function startTypewriter(text, speed = 50) {
  stopTypewriter();
  const target = text;
  pagerText.textContent = '';
  pagerText.classList.remove('waiting');
  pagerCursor.classList.add('typing');
  pagerCursor.classList.remove('cursor-blink');

  let revealed = 0;          // how many positions are "active"
  let scrambleFrame = null;  // requestAnimationFrame ID

  isAnimating = true;
  pagerButtons.classList.add('hidden');

  // Continuously flicker all revealed positions (throttled to ~15fps)
  let flickerTick = 0;
  function flicker() {
    flickerTick++;
    if (flickerTick % 6 === 0) { // ~10fps
      let display = '';
      for (let i = 0; i < revealed; i++) {
        display += randomScramble();
      }
      pagerText.textContent = display;
    }
    scrambleFrame = requestAnimationFrame(flicker);
  }
  flicker();

  // Gradually reveal positions
  typewriterTimer = setInterval(() => {
    revealed++;
    if (revealed >= target.length) {
      // Done: cancel scrambling, snap to real text
      clearInterval(typewriterTimer);
      typewriterTimer = null;
      cancelAnimationFrame(scrambleFrame);
      scrambleFrame = null;

      pagerText.textContent = target;
      pagerCursor.classList.remove('typing');
      pagerCursor.classList.add('cursor-blink');

      if (!currentIsGuidance) {
        pagerButtons.classList.remove('hidden');
      }
      isAnimating = false;
    }
  }, speed);
}

function stopTypewriter() {
  if (typewriterTimer) {
    clearInterval(typewriterTimer);
    typewriterTimer = null;
  }
}

function showWaiting() {
  stopTypewriter();
  isAnimating = false;
  pagerText.textContent = '********';
  pagerText.classList.add('waiting');
  pagerCursor.classList.add('cursor-blink');
  pagerCursor.classList.remove('typing');
  pagerButtons.classList.add('hidden');
  pagerGuidanceNav.classList.add('hidden');
  document.getElementById('btn-guidance-prev').style.display = '';
  document.getElementById('btn-guidance-next').style.display = '';
  currentInstructionId = null;
  currentBatchIndex = -1;
  currentBatchTotal = 0;
  seenInstructions = new Set(); // reset for new batch
}

// ── IPC event listeners ──
window.pagerAPI.onShowInstruction((data) => {
  pagerEl.classList.remove('shutting-down');

  currentInstructionId = data.id;
  currentIsGuidance = data.isGuidance;
  currentBatchIndex = data.batchIndex ?? -1;
  currentBatchTotal = data.batchTotal ?? 0;

  pagerButtons.classList.add('hidden');
  pagerGuidanceNav.classList.add('hidden');

  // Already seen this instruction? Show instantly without animation or sound
  if (seenInstructions.has(data.id)) {
    stopTypewriter();
    isAnimating = false;
    pagerText.textContent = data.text;
    pagerText.classList.remove('waiting');
    pagerCursor.classList.remove('typing');
    pagerCursor.classList.add('cursor-blink');
    showGuidanceOrButtons(data);
  } else {
    seenInstructions.add(data.id);
    // Play sound for new instruction
    const sfx = document.getElementById('sfx-bibi-long');
    if (sfx) { sfx.currentTime = 0; sfx.play().catch(() => {}); }
    startTypewriter(data.text);
    // After animation, show controls
    const checkAnimation = setInterval(() => {
      if (!isAnimating) {
        clearInterval(checkAnimation);
        showGuidanceOrButtons(data);
      }
    }, 50);
  }

  // Flash effect
  pagerEl.classList.add('new-instruction-flash');
  setTimeout(() => {
    pagerEl.classList.remove('new-instruction-flash');
  }, 1000);
});

function showGuidanceOrButtons(data) {
  if (data.isGuidance) {
    guidanceInfo.textContent = data.batchTotal > 1
      ? `${data.batchIndex + 1} / ${data.batchTotal}`
      : '1 / 1';
    pagerGuidanceNav.classList.remove('hidden');
    document.getElementById('btn-guidance-prev').style.display = data.batchTotal > 1 ? '' : 'none';
    document.getElementById('btn-guidance-next').style.display = data.batchTotal > 1 ? '' : 'none';
  } else {
    pagerButtons.classList.remove('hidden');
  }
}

window.pagerAPI.onShowWarning((msg) => {
  stopTypewriter();
  pagerText.classList.remove('waiting');
  pagerText.classList.add('warning');
  pagerCursor.classList.add('typing');
  pagerCursor.classList.remove('cursor-blink');
  pagerButtons.classList.add('hidden');
  pagerGuidanceNav.classList.add('hidden');
  isAnimating = true;
  startTypewriter(msg, 30);
  // Auto-clear after animation + 3 seconds
  const checkAnim = setInterval(() => {
    if (!isAnimating) {
      clearInterval(checkAnim);
      pagerCursor.classList.remove('typing');
      pagerCursor.classList.add('cursor-blink');
      setTimeout(() => {
        if (pagerText.textContent === msg) {
          pagerText.classList.remove('warning');
          showWaiting();
        }
      }, 3000);
    }
  }, 50);
});

window.pagerAPI.onShowWaiting(() => {
  // Remove shutdown class — critical for re-show after end/start cycle
  pagerEl.classList.remove('shutting-down');
  showWaiting();
});

window.pagerAPI.onUpdateStats(({ blessing, karma }) => {
  pagerBlessing.textContent = blessing;
  pagerKarma.textContent = karma;
});

window.pagerAPI.onShutdown(() => {
  // Shutdown animation
  pagerEl.classList.add('shutting-down');
  // The main process handles actual window close after animation
});

// ── Phase Picker (in-pager modal) ──
const phasePicker = document.getElementById('pager-phase-picker');
const phaseTitle = document.getElementById('pager-phase-title');
const phaseList = document.getElementById('pager-phase-list');
const phaseCancelBtn = document.getElementById('pager-phase-cancel');

function showPhasePicker(data) {
  const phases = data.phases || [];
  const isDungeon = data.isDungeon || false;

  phaseTitle.textContent = isDungeon ? '选择环节' : '当前环节';
  phaseList.innerHTML = phases.map(p => `
    <button class="pager-phase-btn" data-phase="${p.id}">${p.label}</button>
  `).join('');

  phasePicker.classList.remove('hidden');

  phaseList.querySelectorAll('.pager-phase-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playSfx('bibi-long');
      phasePicker.classList.add('hidden');
      window.pagerAPI.generateInstruction(btn.dataset.phase);
    });
  });
}

function hidePhasePicker() {
  phasePicker.classList.add('hidden');
}

phaseCancelBtn.addEventListener('click', hidePhasePicker);

// ── Button handlers ──
btnComplete.addEventListener('click', () => {
  if (!currentInstructionId || currentIsGuidance || isAnimating) return;
  playSfx('bibi-short'); // Play immediately with user gesture
  pagerButtons.classList.add('hidden');
  showWaiting();
  window.pagerAPI.complete();
});

btnFail.addEventListener('click', () => {
  if (!currentInstructionId || currentIsGuidance || isAnimating) return;
  playSfx('bibi-short');
  pagerButtons.classList.add('hidden');
  showWaiting();
  window.pagerAPI.fail();
});

// Guidance navigation
document.getElementById('btn-guidance-prev').addEventListener('click', () => {
  if (isAnimating) return;
  window.pagerAPI.guidancePrev();
});

document.getElementById('btn-guidance-next').addEventListener('click', () => {
  if (isAnimating) return;
  window.pagerAPI.guidanceNext();
});

document.getElementById('btn-guidance-dismiss').addEventListener('click', () => {
  pagerGuidanceNav.classList.add('hidden');
  showWaiting();
  window.pagerAPI.guidanceDismiss();
});

btnRequest.addEventListener('click', () => {
  if (btnRequest.disabled) return;
  window.pagerAPI.requestInstruction();
});

btnClose.addEventListener('click', () => {
  window.pagerAPI.minimize();
});

btnFormation.addEventListener('click', () => {
  window.pagerAPI.openFormation();
});

// ── Keyboard shortcuts for pager ──
document.addEventListener('keydown', (e) => {
  // Phase picker shortcuts
  if (!phasePicker.classList.contains('hidden')) {
    if (e.key === 'Escape') { hidePhasePicker(); return; }
    const num = parseInt(e.key);
    if (num >= 1 && num <= 9) {
      const btns = phaseList.querySelectorAll('.pager-phase-btn');
      if (num <= btns.length) { btns[num-1].click(); }
    }
    return;
  }

  if (!currentInstructionId || currentIsGuidance || isAnimating) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    btnComplete.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    btnFail.click();
  }
});

// ── Sound playback (direct DOM audio elements) ──
let _sfxQueue = [];

function playSfx(name) {
  const el = document.getElementById('sfx-' + name);
  if (!el) return;
  el.currentTime = 0;
  el.play().catch(() => {
    // Autoplay blocked (no user gesture) — queue for next click
    el.load();
    if (!_sfxQueue.includes(name)) _sfxQueue.push(name);
  });
}

// Drain queued sounds on user click
document.addEventListener('click', () => {
  while (_sfxQueue.length > 0) {
    const name = _sfxQueue.shift();
    const el = document.getElementById('sfx-' + name);
    if (el) { el.currentTime = 0; el.play().catch(() => {}); }
  }
}, true);

// IPC-triggered sounds (name from main process, e.g. 'stage_change')
window.pagerAPI.onPlaySound((name) => {
  const id = name.replace(/_/g, '-');
  playSfx(id);
});

// ── Request button locking ──

function setPagerRequestLocked(locked) {
  if (locked) {
    btnRequest.disabled = true;
    btnRequest.style.opacity = '0.4';
    btnRequest.style.cursor = 'not-allowed';
    btnRequest.title = '请先完成当前指令';
  } else {
    btnRequest.disabled = false;
    btnRequest.style.opacity = '';
    btnRequest.style.cursor = '';
    btnRequest.title = '请求指令';
  }
}

window.pagerAPI.onLockRequest((locked) => {
  setPagerRequestLocked(locked);
});

// Listen for phase picker activation
window.pagerAPI.onShowPhasePicker((data) => {
  showPhasePicker(data);
});

// ── Startup ──
pagerEl.classList.remove('shutting-down'); // Ensure clean state
showWaiting();
window.pagerAPI.notifyReady();
