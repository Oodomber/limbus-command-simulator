/**
 * main.js — Main process entry point for 谨遵指令 (Limbus Command Simulator).
 */

const {
  app, BrowserWindow, ipcMain, globalShortcut,
  dialog, screen
} = require('electron');

// Prevent Chromium from throttling timers/rAF when overlay loses focus.
// This is critical for the typewriter animation to remain smooth when the
// user is playing the game (game window has focus, overlay is "background").
app.commandLine.appendSwitch('disable-background-timer-throttling');

const path = require('path');
const Store = require('electron-store');
const { DataLoader, DATA_TYPES } = require('./src/dataLoader');
const { InstructionEngine, PHASES, GUIDANCE_PHASES } = require('./src/engine');
const { AchievementSystem } = require('./src/achievements');
const { QueueManager } = require('./src/queueManager');
const { SoundManager } = require('./src/soundManager');
const { VisionManager } = require('./src/visionManager');

// Bump this when bundled data/ files change — auto-clears stale userData on next launch
const DATA_VERSION = 2;

// ── Window references ──
let mainWindow = null;
let overlayWindow = null;
let orbWindow = null;
let historyWindow = null;
let formationWindow = null;
let weaverWindow = null;
let hideOverlayTimeout = null;
let freeInstructionTimer = null;
let karmaScareTriggered = false;  // one-time karma scare flag
let isQuitting = false;           // true when app is shutting down

// ── Core services ──
let store = null;
let dataLoader = null;
let engine = null;
let achievements = null;
let soundManager = null;
let queueManager = null;
let visionManager = null;
let _userDataPath = null;  // set in app.whenReady() — needed by scheduleAutoDetect

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

/**
 * Reliably return OS focus to the main window.
 * On Windows, alwaysOnTop child windows (overlay/formation) can "trap" focus
 * even after being hidden. The setAlwaysOnTop(true)→focus→setAlwaysOnTop(false)
 * dance is a known Electron workaround to force Windows to acknowledge the
 * main window as the foreground window.
 */
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  // Temporarily elevate to alwaysOnTop to force OS foreground focus
  mainWindow.setAlwaysOnTop(true);
  mainWindow.moveTop();
  mainWindow.focus();
  // Remove alwaysOnTop after focus is established
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
    }
  }, 100);
}

/**
 * Hide an alwaysOnTop overlay window and restore focus to main window.
 * Blurs the overlay first so Windows doesn't keep sending keystrokes to it.
 */
function hideOverlayAndRefocus(win) {
  if (!win || win.isDestroyed()) return;
  win.blur();
  win.setAlwaysOnTop(false);
  win.hide();
  focusMainWindow();
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
  const minSec = (store.get('settings.freeInstructionIntervalMin') ?? 180) * 1000;
  const maxSec = (store.get('settings.freeInstructionIntervalMax') ?? 300) * 1000;
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
      const result = await engine._genFreeInstruction({
        formation: runState.formation || [],
      });
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

// ── Vision auto-detect (Phase 10) ──
let autoDetectTimer = null;

/**
 * After a dungeon instruction is processed, if vision auto-detect is enabled,
 * wait a short delay then try to detect the current game phase.
 * If shop is detected with auto-generate enabled, recognize items + generate
 * precise shop instructions.
 */
function scheduleAutoDetect() {
  if (!store || !store.get('vision.autoDetect')) return;
  if (!visionManager || !visionManager.available) return;

  // Debounce — cancel any pending detection
  if (autoDetectTimer) clearTimeout(autoDetectTimer);

  autoDetectTimer = setTimeout(async () => {
    autoDetectTimer = null;
    if (!runState.active) return;

    try {
      const calibration = store.get('vision.calibration') || {};
      const region = calibration.gameRegion || null;
      const enabledPhases = store.get('enabledPhases') || [];
      const dungeonPhases = ['cardpack', 'route', 'combat', 'event', 'event_reward', 'judgment', 'shop', 'hidden_boss', 'boss_reward'];

      let phases;
      if (runState.currentPhase === 'dungeon') {
        phases = dungeonPhases.filter(p => enabledPhases.includes(p));
      } else {
        phases = [runState.currentPhase].filter(p => enabledPhases.includes(p));
      }
      if (phases.length === 0) return;

      const refsDir = path.join(_userDataPath, 'refs');
      const result = await visionManager.detectPhase({
        region,
        phases,
        conf_threshold: 0.75,
        refs_dir: refsDir,
      });

      if (!result.ok || !result.phase) return;

      // If shop detected and auto-generate is on, recognize items
      if (result.phase === 'shop' && store.get('vision.autoGenerate')) {
        const shopGrid = calibration.shopGrid;
        if (!shopGrid) return; // not calibrated

        const shopResult = await visionManager.recognizeShop({
          region,
          shop_grid: shopGrid,
          reference_dir: path.join(_userDataPath, 'refs', 'relics'),
        });

        if (shopResult.ok && shopResult.items && shopResult.items.some(i => i.id)) {
          // Build context for engine: map recognized relic IDs to their data
          const relics = await dataLoader.load('relics');
          const recognizedItems = shopResult.items
            .filter(i => i.id)
            .map(i => {
              const relic = relics.find(r => r.id === i.id);
              return {
                slot: i.slot,
                id: i.id,
                name: relic ? relic.name : i.id,
                confidence: i.confidence,
                tier: relic ? relic.tier : '?',
                price: relic ? relic.price : null,
                tags: relic ? relic.tags : {},
              };
            });

          if (recognizedItems.length > 0 && !pagerRequestLocked) {
            try {
              const genResult = await generateInstructionPhase('shop', { recognizedItems });
              if (genResult) {
                console.log(`[vision] Auto-generated shop instructions for ${recognizedItems.length} recognized items`);
              }
            } catch (e) {
              console.error('[vision] Auto-generate shop failed:', e.message);
            }
          }
        }
      }
    } catch (e) {
      // Silent — auto-detect failures shouldn't disrupt normal flow
      console.log('[vision] Auto-detect error:', e.message);
    }
  }, 2000); // 2s delay to allow game UI to transition
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
  danmakuVoteActive: false,  // Phase 11 弹幕投票预留，待实现
  danmakuVoteCandidates: [],
  activePool: null,          // Currently selected pool name (for achievement tracking)
  currentPhase: 'deploy_identity',  // Current run phase
  pendingBatchRemaining: 0,  // Non-guidance batch counter for phase advancement
  formation: [],             // Array of 12 sinner names in order (position 1-12)
  starlightEffects: null,    // { interstellarTravelLevel, meteorRainSelected, ... }
  isHardMode: false,
  karmaScareThreshold: 100,  // Configurable via dev panel
  activeIdentityPool: null,  // Selected identity pool name
  activeEgoPool: null,       // Selected EGO pool name
  currentFloor: 1,           // Current mirror dungeon floor (incremented on boss_reward)
  coreMechanics: [],         // Dominant core mechanics from deployed team
  usedCardpackRerolls: 0,    // Consecutive rerolls used (reset on pick)
};

// ── Default config ──
function getConfigDefaults() {
  return {
    version: 2,
    dataVersion: 0,
    ownedIdentities: [],    ownedEgos: [],
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
      hotkeyComplete: 'F2',
      hotkeyFail: 'F3',
      overlayOpacity: 0.9,
      overlayScale: 1.0,
      soundEnabled: true,
      achievementNotify: true,
      currentGameMode: 'hard',
      danmakuEnabled: false,
      danmakuRoomId: '',
      danmakuVoteWindow: 15,
      historyLimit: 200,
      freeInstructionIntervalMin: 180,
      freeInstructionIntervalMax: 300,
      karmaScareThreshold: 100,
    },
    vision: {
      autoDetect: false,
      autoGenerate: false,
      calibration: {},
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

  // When main window is closed, force-close all child windows
  // so the app can fully exit (overlay prevents close → minimize)
  mainWindow.on('close', () => {
    isQuitting = true;
    stopFreeInstructionTimer();
    if (hideOverlayTimeout) { clearTimeout(hideOverlayTimeout); hideOverlayTimeout = null; }
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.destroy();
    if (orbWindow && !orbWindow.isDestroyed()) orbWindow.destroy();
    if (formationWindow && !formationWindow.isDestroyed()) formationWindow.destroy();
    if (weaverWindow && !weaverWindow.isDestroyed()) weaverWindow.destroy();
    if (historyWindow && !historyWindow.isDestroyed()) historyWindow.destroy();
  });

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
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,  // Allow file:// audio playback
      backgroundThrottling: false,  // Prevent rAF/setInterval throttling when overlay loses focus
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  // Force always on top (Windows workaround)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Prevent close — minimize instead (unless app is quitting)
  overlayWindow.on('close', (e) => {
    if (isQuitting) return;  // Allow force-close during shutdown
    e.preventDefault();
    overlayWindow?.minimize();
  });
}

function createNonagonMask(size, cx, cy, R) {
  // Precompute vertices (clockwise from top)
  const verts = [];
  for (let k = 0; k < 9; k++) {
    const angle = -Math.PI / 2 + k * 2 * Math.PI / 9;
    verts.push({ x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) });
  }

  function inside(px, py) {
    for (let i = 0; i < 9; i++) {
      const j = (i + 1) % 9;
      const cross = (verts[j].x - verts[i].x) * (py - verts[i].y)
                  - (verts[j].y - verts[i].y) * (px - verts[i].x);
      if (cross > 0) return false; // outside for clockwise polygon
    }
    return true;
  }

  const rects = [];
  for (let y = 0; y < size; y++) {
    let startX = -1;
    for (let x = 0; x < size; x++) {
      if (inside(x, y)) {
        if (startX < 0) startX = x;
      } else {
        if (startX >= 0) {
          rects.push({ x: startX, y, width: x - startX, height: 1 });
          startX = -1;
        }
      }
    }
    if (startX >= 0) {
      rects.push({ x: startX, y, width: size - startX, height: 1 });
    }
  }
  return rects;
}

function createOrbWindow() {
  const ORB_SIZE = 220;
  const ORB_CX = ORB_SIZE / 2;
  const ORB_CY = ORB_SIZE / 2;
  const ORB_R = 100;

  orbWindow = new BrowserWindow({
    width: ORB_SIZE,
    height: ORB_SIZE,
    x: 100,
    y: 100,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    type: 'toolbar',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  orbWindow.loadFile(path.join(__dirname, 'renderer', 'orb.html'));
  orbWindow.setAlwaysOnTop(true, 'screen-saver');
  orbWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Apply nonagon shape mask
  orbWindow.webContents.on('did-finish-load', () => {
    const mask = createNonagonMask(ORB_SIZE, ORB_CX, ORB_CY, ORB_R);
    orbWindow.setShape(mask);
  });

  // Initially hidden
  orbWindow.hide();

  orbWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    orbWindow?.hide();
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
    if (!isQuitting) focusMainWindow();
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
    // If a hotkey setting changed, re-register all shortcuts
    if (keyPath && keyPath.startsWith('settings.hotkey')) {
      registerShortcuts();
      // Notify main window so the UI can refresh displayed bindings
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config:updated', { key: keyPath, value });
      }
      return;
    }
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
    runState.activePool = identityPoolName || null;
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

    // Show orb
    if (orbWindow && !orbWindow.isDestroyed()) {
      orbWindow.show();
      orbWindow.webContents.send('orb:run-state', true);
      orbWindow.webContents.send('orb:show');
    }

    // Activate global shortcuts only while a run is active
    registerShortcuts();

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
        hideOverlayAndRefocus(overlayWindow);
      }, 700);
    }

    // Close formation window if open
    if (formationWindow && !formationWindow.isDestroyed()) {
      formationWindow.close();
    }

    // Reset orb
    if (orbWindow && !orbWindow.isDestroyed()) {
      orbWindow.webContents.send('orb:reset');
      orbWindow.hide();
    }

    pagerRequestLocked = false;
    runState.active = false;
    runState.currentTeam = null;
    queueManager.clear();
    stopFreeInstructionTimer();

    // Deactivate global shortcuts when run ends
    _registeredShortcuts.forEach(accel => {
      try { globalShortcut.unregister(accel); } catch (e) { /* ignore */ }
    });
    _registeredShortcuts = [];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config:updated', { key: 'shortcuts.active', value: false });
    }

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
        if (result.coreMechanics) {
          runState.coreMechanics = result.coreMechanics;
          if (orbWindow && !orbWindow.isDestroyed()) {
            orbWindow.webContents.send('orb:core-mechanic', result.coreMechanics);
          }
        }
      }
      if (phase === 'deploy_ego' && result.instructions && runState.currentTeam) {
        for (const inst of result.instructions) {
          const sinner = inst.meta?.sinner;
          const egoId = inst.meta?.egoId;
          // Skip force-base entries (egoId === 'base') — they're not real EGOs
          if (sinner && egoId && egoId !== 'base') {
            const entry = runState.currentTeam.get(sinner);
            if (entry && !entry.egoIds.includes(egoId)) {
              entry.egoIds.push(egoId);
            }
          }
        }
      }
      if (phase === 'cardpack' && result.instructions?.length > 0) {
        const meta = result.instructions[0].meta || {};
        runState.usedCardpackRerolls = meta.isReroll ? (runState.usedCardpackRerolls || 0) + 1 : 0;
      }
      if (phase === 'starlight' && result.starlightEffects) {
        runState.starlightEffects = result.starlightEffects;
      }
      if (!result.isGuidance) {
        runState.pendingBatchRemaining = Array.isArray(result.instructions) ? result.instructions.length : 1;
      }

      // Advance floor when boss_reward is requested (not on each instruction completion)
      if (phase === 'boss_reward') {
        runState.currentFloor = (runState.currentFloor || 1) + 1;
        runState.usedCardpackRerolls = 0;  // reset per floor
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

    // ── Orb notifications (mirrors pager:complete logic) ──
    if (!inst.isGuidance && orbWindow && !orbWindow.isDestroyed()) {
      const currentPhase = runState.currentPhase;
      if (currentPhase === 'dungeon' || !PHASE_ORDER.includes(currentPhase)) {
        orbWindow.webContents.send('orb:instruction-done');
      }
    }

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
    try {
      const definitions = await dataLoader.load('achievements');
      const progressMap = store.get('achievements') || {};
      return (definitions || []).map(def => ({
        ...def,
        ...(progressMap[def.id] || { completed: false, progress: 0 }),
      }));
    } catch (e) {
      console.error('[achievement:get-all] error:', e);
      return [];
    }
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

  // ── Reset accumulated stats ──
  ipcMain.handle('data:reset-stats', async () => {
    const defaults = getConfigDefaults();
    store.set('globalStats', defaults.globalStats);
    store.set('instructionHistory', []);
    store.set('achievements', {});
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('config:updated', { key: 'globalStats', value: defaults.globalStats });
    }
    return { success: true };
  });

  // ── Developer ──
  ipcMain.handle('dev:authenticate', (_event, password) => {
    return (password || '').trim() === 'dongxiongxianiao';
  });

  // Temporarily disable global shortcuts (e.g. while typing a password)
  // so single-letter shortcuts like "a" don't eat keystrokes in input fields.
  let _shortcutsDisabled = false;
  ipcMain.handle('dev:disable-shortcuts', () => {
    if (_shortcutsDisabled) return;
    _registeredShortcuts.forEach(accel => {
      try { globalShortcut.unregister(accel); } catch (e) { /* ignore */ }
    });
    _shortcutsDisabled = true;
  });
  ipcMain.handle('dev:enable-shortcuts', () => {
    if (!_shortcutsDisabled) return;
    // Only re-register if a run is currently active
    if (runState.active) {
      registerShortcuts();
    }
    _shortcutsDisabled = false;
  });

  // Test karma scare animation without affecting real stats
  ipcMain.handle('dev:test-karma-scare', (_event, karmaValue) => {
    const value = karmaValue || 150; // default test value
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
        `document.querySelector('.main').textContent = '${value} 业';`
      );
    });
    // Auto-close after 10s or on click
    setTimeout(() => {
      if (!scareWin.isDestroyed()) scareWin.close();
    }, 10000);
    scareWin.on('click', () => {
      if (!scareWin.isDestroyed()) scareWin.close();
    });
    return true;
  });

  // ── Windows ──
  ipcMain.handle('window:create-history', () => {
    createHistoryWindow();
  });

  ipcMain.handle('window:focus-main', () => {
    focusMainWindow();
  });

  // ── Sound ──
  ipcMain.handle('sound:play', (_event, name) => {
    soundManager.play(name);
  });

  // ── Orb IPC ──
  ipcMain.handle('orb:get-data', async () => {
    try {
      const relics = await dataLoader.load('relics');
      const events = await dataLoader.load('events');
      const fusions = await dataLoader.load('fusions');
      const cardpacks = await dataLoader.load('cardpacks');
      const coreMechanic = runState.coreMechanics || [];
      const imageDir = path.join(__dirname, 'resources', 'relics');
      return { relics, events, fusions, cardpacks, coreMechanic, imageDir };
    } catch (e) {
      return { relics: [], events: [], fusions: [], cardpacks: [], coreMechanic: [], imageDir: '' };
    }
  });

  // ── Vision IPC (Phase 10) ──

  ipcMain.handle('vision:start', async () => {
    const ok = await visionManager.start();
    return { ok };
  });

  ipcMain.handle('vision:stop', async () => {
    await visionManager.stop();
    return { ok: true };
  });

  ipcMain.handle('vision:status', () => {
    return { available: visionManager.available };
  });

  ipcMain.handle('vision:detect-phase', async () => {
    if (!visionManager.available) return { ok: false, error: 'Vision server not running' };
    const calibration = store.get('vision.calibration') || {};
    const region = calibration.gameRegion || null;
    const enabledPhases = store.get('enabledPhases') || [];
    const dungeonPhases = ['cardpack', 'route', 'combat', 'event', 'event_reward', 'judgment', 'shop', 'hidden_boss', 'boss_reward'];
    const phases = runState.currentPhase === 'dungeon'
      ? dungeonPhases.filter(p => enabledPhases.includes(p))
      : [runState.currentPhase].filter(p => enabledPhases.includes(p));
    if (phases.length === 0) return { ok: false, error: 'No enabled phases to detect' };
    const refsDir = path.join(userDataPath, 'refs');
    return visionManager.detectPhase({
      region,
      phases,
      conf_threshold: 0.75,
      refs_dir: refsDir,
    });
  });

  ipcMain.handle('vision:recognize-shop', async () => {
    if (!visionManager.available) return { ok: false, error: 'Vision server not running' };
    const calibration = store.get('vision.calibration') || {};
    const region = calibration.gameRegion || null;
    const shopGrid = calibration.shopGrid || null;
    if (!shopGrid) return { ok: false, error: 'Shop grid not calibrated' };
    const refsDir = path.join(userDataPath, 'refs', 'relics');
    return visionManager.recognizeShop({
      region,
      shop_grid: shopGrid,
      reference_dir: refsDir,
    });
  });

  ipcMain.handle('vision:calibrate', async (_event, params) => {
    if (!visionManager.available) return { ok: false, error: 'Vision server not running' };
    const { region, label } = params;
    return visionManager.calibrateCapture(region, label);
  });

  ipcMain.handle('vision:get-calibration', () => {
    return store.get('vision.calibration') || {};
  });

  ipcMain.handle('vision:save-calibration', (_event, calibration) => {
    store.set('vision.calibration', calibration);
    return { ok: true };
  });

  ipcMain.handle('vision:rebuild-icon-index', async () => {
    if (!visionManager.available) return { ok: false, error: 'Vision server not running' };
    const relicsDir = path.join(__dirname, 'resources', 'relics');
    const destDir = path.join(userDataPath, 'refs', 'relics');
    return visionManager.rebuildRelicIndex(relicsDir, destDir);
  });

  // ── Forward vision status events to main window ──
  visionManager.on('status-changed', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vision:status-changed', data);
    }
  });

  visionManager.on('error', (msg) => {
    console.error('[vision]', msg);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('vision:status-changed', { available: false, error: msg });
    }
  });

  ipcMain.handle('orb:get-bounds', () => {
    if (!orbWindow || orbWindow.isDestroyed()) return { x: 0, y: 0, width: 220, height: 220 };
    return orbWindow.getBounds();
  });

  ipcMain.handle('orb:move', (_event, x, y) => {
    if (orbWindow && !orbWindow.isDestroyed()) {
      orbWindow.setPosition(Math.round(x), Math.round(y));
    }
  });

  ipcMain.handle('orb:set-size', (_event, w, h) => {
    if (orbWindow && !orbWindow.isDestroyed()) {
      const oldBounds = orbWindow.getBounds();
      // Use setBounds (no animation) to avoid race conditions with setShape.
      // Preserve the current position — renderer will move window afterwards if needed.
      orbWindow.setBounds({
        x: oldBounds.x,
        y: oldBounds.y,
        width: w,
        height: h,
      }, false);
      // Delay setShape slightly so the OS has processed the resize before
      // we apply the pixel mask. Without this, repeated expand/collapse cycles
      // accumulate sizing errors (borders cut off, ghost transparent regions).
      setTimeout(() => {
        if (orbWindow && !orbWindow.isDestroyed()) {
          if (w === 220 && h === 220) {
            const mask = createNonagonMask(220, 110, 110, 100);
            orbWindow.setShape(mask);
          } else {
            // Stargazing view: rectangular mask
            orbWindow.setShape([{ x: 0, y: 0, width: w, height: h }]);
          }
        }
      }, 80);
    }
  });

  ipcMain.handle('orb:get-display', () => {
    const display = screen.getPrimaryDisplay();
    return display.workAreaSize;
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
    if (pagerRequestLocked) return;
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
    if (pagerRequestLocked) return;
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
        if (phaseId === 'deploy_ego' && result.instructions && runState.currentTeam) {
          for (const inst of result.instructions) {
            const sinner = inst.meta?.sinner;
            const egoId = inst.meta?.egoId;
            if (sinner && egoId && egoId !== 'base') {
              const entry = runState.currentTeam.get(sinner);
              if (entry && !entry.egoIds.includes(egoId)) {
                entry.egoIds.push(egoId);
              }
            }
          }
        }
        if (phaseId === 'cardpack' && result.instructions?.length > 0) {
          const meta = result.instructions[0].meta || {};
          runState.usedCardpackRerolls = meta.isReroll ? (runState.usedCardpackRerolls || 0) + 1 : 0;
        }
        if (phaseId === 'starlight' && result.starlightEffects) {
          runState.starlightEffects = result.starlightEffects;
        }
        // Advance floor on boss_reward (same as instruction:generate path)
        if (phaseId === 'boss_reward') {
          runState.currentFloor = (runState.currentFloor || 1) + 1;
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
    focusMainWindow();
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
      // Notify orb: identity deployment complete
      if (orbWindow && !orbWindow.isDestroyed()) {
        orbWindow.webContents.send('orb:phase-complete', { phase: 'deploy_identity' });
      }
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

    // ── Orb notifications ──
    if (!inst.isGuidance) {
      const preAdvancePhase = runState.currentPhase;

      // Pre-dungeon phases: notify orb when batch is complete
      if (PHASE_ORDER.includes(runState.currentPhase) && runState.currentPhase !== 'dungeon') {
        if (runState.pendingBatchRemaining <= 1) {
          // This was the last instruction in this phase's batch
          if (orbWindow && !orbWindow.isDestroyed()) {
            orbWindow.webContents.send('orb:phase-complete', { phase: preAdvancePhase });
          }
        }
      }

      // Dungeon phase: each instruction opens an eye
      if (runState.currentPhase === 'dungeon' || !PHASE_ORDER.includes(runState.currentPhase)) {
        if (orbWindow && !orbWindow.isDestroyed()) {
          orbWindow.webContents.send('orb:instruction-done');
        }
      }
    }
    await recordInstructionHistory(inst, 'completed');

    // Floor is now advanced when boss_reward is requested (instruction:generate),
    // not on each instruction completion, to handle hard mode's 2-pick correctly.

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
          scheduleAutoDetect();
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
            // Re-lock to protect the regenerated instruction
            runState.pendingBatchRemaining = Array.isArray(cardpackResult.instructions) ? cardpackResult.instructions.length : 1;
            lockPagerRequest();
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
          scheduleAutoDetect();
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
let _registeredShortcuts = []; // track accelerators for unregister

/**
 * Register all global shortcuts from current store settings.
 * Called on startup and whenever shortcut bindings change.
 */
function registerShortcuts() {
  // Unregister all existing shortcuts
  _registeredShortcuts.forEach(accel => {
    try { globalShortcut.unregister(accel); } catch (e) { /* ignore */ }
  });
  _registeredShortcuts = [];

  const hotkeys = {
    request:        store.get('settings.hotkeyRequest')        || 'F9',
    toggleOverlay:  store.get('settings.hotkeyToggleOverlay')  || 'F10',
    vetoDanmaku:    store.get('settings.hotkeyVetoDanmaku')    || 'F11',
    complete:       store.get('settings.hotkeyComplete')       || 'F2',
    fail:           store.get('settings.hotkeyFail')           || 'F3',
  };

  // ── Handler: Request instruction (open phase picker on overlay) ──
  function handleRequest() {
    if (pagerRequestLocked) return;
    if (!runState.active || !overlayWindow || overlayWindow.isDestroyed()) return;
    const isDungeon = runState.currentPhase === 'dungeon';
    const enabledPhases = store.get('enabledPhases') || [];
    let phases;
    if (isDungeon) {
      phases = DUNGEON_PHASES.filter(id => enabledPhases.includes(id)).map(id => ({ id, label: PHASE_LABELS[id] || id }));
    } else {
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
    overlayWindow.webContents.send('pager:show-phase-picker', { phases, isDungeon });
  }

  // ── Handler: Toggle overlay visibility ──
  function handleToggleOverlay() {
    if (!runState.active) return;
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      createOverlayWindow();
      return;
    }
    try {
      const vis = overlayWindow.isVisible();
      const min = overlayWindow.isMinimized();
      if (vis && !min) {
        hideOverlayAndRefocus(overlayWindow);
      } else {
        if (min) overlayWindow.restore();
        overlayWindow.show();
        overlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    } catch (e) {
      console.error('[shortcut] Toggle overlay error:', e);
    }
  }

  // ── Handler: Veto danmaku vote ──
  function handleVetoDanmaku() {
    if (runState.danmakuVoteActive && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('shortcut:f11-pressed');
    }
  }

  // ── Handler: Complete (delegates to overlay for animation + state check) ──
  function handleComplete() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('pager:shortcut-complete');
    }
  }

  // ── Handler: Fail (delegates to overlay for animation + state check) ──
  function handleFail() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('pager:shortcut-fail');
    }
  }

  const handlers = {
    request: handleRequest,
    toggleOverlay: handleToggleOverlay,
    vetoDanmaku: handleVetoDanmaku,
    complete: handleComplete,
    fail: handleFail,
  };

  for (const [action, accel] of Object.entries(hotkeys)) {
    if (!accel) continue;
    try {
      const ok = globalShortcut.register(accel, handlers[action]);
      if (ok) {
        _registeredShortcuts.push(accel);
      } else {
        if (/^Mouse/.test(accel)) {
          console.warn(`[shortcut] Mouse buttons are not supported as global shortcuts. "${accel}" (${action}) will not work while the game is focused.`);
        } else {
          console.warn(`[shortcut] Failed to register "${accel}" (${action}) — may conflict with another app`);
        }
      }
    } catch (e) {
      console.warn(`[shortcut] Error registering "${accel}":`, e.message);
    }
  }

  console.log('[shortcut] Registered:', _registeredShortcuts.join(', '));
}

// ── App lifecycle ──

// ── Single-instance lock (prevents F10 shortcut conflicts) ──
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _cmdLine, _workingDir) => {
    // Focus existing main window instead of opening a second one
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Fix GPU disk cache error on Windows (access denied to cache dir)
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

// Global unhandled rejection handler (prevent silent failures)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

app.whenReady().then(async () => {
  // Initialize data services
  const userDataPath = app.getPath('userData');
  _userDataPath = userDataPath;
  const bundledPath = path.join(__dirname, 'data');

  // ── Store must init first so we can read dataVersion ──
  store = new Store({ defaults: getConfigDefaults() });

  // ── Data version check: clear stale userData when bundled data is newer ──
  const storedDataVersion = store.get('dataVersion') || 0;
  if (DATA_VERSION > storedDataVersion) {
    const fs = require('fs');
    const userDataDir = path.join(userDataPath, 'data');
    try {
      const files = await fs.promises.readdir(userDataDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          await fs.promises.unlink(path.join(userDataDir, f));
        }
      }
      console.log(`[data-version] Cleared ${files.filter(f => f.endsWith('.json')).length} stale userData files (v${storedDataVersion} → v${DATA_VERSION})`);
    } catch (e) {
      // userData/data/ doesn't exist yet — noop
    }
    store.set('dataVersion', DATA_VERSION);
  }

  // ── Now safe to create dataLoader (userData is clean if version bumped) ──
  dataLoader = new DataLoader(userDataPath, bundledPath);

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
  visionManager = new VisionManager(userDataPath, bundledPath);
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

  // Create windows (pager starts hidden, shown only when run starts)
  createMainWindow();
  createOverlayWindow();
  createOrbWindow();
  // Hide pager at startup — it only appears when 谨遵指令 is clicked
  overlayWindow.hide();

  // Register IPC handlers (shortcuts are registered only during active runs)
  registerIpcHandlers();

  console.log('[main] 谨遵指令 started');
});

app.on('before-quit', () => {
  isQuitting = true;
  stopFreeInstructionTimer();
  if (hideOverlayTimeout) {
    clearTimeout(hideOverlayTimeout);
    hideOverlayTimeout = null;
  }
  if (visionManager) {
    visionManager.stop().catch(() => {});
  }
  if (autoDetectTimer) {
    clearTimeout(autoDetectTimer);
    autoDetectTimer = null;
  }
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
