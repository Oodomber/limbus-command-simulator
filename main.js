/**
 * main.js — Main process entry point for 谨遵指令 (Limbus Command Simulator).
 */

const {
  app, BrowserWindow, ipcMain, globalShortcut,
  dialog, screen
} = require('electron');
const path = require('path');
const Store = require('electron-store');
const { DataLoader, DATA_TYPES } = require('./src/dataLoader');
const { InstructionEngine, PHASES, GUIDANCE_PHASES, STARLIGHT_IDS } = require('./src/engine');
const { AchievementSystem } = require('./src/achievements');
const { QueueManager } = require('./src/queueManager');
const { SoundManager } = require('./src/soundManager');

// ── Window references ──
let mainWindow = null;
let overlayWindow = null;
let historyWindow = null;
let formationWindow = null;
let weaverWindow = null;
let isQuitting = false;
let hideOverlayTimeout = null;
let freeInstructionTimer = null;
let karmaScareTriggered = false;  // one-time karma scare flag

// ── Core services ──
let store = null;
let dataLoader = null;
let engine = null;
let achievements = null;
let soundManager = null;
let queueManager = null;

// ── Phase progression ──
// deploy_identity → deploy_ego → starlight → starting_relic → dungeon(free)
// (formation window auto-opens after EGO, not a phase)
const PHASE_ORDER = ['deploy_identity', 'deploy_ego', 'starlight', 'starting_relic', 'dungeon'];
const DUNGEON_PHASES = ['cardpack', 'route', 'combat', 'event', 'event_reward', 'judgment', 'shop', 'hidden_boss', 'boss_reward'];

const PHASE_LABELS = {
  deploy_identity: '编队（人格）',
  deploy_ego: '编队（EGO）',
  formation: '编队排序',
  starlight: '星光选择',
  starting_relic: '开局饰品',
  cardpack: '卡包选择',
  route: '路线选择',
  combat: '战斗操作',
  event: '事件',
  event_reward: '奖励卡',
  judgment: '判定环节',
  shop: '商店',
  hidden_boss: '隐藏BOSS',
  boss_reward: '关底选择',
};

function getNextPhase(current) {
  const idx = PHASE_ORDER.indexOf(current);
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return 'dungeon';
  const enabledPhases = store.get('enabledPhases') || [];
  // Skip disabled pre-dungeon phases
  for (let i = idx + 1; i < PHASE_ORDER.length; i++) {
    if (i === PHASE_ORDER.length - 1) return 'dungeon'; // last is dungeon
    if (enabledPhases.includes(PHASE_ORDER[i])) return PHASE_ORDER[i];
  }
  return 'dungeon';
}

function sendPhaseChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('run:phase-changed', {
      currentPhase: runState.currentPhase,
      availablePhases: runState.currentPhase === 'dungeon' ? DUNGEON_PHASES : [runState.currentPhase],
      isDungeon: runState.currentPhase === 'dungeon',
    });
  }
  // Unlock pager request button
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('pager:lock-request', false);
  }
  soundManager.play('stage_change');
}

let pagerRequestLocked = false;

function lockPagerRequest() {
  pagerRequestLocked = true;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('pager:lock-request', true);
  }
}

function unlockPagerRequest() {
  pagerRequestLocked = false;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('pager:lock-request', false);
  }
}

// ── Free instruction timer ──
function scheduleFreeInstruction() {
  if (freeInstructionTimer) clearTimeout(freeInstructionTimer);
  const minSec = (store.get('settings.freeInstructionIntervalMin') ?? 60) * 1000;
  const maxSec = (store.get('settings.freeInstructionIntervalMax') ?? 180) * 1000;
  const delay = minSec + Math.random() * (maxSec - minSec);
  freeInstructionTimer = setTimeout(async () => {
    if (!runState.active || pagerRequestLocked) {
      scheduleFreeInstruction();
      return;
    }
    // Only fire during dungeon free phase
    if (runState.currentPhase !== 'dungeon') {
      scheduleFreeInstruction();
      return;
    }
    // Also check karma scare periodically
    checkKarmaScare();
    try {
      const result = await engine._genFreeInstruction({});
      if (result && result.instructions) {
        queueManager.enqueue(result.instructions);
        soundManager.play('bibi_long');
        lockPagerRequest();
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.webContents.send('instruction:new', {
            phase: 'free', count: 1, isGuidance: false,
          });
        }
      }
    } catch (e) { /* ignore */ }
    scheduleFreeInstruction();
  }, delay);
}

function stopFreeInstructionTimer() {
  if (freeInstructionTimer) {
    clearTimeout(freeInstructionTimer);
    freeInstructionTimer = null;
  }
}

// ── Karma scare (one-time when karma first exceeds 100) ──
async function checkKarmaScare() {
  if (karmaScareTriggered) return;
  const threshold = runState.karmaScareThreshold ?? 100;
  if ((runState.currentRunKarma || 0) >= threshold) {
    karmaScareTriggered = true;
    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

    // ── 1. Fullscreen scare window ──
    const scareWin = new BrowserWindow({
      fullscreen: true,
      transparent: true, frame: false,
      resizable: false, skipTaskbar: true, hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: false },
    });
    scareWin.setAlwaysOnTop(true, 'screen-saver');
    scareWin.loadFile(path.join(__dirname, 'renderer', 'scare.html'));
    scareWin.webContents.on('dom-ready', () => {
      scareWin.webContents.executeJavaScript(
        `document.querySelector('.main').textContent = '${runState.currentRunKarma} 业';`
      );
    });

    // ── 2. Cleanup after 10s ──
    setTimeout(() => {
      if (!scareWin.isDestroyed()) scareWin.close();
    }, 10000);
  }
}

// ── In-memory run state ──
const runState = {
  active: false,
  currentRunBlessing: 0,
  currentRunKarma: 0,
  currentTeam: null,         // Map<string, {identityId, egoIds}>
  pendingInstructions: [],
  danmakuVoteActive: false,
  danmakuVoteCandidates: [],
  activePool: null,          // Currently selected identity pool name
  currentPhase: 'deploy_identity',  // Current run phase
  pendingBatchRemaining: 0,  // Non-guidance batch counter for phase advancement
  formation: [],             // Array of 12 sinner names in order (position 1-12)
  starlightEffects: null,    // { interstellarTravelLevel, meteorRainSelected, ... }
  isHardMode: false,
  karmaScareThreshold: 100,  // Configurable via dev panel
  activeIdentityPool: null,  // Selected identity pool name
  activeEgoPool: null,       // Selected EGO pool name
};

// ── Default config ──
function getConfigDefaults() {
  return {
    version: 2,
    ownedIdentities: [],
    ownedEgos: [],
    identityPools: [],
    egoPools: [],
    enabledPhases: [
      'deploy_identity', 'deploy_ego', 'starlight', 'starting_relic',
      'cardpack', 'route', 'combat', 'event', 'event_reward',
      'judgment', 'shop', 'hidden_boss', 'boss_reward'
    ],
    settings: {
      hotkeyRequest: 'F9',
      hotkeyToggleOverlay: 'F10',
      overlayOpacity: 0.9,
      overlayScale: 1.0,
      soundEnabled: true,
      achievementNotify: true,
      currentGameMode: 'hard',
      danmakuEnabled: false,
      danmakuRoomId: '',
      danmakuVoteWindow: 15,
      historyLimit: 200,
      freeInstructionIntervalMin: 60,
      freeInstructionIntervalMax: 180,
      karmaScareThreshold: 100,
    },
    achievements: {},
    globalStats: {
      totalBlessing: 0,
      totalKarma: 0,
      mirrorClears: 0,
      firstFloorDeaths: 0,
      hiddenBossRefusals: 0,
      totalInstructionsCompleted: 0,
      totalInstructionsFailed: 0,
      danmakuInstructionsCompleted: 0,
    },
    instructionHistory: [],
  };
}

// ── Window creation ──

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: '谨遵指令 - 控制面板',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'main.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createOverlayWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 420,
    height: 280,
    minWidth: 300,
    minHeight: 200,
    x: sw - 440,
    y: 40,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    type: 'toolbar',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,  // Allow file:// audio playback
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  // Force always on top (Windows workaround)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Prevent close — minimize instead
  overlayWindow.on('close', (e) => {
    if (isQuitting) return; // allow actual close on quit
    e.preventDefault();
    overlayWindow?.minimize();
  });
}

function createFormationWindow() {
  if (formationWindow && !formationWindow.isDestroyed()) {
    formationWindow.focus();
    return;
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  formationWindow = new BrowserWindow({
    width: 460,
    height: 520,
    minWidth: 400,
    minHeight: 400,
    x: sw - 480,
    y: Math.round((sh - 520) / 2),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    type: 'toolbar',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  formationWindow.loadFile(path.join(__dirname, 'renderer', 'formation.html'));

  formationWindow.setAlwaysOnTop(true, 'screen-saver');

  formationWindow.on('closed', () => {
    formationWindow = null;
  });
}

function createWeaverWindow() {
  if (weaverWindow && !weaverWindow.isDestroyed()) {
    weaverWindow.focus();
    return;
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  weaverWindow = new BrowserWindow({
    width: 500,
    height: 600,
    minWidth: 350,
    minHeight: 300,
    x: 40,
    y: 40,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    type: 'toolbar',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  weaverWindow.loadFile(path.join(__dirname, 'renderer', 'weaver.html'));
  weaverWindow.setAlwaysOnTop(true, 'screen-saver');

  weaverWindow.on('closed', () => {
    weaverWindow = null;
  });
}

function sendWeaverEvent(data) {
  if (weaverWindow && !weaverWindow.isDestroyed()) {
    weaverWindow.webContents.send('weaver:event', data);
  }
}

function createHistoryWindow() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    return;
  }

  historyWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: '指令历史',
    parent: mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  historyWindow.loadFile(path.join(__dirname, 'renderer', 'history.html'));

  historyWindow.on('closed', () => {
    historyWindow = null;
  });
}

// ── Broadcast helpers ──

function broadcastPagerStats() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('pager:update-stats', {
      blessing: runState.currentRunBlessing,
      karma: runState.currentRunKarma,
    });
  }
  checkKarmaScare();
}

function broadcastRunState() {
  const payload = {
    active: runState.active,
    blessing: runState.currentRunBlessing,
    karma: runState.currentRunKarma,
    currentPhase: runState.currentPhase,
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('run:state-changed', payload);
  }
}

function notifyAchievementUnlocked(achievement) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('achievement:unlocked', {
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      unlockText: achievement.unlockText || '',
    });
  }
}

async function recordInstructionHistory(instruction, result) {
  const history = store.get('instructionHistory') || [];
  const limit = store.get('settings.historyLimit') || 200;

  history.unshift({
    id: instruction.id,
    text: instruction.text,
    phase: instruction.phase,
    result,
    timestamp: Date.now(),
  });

  // Trim to limit
  if (history.length > limit) {
    history.splice(limit);
  }

  store.set('instructionHistory', history);
}

// ── IPC Handlers ──

function registerIpcHandlers() {

  // ── Data operations ──
  ipcMain.handle('data:load', async (_event, type) => {
    try {
      return await dataLoader.load(type);
    } catch (e) {
      console.error(`[data:load] ${type} error:`, e);
      return type.endsWith('s') ? [] : {};
    }
  });

  ipcMain.handle('data:save', async (_event, type, data) => {
    try {
      await dataLoader.save(type, data);
      return { success: true };
    } catch (e) {
      console.error(`[data:save] ${type} error:`, e);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('data:list-types', () => DATA_TYPES);

  // ── Config ──
  ipcMain.handle('config:get', (_event, keyPath) => {
    if (keyPath) {
      return store.get(keyPath);
    }
    return store.store;
  });

  ipcMain.handle('config:set', (_event, keyPath, value) => {
    if (keyPath === 'settings.karmaScareThreshold') {
      runState.karmaScareThreshold = value;
    }
    store.set(keyPath, value);
    // Broadcast config change to all renderers
    const update = { key: keyPath, value };
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config:updated', update);
    }
  });

  // ── Run management ──
  ipcMain.handle('run:start', async (_event, identityPoolName, egoPoolName) => {
    if (runState.active) {
      return { success: false, error: '已经有一个正在进行的镜牢' };
    }

    // Cancel any pending hide timeout from a previous run
    if (hideOverlayTimeout) {
      clearTimeout(hideOverlayTimeout);
      hideOverlayTimeout = null;
    }

    pagerRequestLocked = false;
    runState.active = true;
    runState.currentPhase = 'deploy_identity';
    runState.pendingBatchRemaining = 0;
    runState.currentRunBlessing = 0;
    runState.currentRunKarma = 0;
    runState.currentTeam = new Map();
    runState.pendingInstructions = [];
    runState.activeIdentityPool = identityPoolName || null;
    runState.activeEgoPool = egoPoolName || null;
    runState.formation = [];
    runState.starlightEffects = null;
    runState.isHardMode = store.get('settings.currentGameMode') === 'hard';
    runState.currentFloor = 1;
    runState.coreMechanics = [];
    runState.usedCardpackRerolls = 0;
    karmaScareTriggered = false;
    runState.karmaScareThreshold = store.get('settings.karmaScareThreshold') ?? 100;
    queueManager.clear();
    scheduleFreeInstruction();

    broadcastRunState();
    broadcastPagerStats();

    // Show and bring pager to front
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (overlayWindow.isMinimized()) overlayWindow.restore();
      overlayWindow.show();
      overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      overlayWindow.webContents.send('pager:show-waiting');
    }

    return { success: true };
  });

  ipcMain.handle('run:end', async () => {
    if (!runState.active) {
      return { success: false, error: '没有正在进行的镜牢' };
    }

    // Shutdown pager with animation then hide
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('pager:shutdown');
      hideOverlayTimeout = setTimeout(() => {
        hideOverlayTimeout = null;
        if (overlayWindow && !overlayWindow.isDestroyed()) {
          overlayWindow.hide();
        }
      }, 700);
    }

    // Close formation window if open
    if (formationWindow && !formationWindow.isDestroyed()) {
      formationWindow.close();
    }

    pagerRequestLocked = false;
    runState.active = false;
    runState.currentTeam = null;
    queueManager.clear();
    stopFreeInstructionTimer();
    broadcastRunState();

    return { success: true };
  });

  ipcMain.handle('run:get-state', () => ({
    active: runState.active,
    blessing: runState.currentRunBlessing,
    karma: runState.currentRunKarma,
    activePool: runState.activePool,
    teamSize: runState.currentTeam ? runState.currentTeam.size : 0,
  }));

  // ── Instruction generation ──

  // Helper: generate instruction for a phase (central entry point for all paths)
  async function generateInstructionPhase(phase, context = {}) {
    if (!runState.active) return null;

    const enabledPhases = store.get('enabledPhases') || [];
    const isPreDungeon = PHASE_ORDER.includes(phase) && phase !== 'dungeon';
    if (!isPreDungeon && !enabledPhases.includes(phase)) return null;
    // If pre-dungeon phase is disabled, auto-advance
    if (isPreDungeon && !enabledPhases.includes(phase)) {
      runState.currentPhase = getNextPhase(runState.currentPhase);
      sendPhaseChanged();
      return null;
    }

    // Combat requires formation; prompt and auto-open
    if (phase === 'combat' && (!runState.formation || runState.formation.length === 0)) {
      createFormationWindow();
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('pager:show-warning', '请先在编队窗口中指定罪人出击顺序');
      }
      return null;
    }

    let poolIdentityIds = null;
    let poolEgoIds = null;
    if (runState.activeIdentityPool) {
      const pools = store.get('identityPools') || [];
      const pool = pools.find(p => p.name === runState.activeIdentityPool);
      if (pool) poolIdentityIds = pool.items;
    }
    if (runState.activeEgoPool) {
      const pools = store.get('egoPools') || [];
      const pool = pools.find(p => p.name === runState.activeEgoPool);
      if (pool) poolEgoIds = pool.items;
    }

    // Use per-run blessing/karma (not global cumulative)
    const blessing = runState.currentRunBlessing || 0;
    const karma = runState.currentRunKarma || 0;

    const result = await engine.generate(phase, {
      ...context,
      currentTeam: runState.currentTeam,
      poolIdentityIds,
      poolEgoIds,
      formation: runState.formation || [],
      starlightEffects: runState.starlightEffects || null,
      isHardMode: runState.isHardMode || false,
      blessing,
      karma,
      currentFloor: runState.currentFloor || 1,
      coreMechanics: runState.coreMechanics || [],
      usedCardpackRerolls: runState.usedCardpackRerolls || 0,
    });

    // ── Centralized weaver events (per-instruction params from meta) ──
    if (result && result.instructions) {
      const shift = blessing / 400 - karma / 600;
      const rationalThreshold = 0.4 - shift;

      const len = result.instructions.length;
      for (let i = 0; i < len; i++) {
        const inst = result.instructions[i];
        const meta = inst.meta || {};
        const ic = meta.infoCompleteness;
        const rat = meta.rationality;
        const isRat = typeof rat === 'number' ? rat > rationalThreshold : undefined;

        sendWeaverEvent({
          phase,
          phaseLabel: PHASE_LABELS[phase] || phase,
          text: inst.text,
          timestamp: inst.timestamp,
          infoCompleteness: ic,
          rationality: rat,
          isRational: isRat,
          rationalThreshold,
          blessing,
          karma,
          meta,
          currentFloor: runState.currentFloor || 1,
          isLastInBatch: i === len - 1,
          coreMechanics: result.coreMechanics || [],
          ...(i === 0 ? { debugTrace: result.debugTrace || [] } : {}),
        });
      }
    }

    return result;
  }

  ipcMain.handle('instruction:generate', async (_event, phase, context) => {
    if (!runState.active) return { success: false, error: '没有正在进行的镜牢' };

    const enabledPhases = store.get('enabledPhases') || [];
    if (!enabledPhases.includes(phase)) return { success: false, error: '该环节未启用' };

    try {
      const result = await generateInstructionPhase(phase, context);
      if (!result) return { success: false, error: '生成失败' };

      // Post-generation: save state
      if (phase === 'deploy_identity' && result.instructions) {
        runState.currentTeam = new Map();
        for (const inst of result.instructions) {
          if (inst.meta?.sinner && inst.meta?.identityId) {
            runState.currentTeam.set(inst.meta.sinner, { identityId: inst.meta.identityId, egoIds: [] });
          }
        }
        if (result.coreMechanics) runState.coreMechanics = result.coreMechanics;
      }
      if (phase === 'cardpack' && result.instructions?.length > 0) {
        const meta = result.instructions[0].meta || {};
        runState.usedCardpackRerolls = meta.isReroll ? (runState.usedCardpackRerolls || 0) + 1 : 0;
      }
      if (phase === 'starlight' && result.starlightEffects) {
        runState.starlightEffects = result.starlightEffects;
      }
      if (!result.isGuidance && phase !== 'deploy_identity') {
        runState.pendingBatchRemaining = Array.isArray(result.instructions) ? result.instructions.length : 1;
      }

      const enqueued = queueManager.enqueue(result.instructions);
      soundManager.play('bibi_long');
      lockPagerRequest();

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('instruction:new', {
          phase: result.phase, count: Array.isArray(enqueued) ? enqueued.length : 1, isGuidance: result.isGuidance,
        });
        mainWindow.webContents.send('instruction:queue-update', queueManager.getState());
      }
      return { success: true, instructions: enqueued, phase: result.phase, isGuidance: result.isGuidance };
    } catch (e) {
      console.error('Instruction generation error:', e);
      return { success: false, error: e.message };
    }
  });

  // ── Instruction actions ──
  ipcMain.handle('instruction:complete', async () => {
    const inst = queueManager.handleComplete();
    if (!inst) return { success: false, error: '没有待确认的指令' };

    runState.currentRunBlessing += 1;
    const global = store.get('globalStats');
    global.totalBlessing = (global.totalBlessing || 0) + 1;
    global.totalInstructionsCompleted = (global.totalInstructionsCompleted || 0) + 1;
    store.set('globalStats', global);

    broadcastPagerStats();
    broadcastRunState();
    await recordInstructionHistory(inst, 'completed');

    // Check achievements (async)
    achievements.checkAll({ currentRunBlessing: runState.currentRunBlessing, currentRunKarma: runState.currentRunKarma, currentTeam: runState.currentTeam, activePool: runState.activePool })
      .then(unlocked => unlocked.forEach(a => notifyAchievementUnlocked(a)))
      .catch(e => console.error('Achievement check error:', e));

    return { success: true, blessing: runState.currentRunBlessing, karma: runState.currentRunKarma };
  });

  ipcMain.handle('instruction:fail', async () => {
    const inst = queueManager.handleFail();
    if (!inst) return { success: false, error: '没有待确认的指令' };

    runState.currentRunKarma += 5;
    const global = store.get('globalStats');
    global.totalKarma = (global.totalKarma || 0) + 5;
    global.totalInstructionsFailed = (global.totalInstructionsFailed || 0) + 1;
    store.set('globalStats', global);

    broadcastPagerStats();
    broadcastRunState();
    await recordInstructionHistory(inst, 'failed');

    achievements.checkAll({ currentRunBlessing: runState.currentRunBlessing, currentRunKarma: runState.currentRunKarma, currentTeam: runState.currentTeam, activePool: runState.activePool })
      .then(unlocked => unlocked.forEach(a => notifyAchievementUnlocked(a)))
      .catch(e => console.error('Achievement check error:', e));

    return { success: true, blessing: runState.currentRunBlessing, karma: runState.currentRunKarma };
  });

  ipcMain.handle('instruction:get-queue', () => queueManager.getState());
  ipcMain.handle('instruction:get-history', () => {
    return store.get('instructionHistory') || [];
  });

  // ── Phase management ──
  ipcMain.handle('run:get-phase', () => {
    return {
      currentPhase: runState.currentPhase,
      availablePhases: runState.currentPhase === 'dungeon' ? DUNGEON_PHASES : [runState.currentPhase],
      isDungeon: runState.currentPhase === 'dungeon',
    };
  });

  ipcMain.handle('run:advance-phase', () => {
    runState.currentPhase = getNextPhase(runState.currentPhase);
    // Notify main window of phase change
    sendPhaseChanged();
    return { currentPhase: runState.currentPhase };
  });

  ipcMain.handle('run:skip-phase', () => {
    // Allow skipping starlight, starting_relic, and cardpack
    const skippable = ['starlight', 'starting_relic'];
    if (skippable.includes(runState.currentPhase)) {
      runState.currentPhase = getNextPhase(runState.currentPhase);
      sendPhaseChanged();
      return { success: true, currentPhase: runState.currentPhase };
    }
    return { success: false, error: '当前阶段不可跳过' };
  });

  // ── Team core mechanism ──
  ipcMain.handle('run:get-team-mechanic', async () => {
    // Use the same logic as the engine: ≥5 sinner threshold, 7 status effects only
    if (!runState.coreMechanics || runState.coreMechanics.length === 0) {
      return { mechanic: [] };
    }
    return { mechanic: runState.coreMechanics };
  });

  // ── Formation ──
  ipcMain.handle('formation:get', () => {
    return { formation: runState.formation || [] };
  });

  ipcMain.handle('formation:set', (event, formation) => {
    runState.formation = formation || [];
    return { success: true };
  });

  ipcMain.handle('formation:open-window', () => {
    createFormationWindow();
    return { success: true };
  });

  ipcMain.handle('weaver:open', () => {
    createWeaverWindow();
    return { success: true };
  });

  ipcMain.handle('weaver:close', () => {
    if (weaverWindow && !weaverWindow.isDestroyed()) {
      weaverWindow.close();
    }
    return { success: true };
  });

  ipcMain.handle('formation:close-window', () => {
    if (formationWindow && !formationWindow.isDestroyed()) {
      formationWindow.close();
    }
    return { success: true };
  });

  // ── Starlight effects ──
  ipcMain.handle('run:get-starlight-effects', () => {
    return { effects: runState.starlightEffects || null };
  });

  // ── Achievements ──
  ipcMain.handle('achievement:check', async () => {
    const unlocked = await achievements.checkAll({
      currentRunBlessing: runState.currentRunBlessing,
      currentRunKarma: runState.currentRunKarma,
      currentTeam: runState.currentTeam,
      activePool: runState.activePool,
    });
    return { unlocked };
  });

  ipcMain.handle('achievement:get-all', async () => {
    const definitions = await dataLoader.load('achievements');
    const progressMap = store.get('achievements') || {};
    return (definitions || []).map(def => ({
      ...def,
      ...(progressMap[def.id] || { completed: false, progress: 0 }),
    }));
  });

  // ── Milestones ──
  ipcMain.handle('milestone:record', (_event, type) => {
    const global = store.get('globalStats');
    switch (type) {
      case 'clear':
        global.mirrorClears = (global.mirrorClears || 0) + 1;
        break;
      case 'firstFloorDeath':
        global.firstFloorDeaths = (global.firstFloorDeaths || 0) + 1;
        break;
      case 'hiddenBossRefuse':
        global.hiddenBossRefusals = (global.hiddenBossRefusals || 0) + 1;
        break;
    }
    store.set('globalStats', global);

    // Check achievements
    achievements.checkAll({
      currentRunBlessing: runState.currentRunBlessing,
      currentRunKarma: runState.currentRunKarma,
      currentTeam: runState.currentTeam,
      activePool: runState.activePool,
    }).then(unlocked => unlocked.forEach(a => notifyAchievementUnlocked(a)));

    return { success: true };
  });

  // ── Developer ──
  ipcMain.handle('dev:authenticate', (_event, password) => {
    return password === 'dongxiongxianiao';
  });

  // ── Windows ──
  ipcMain.handle('window:create-history', () => {
    createHistoryWindow();
  });

  // ── Sound ──
  ipcMain.handle('sound:play', (_event, name) => {
    soundManager.play(name);
  });

  // ── Pager events (fire-and-forget) ──
  ipcMain.on('pager:ready', () => {
    queueManager.setReady(true);
    broadcastPagerStats();
    if (!queueManager.getState().current) {
      queueManager._showWaiting();
    }
  });

  ipcMain.on('pager:request-instruction', () => {
    // Show phase picker directly on overlay (no need to switch windows)
    if (!runState.active) return;
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const isDungeon = runState.currentPhase === 'dungeon';
      const enabledPhases = store.get('enabledPhases') || [];
      let phases;
      if (isDungeon) {
        phases = DUNGEON_PHASES.filter(id => enabledPhases.includes(id)).map(id => ({ id, label: PHASE_LABELS[id] || id }));
      } else {
        // Pre-dungeon: auto-advance if disabled
        const cp = runState.currentPhase;
        if (enabledPhases.includes(cp)) {
          phases = [{ id: cp, label: PHASE_LABELS[cp] || cp }];
        } else {
          runState.currentPhase = getNextPhase(runState.currentPhase);
          sendPhaseChanged();
          return;
        }
      }
      if (phases.length === 0) return;
      overlayWindow.webContents.send('pager:show-phase-picker', {
        phases,
        isDungeon,
      });
    }
  });

  ipcMain.on('pager:generate-instruction', async (_event, phaseId) => {
    if (!runState.active) return;
    try {
      const result = await generateInstructionPhase(phaseId, {});

      if (result) {
        if (phaseId === 'deploy_identity' && result.instructions) {
          runState.currentTeam = new Map();
          for (const inst of result.instructions) {
            if (inst.meta?.sinner && inst.meta?.identityId) {
              runState.currentTeam.set(inst.meta.sinner, { identityId: inst.meta.identityId, egoIds: [] });
            }
          }
          if (result.coreMechanics) runState.coreMechanics = result.coreMechanics;
        }
        if (phaseId === 'cardpack' && result.instructions?.length > 0) {
          const meta = result.instructions[0].meta || {};
          runState.usedCardpackRerolls = meta.isReroll ? (runState.usedCardpackRerolls || 0) + 1 : 0;
        }
        if (phaseId === 'starlight' && result.starlightEffects) {
          runState.starlightEffects = result.starlightEffects;
        }
        if (!result.isGuidance && phaseId !== 'deploy_identity') {
          runState.pendingBatchRemaining = Array.isArray(result.instructions) ? result.instructions.length : 1;
        }

        queueManager.enqueue(result.instructions);
        soundManager.play('bibi_long');
        lockPagerRequest();

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('instruction:new', {
            phase: result.phase,
            count: Array.isArray(result.instructions) ? result.instructions.length : 1,
            isGuidance: result.isGuidance,
          });
        }
      }
    } catch (e) {
      console.error('[pager:generate-instruction] error:', e);
    }
  });

  ipcMain.on('pager:skip-phase', () => {
    const skippable = ['starlight', 'starting_relic'];
    if (skippable.includes(runState.currentPhase)) {
      runState.currentPhase = getNextPhase(runState.currentPhase);
      sendPhaseChanged();
    }
  });

  ipcMain.on('pager:open-formation', () => {
    createFormationWindow();
  });

  ipcMain.on('pager:minimize', () => {
    if (overlayWindow) overlayWindow.minimize();
  });

  // Guidance batch navigation
  ipcMain.on('pager:guidance-next', () => {
    const inst = queueManager.guidanceNext();
    // The queue manager sends pager:show-instruction via callback
  });

  ipcMain.on('pager:guidance-prev', () => {
    const inst = queueManager.guidancePrev();
  });

  ipcMain.on('pager:guidance-dismiss', () => {
    queueManager.dismissGuidance();
    const completedPhase = runState.currentPhase;

    // Advance phase after guidance is done
    if (completedPhase === 'deploy_identity') {
      runState.currentPhase = getNextPhase(runState.currentPhase);
      unlockPagerRequest();
      sendPhaseChanged();
    } else if (completedPhase === 'deploy_ego') {
      // Auto-open formation window after EGO completed
      createFormationWindow();
      // Advance to starlight
      runState.currentPhase = getNextPhase(runState.currentPhase);
      unlockPagerRequest();
      sendPhaseChanged();
    }
  });

  // Pager complete/fail — process instruction result
  ipcMain.on('pager:complete', async () => {
    const inst = queueManager.handleComplete();
    if (!inst) return;

    runState.currentRunBlessing += 1;
    const global = store.get('globalStats');
    global.totalBlessing = (global.totalBlessing || 0) + 1;
    global.totalInstructionsCompleted = (global.totalInstructionsCompleted || 0) + 1;
    store.set('globalStats', global);

    broadcastPagerStats();
    broadcastRunState();
    await recordInstructionHistory(inst, 'completed');

    // Advance floor on boss_reward completion
    if (inst.phase === 'boss_reward') {
      runState.currentFloor = (runState.currentFloor || 1) + 1;
    }

    // Play completion sound
    // Decrement batch counter and advance phase when all done
    if (!inst.isGuidance && runState.currentPhase !== 'deploy_identity') {
      if (runState.pendingBatchRemaining > 0) {
        runState.pendingBatchRemaining--;
      }
      // Only advance phase when batch fully processed (non-dungeon)
      if (PHASE_ORDER.includes(runState.currentPhase) && runState.currentPhase !== 'dungeon') {
        if (runState.pendingBatchRemaining <= 0) {
          runState.pendingBatchRemaining = 0;
          runState.currentPhase = getNextPhase(runState.currentPhase);
          unlockPagerRequest();
          sendPhaseChanged();
        }
      } else {
        // Dungeon phase: unlock button only when entire batch is done
        if (runState.pendingBatchRemaining <= 0) {
          runState.pendingBatchRemaining = 0;
          unlockPagerRequest();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('instruction:processed', { phase: inst.phase, remaining: 0 });
          }
        }
      }
    }

    achievements.checkAll({
      currentRunBlessing: runState.currentRunBlessing,
      currentRunKarma: runState.currentRunKarma,
      currentTeam: runState.currentTeam,
      activePool: runState.activePool,
    }).then(unlocked => unlocked.forEach(a => notifyAchievementUnlocked(a)))
      .catch(e => console.error('Achievement check error:', e));
  });

  ipcMain.on('pager:fail', async () => {
    const inst = queueManager.handleFail();
    if (!inst) return;

    runState.currentRunKarma += 5;
    const global = store.get('globalStats');
    global.totalKarma = (global.totalKarma || 0) + 5;
    global.totalInstructionsFailed = (global.totalInstructionsFailed || 0) + 1;
    store.set('globalStats', global);

    broadcastPagerStats();
    broadcastRunState();
    await recordInstructionHistory(inst, 'failed');
    checkKarmaScare();

    // Cardpack fail: auto-generate a new cardpack instruction
    if (inst.phase === 'cardpack' && runState.active) {
      const enabledPhases = store.get('enabledPhases') || [];
      if (enabledPhases.includes('cardpack')) {
        try {
          const cardpackResult = await generateInstructionPhase('cardpack', {});
          if (cardpackResult) {
            queueManager.enqueue(cardpackResult.instructions);
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.webContents.send('instruction:new', {
                phase: 'cardpack',
                count: Array.isArray(cardpackResult.instructions) ? cardpackResult.instructions.length : 1,
                isGuidance: false,
              });
            }
          }
        } catch (e) {
          console.error('Cardpack fail auto-regenerate error:', e);
        }
      }
    }

    // Decrement batch counter and advance phase when all done (fail also advances)
    if (!inst.isGuidance && runState.currentPhase !== 'deploy_identity') {
      if (runState.pendingBatchRemaining > 0) {
        runState.pendingBatchRemaining--;
      }
      if (PHASE_ORDER.includes(runState.currentPhase) && runState.currentPhase !== 'dungeon') {
        if (runState.pendingBatchRemaining <= 0) {
          runState.pendingBatchRemaining = 0;
          runState.currentPhase = getNextPhase(runState.currentPhase);
          unlockPagerRequest();
          sendPhaseChanged();
        }
      } else {
        // Dungeon phase: unlock button only when entire batch is done
        if (runState.pendingBatchRemaining <= 0) {
          runState.pendingBatchRemaining = 0;
          unlockPagerRequest();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('instruction:processed', { phase: inst.phase, remaining: 0 });
          }
        }
      }
    }

    achievements.checkAll({
      currentRunBlessing: runState.currentRunBlessing,
      currentRunKarma: runState.currentRunKarma,
      currentTeam: runState.currentTeam,
      activePool: runState.activePool,
    }).then(unlocked => unlocked.forEach(a => notifyAchievementUnlocked(a)))
      .catch(e => console.error('Achievement check error:', e));
  });
}

// ── Global shortcuts ──

function registerShortcuts() {
  // F9: Manual instruction request
  globalShortcut.register('F9', () => {
    // Respect pager lock
    if (pagerRequestLocked) return;
    // Send to pager to open phase picker directly
    if (runState.active && overlayWindow && !overlayWindow.isDestroyed()) {
      const isDungeon = runState.currentPhase === 'dungeon';
      const enabledPhases = store.get('enabledPhases') || [];
      let phases;
      if (isDungeon) {
        phases = DUNGEON_PHASES.filter(id => enabledPhases.includes(id)).map(id => ({ id, label: PHASE_LABELS[id] || id }));
      } else {
        // Pre-dungeon: auto-advance if disabled
        const cp = runState.currentPhase;
        if (enabledPhases.includes(cp)) {
          phases = [{ id: cp, label: PHASE_LABELS[cp] || cp }];
        } else {
          runState.currentPhase = getNextPhase(runState.currentPhase);
          sendPhaseChanged();
          return;
        }
      }
      if (phases.length === 0) return;
      overlayWindow.webContents.send('pager:show-phase-picker', {
        phases,
        isDungeon,
      });
    }
  });

  // F10: Toggle overlay visibility (robust: works from any state)
  globalShortcut.register('F10', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      // Recreate if destroyed
      createOverlayWindow();
      return;
    }
    try {
      const vis = overlayWindow.isVisible();
      const min = overlayWindow.isMinimized();
      if (vis && !min) {
        overlayWindow.hide();
      } else {
        if (min) overlayWindow.restore();
        overlayWindow.show();
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
        // Don't send show-waiting — preserve current state
      }
    } catch (e) {
      console.error('F10 toggle error:', e);
    }
  });

  // F11: Veto danmaku vote (deferred)
  globalShortcut.register('F11', () => {
    if (runState.danmakuVoteActive && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:f11-pressed');
    }
  });
}

// ── App lifecycle ──

// Fix GPU disk cache error on Windows (access denied to cache dir)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Global unhandled rejection handler (prevent silent failures)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

app.whenReady().then(async () => {
  // Initialize data services
  const userDataPath = app.getPath('userData');
  const bundledPath = path.join(__dirname, 'data');

  dataLoader = new DataLoader(userDataPath, bundledPath);
  store = new Store({ defaults: getConfigDefaults() });

  // Migrate: ensure new phases are present in enabledPhases
  const defaults = getConfigDefaults();
  const currentPhases = store.get('enabledPhases') || [];
  const defaultPhases = defaults.enabledPhases || [];
  let phasesUpdated = false;
  for (const ph of defaultPhases) {
    if (!currentPhases.includes(ph)) {
      currentPhases.push(ph);
      phasesUpdated = true;
    }
  }
  if (phasesUpdated) {
    store.set('enabledPhases', currentPhases);
  }

  engine = new InstructionEngine(dataLoader, store);
  achievements = new AchievementSystem(dataLoader, store);
  soundManager = new SoundManager(path.join(__dirname, 'resources', 'sounds'));
  queueManager = new QueueManager();

  // Give soundManager access to both windows for playback
  soundManager.setOverlay(overlayWindow);
  soundManager.setMain(mainWindow);

  // Wire up queue manager callbacks
  queueManager._onShowInstruction = (data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('pager:show-instruction', data);
    }
  };

  queueManager._onShowWaiting = () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('pager:show-waiting');
    }
  };

  // ── Splash screen ──
  const splashWin = new BrowserWindow({
    width: 400, height: 300,
    frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWin.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  splashWin.center();

  // Create windows after a short delay for splash to show
  setTimeout(() => {
    createMainWindow();
    createOverlayWindow();
    overlayWindow.hide();
    registerIpcHandlers();
    registerShortcuts();
    console.log('[main] 谨遵指令 started');

    // Close splash when main window finishes loading
    setTimeout(() => {
      if (!splashWin.isDestroyed()) splashWin.close();
    }, 500);
  }, 800);
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
