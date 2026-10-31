/**
 * preload.js — Context bridge API for 谨遵指令.
 * Exposes different APIs to main window vs overlay window.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Detect which window this preload is running in
const isOverlay = document.location.href.includes('overlay.html');
const isOrb = document.location.href.includes('orb.html');
const isFormation = document.location.href.includes('formation.html');
const isWeaver = document.location.href.includes('weaver.html');

if (isFormation || isWeaver) {
  // ── Formation / Weaver Window API ──
  const api = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  };
  if (isWeaver) {
    api.onWeaverEvent = (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('weaver:event', handler);
      return () => ipcRenderer.removeListener('weaver:event', handler);
    };
  }
  contextBridge.exposeInMainWorld('api', api);

} else if (isOverlay) {
  // ── Pager (Overlay) Window API ──
  contextBridge.exposeInMainWorld('pagerAPI', {
    // Fire-and-forget: notify main process
    notifyReady: () => ipcRenderer.send('pager:ready'),
    complete: () => ipcRenderer.send('pager:complete'),
    fail: () => ipcRenderer.send('pager:fail'),
    minimize: () => ipcRenderer.send('pager:minimize'),
    guidanceNext: () => ipcRenderer.send('pager:guidance-next'),
    guidancePrev: () => ipcRenderer.send('pager:guidance-prev'),
    guidanceDismiss: () => ipcRenderer.send('pager:guidance-dismiss'),
    requestInstruction: () => ipcRenderer.send('pager:request-instruction'),
    generateInstruction: (phaseId) => ipcRenderer.send('pager:generate-instruction', phaseId),
    skipPhase: () => ipcRenderer.send('pager:skip-phase'),
    openFormation: () => ipcRenderer.send('pager:open-formation'),

    // Subscribe to events from main process
    onShowInstruction: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('pager:show-instruction', handler);
      return () => ipcRenderer.removeListener('pager:show-instruction', handler);
    },
    onShowWarning: (callback) => {
      const handler = (_event, msg) => callback(msg);
      ipcRenderer.on('pager:show-warning', handler);
      return () => ipcRenderer.removeListener('pager:show-warning', handler);
    },
    onShowWaiting: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('pager:show-waiting', handler);
      return () => ipcRenderer.removeListener('pager:show-waiting', handler);
    },
    onUpdateStats: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('pager:update-stats', handler);
      return () => ipcRenderer.removeListener('pager:update-stats', handler);
    },
    onShutdown: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('pager:shutdown', handler);
      return () => ipcRenderer.removeListener('pager:shutdown', handler);
    },
    onPlaySound: (callback) => {
      const handler = (_event, filePath) => callback(filePath);
      ipcRenderer.on('pager:play-sound', handler);
      return () => ipcRenderer.removeListener('pager:play-sound', handler);
    },
    onShowPhasePicker: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('pager:show-phase-picker', handler);
      return () => ipcRenderer.removeListener('pager:show-phase-picker', handler);
    },
    onLockRequest: (callback) => {
      const handler = (_event, locked) => callback(locked);
      ipcRenderer.on('pager:lock-request', handler);
      return () => ipcRenderer.removeListener('pager:lock-request', handler);
    },
    onShortcutComplete: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('pager:shortcut-complete', handler);
      return () => ipcRenderer.removeListener('pager:shortcut-complete', handler);
    },
    onShortcutFail: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('pager:shortcut-fail', handler);
      return () => ipcRenderer.removeListener('pager:shortcut-fail', handler);
    },
  });

} else if (isOrb) {
  // ── Orb Window API v4 (circular orb + separate stargazing window) ──
  contextBridge.exposeInMainWorld('orbAPI', {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),

    // Temporarily disable global shortcuts (e.g. while typing in a text field)
    disableShortcuts: () => ipcRenderer.invoke('dev:disable-shortcuts'),
    enableShortcuts: () => ipcRenderer.invoke('dev:enable-shortcuts'),

    // Detect which mode to show (orb vs stargazing)
    onMode: (callback) => {
      const handler = (_event, mode) => callback(mode);
      ipcRenderer.on('orb:mode', handler);
      return () => ipcRenderer.removeListener('orb:mode', handler);
    },

    onPhaseComplete: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('orb:phase-complete', handler);
      return () => ipcRenderer.removeListener('orb:phase-complete', handler);
    },
    onInstructionDone: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('orb:instruction-done', handler);
      return () => ipcRenderer.removeListener('orb:instruction-done', handler);
    },
    onRunState: (callback) => {
      const handler = (_event, active) => callback(active);
      ipcRenderer.on('orb:run-state', handler);
      return () => ipcRenderer.removeListener('orb:run-state', handler);
    },
    onShow: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('orb:show', handler);
      return () => ipcRenderer.removeListener('orb:show', handler);
    },
    onReset: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('orb:reset', handler);
      return () => ipcRenderer.removeListener('orb:reset', handler);
    },
  });

} else {
  // ── Main Window API ──
  contextBridge.exposeInMainWorld('electronAPI', {
    // ── Data ──
    loadData: (type) => ipcRenderer.invoke('data:load', type),
    saveData: (type, data) => ipcRenderer.invoke('data:save', type, data),
    listDataTypes: () => ipcRenderer.invoke('data:list-types'),

    // ── Config ──
    getConfig: (keyPath) => ipcRenderer.invoke('config:get', keyPath),
    setConfig: (keyPath, value) => ipcRenderer.invoke('config:set', keyPath, value),

    // ── Free templates ──
    getFreeTemplates: () => ipcRenderer.invoke('templates:get-free'),
    saveFreeTemplates: (custom, hidden) => ipcRenderer.invoke('templates:save-free', custom, hidden),
    onConfigUpdated: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('config:updated', handler);
      return () => ipcRenderer.removeListener('config:updated', handler);
    },

    // ── Run management ──
    startRun: (identityPool, egoPool) =>
      ipcRenderer.invoke('run:start', identityPool, egoPool),
    endRun: () => ipcRenderer.invoke('run:end'),
    getRunState: () => ipcRenderer.invoke('run:get-state'),
    onRunStateChanged: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('run:state-changed', handler);
      return () => ipcRenderer.removeListener('run:state-changed', handler);
    },

    // ── Instructions ──
    generateInstruction: (phase, context) =>
      ipcRenderer.invoke('instruction:generate', phase, context),
    completeInstruction: () => ipcRenderer.invoke('instruction:complete'),
    failInstruction: () => ipcRenderer.invoke('instruction:fail'),
    getInstructionQueue: () => ipcRenderer.invoke('instruction:get-queue'),
    getInstructionHistory: () => ipcRenderer.invoke('instruction:get-history'),
    onQueueUpdate: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('instruction:queue-update', handler);
      return () => ipcRenderer.removeListener('instruction:queue-update', handler);
    },
    onInstructionNew: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('instruction:new', handler);
      return () => ipcRenderer.removeListener('instruction:new', handler);
    },
    onInstructionProcessed: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('instruction:processed', handler);
      return () => ipcRenderer.removeListener('instruction:processed', handler);
    },

    // ── Achievements ──
    checkAchievements: () => ipcRenderer.invoke('achievement:check'),
    getAllAchievements: () => ipcRenderer.invoke('achievement:get-all'),
    onAchievementUnlocked: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('achievement:unlocked', handler);
      return () => ipcRenderer.removeListener('achievement:unlocked', handler);
    },

    // ── Reset stats ──
    resetStats: () => ipcRenderer.invoke('data:reset-stats'),

    // ── Developer ──
    devAuth: (password) => ipcRenderer.invoke('dev:authenticate', password),
    testKarmaScare: (value) => ipcRenderer.invoke('dev:test-karma-scare', value),
    disableShortcuts: () => ipcRenderer.invoke('dev:disable-shortcuts'),
    enableShortcuts: () => ipcRenderer.invoke('dev:enable-shortcuts'),

    // ── Milestones ──
    recordMilestone: (type) => ipcRenderer.invoke('milestone:record', type),

    // ── Windows ──
    openHistoryWindow: () => ipcRenderer.invoke('window:create-history'),
    openWeaver: () => ipcRenderer.invoke('weaver:open'),

    // ── Sound ──
    playSound: (name) => ipcRenderer.invoke('sound:play', name),
    onPlaySound: (callback) => {
      const handler = (_event, name) => callback(name);
      ipcRenderer.on('pager:play-sound', handler);
      return () => ipcRenderer.removeListener('pager:play-sound', handler);
    },

    // ── Shortcuts ──
    onShortcutF9: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('shortcut:f9-pressed', handler);
      return () => ipcRenderer.removeListener('shortcut:f9-pressed', handler);
    },
    onShortcutF11: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('shortcut:f11-pressed', handler);
      return () => ipcRenderer.removeListener('shortcut:f11-pressed', handler);
    },

    // ── Phase management ──
    getRunPhase: () => ipcRenderer.invoke('run:get-phase'),
    advancePhase: () => ipcRenderer.invoke('run:advance-phase'),
    skipPhase: () => ipcRenderer.invoke('run:skip-phase'),
    onPhaseChanged: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('run:phase-changed', handler);
      return () => ipcRenderer.removeListener('run:phase-changed', handler);
    },

    // ── Team mechanic ──
    getTeamMechanic: () => ipcRenderer.invoke('run:get-team-mechanic'),

    // ── Window focus ──
    focusWindow: () => ipcRenderer.invoke('window:focus-main'),

    // ── Vision (Phase 10) ──
    visionStart: () => ipcRenderer.invoke('vision:start'),
    visionStop: () => ipcRenderer.invoke('vision:stop'),
    visionStatus: () => ipcRenderer.invoke('vision:status'),
    visionDetectPhase: () => ipcRenderer.invoke('vision:detect-phase'),
    visionRecognizeShop: () => ipcRenderer.invoke('vision:recognize-shop'),
    visionCalibrate: (params) => ipcRenderer.invoke('vision:calibrate', params),
    visionGetCalibration: () => ipcRenderer.invoke('vision:get-calibration'),
    visionSaveCalibration: (cal) => ipcRenderer.invoke('vision:save-calibration', cal),
    visionRebuildIconIndex: () => ipcRenderer.invoke('vision:rebuild-icon-index'),
    onVisionStatusChanged: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on('vision:status-changed', handler);
      return () => ipcRenderer.removeListener('vision:status-changed', handler);
    },

    // ── Vision capture v2 (Phase 0 · 窗口级采集) ──
    vision2Open: () => ipcRenderer.invoke('vision2:open'),
    vision2Phases: () => ipcRenderer.invoke('vision2:phases'),
    vision2ListWindows: () => ipcRenderer.invoke('vision2:list-windows'),
    vision2Attach: (sourceId, name) => ipcRenderer.invoke('vision2:attach', sourceId, name),
    vision2Detach: () => ipcRenderer.invoke('vision2:detach'),
    vision2SetPhase: (phase) => ipcRenderer.invoke('vision2:set-phase', phase),
    vision2SaveFrame: (label) => ipcRenderer.invoke('vision2:save-frame', label),
    vision2Auto: (on, intervalMs) => ipcRenderer.invoke('vision2:auto', on, intervalMs),
    vision2OpenDir: () => ipcRenderer.invoke('vision2:open-dir'),
    vision2Stats: () => ipcRenderer.invoke('vision2:stats'),
    vision2GrabThumb: () => ipcRenderer.invoke('vision2:grab-thumb'),
    vision2Frame: (payload) => ipcRenderer.send('vision2:frame', payload),
    vision2CaptureError: (payload) => ipcRenderer.send('vision2:capture-error', payload),
    vision2Attached: (payload) => ipcRenderer.send('vision2:attached', payload),
    onVision2DoAttach: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('vision2:do-attach', handler);
      return () => ipcRenderer.removeListener('vision2:do-attach', handler);
    },
    onVision2DoDetach: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('vision2:do-detach', handler);
      return () => ipcRenderer.removeListener('vision2:do-detach', handler);
    },
    onVision2Grab: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('vision2:grab', handler);
      return () => ipcRenderer.removeListener('vision2:grab', handler);
    },
    onVision2State: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('vision2:state', handler);
      return () => ipcRenderer.removeListener('vision2:state', handler);
    },
    onVision2Phase: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('vision2:phase', handler);
      return () => ipcRenderer.removeListener('vision2:phase', handler);
    },
    vision2LiveStart: (intervalMs) => ipcRenderer.invoke('vision2:live-start', intervalMs),
    vision2LiveStop: () => ipcRenderer.invoke('vision2:live-stop'),
    vision2LiveStatus: () => ipcRenderer.invoke('vision2:live-status'),
    vision2LiveClassify: () => ipcRenderer.invoke('vision2:live-classify'),
    vision2SetDifficulty: (v) => ipcRenderer.invoke('vision2:set-difficulty', v),
  });
}
