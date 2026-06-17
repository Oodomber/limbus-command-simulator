/**
 * AchievementSystem — Evaluates achievement conditions and tracks progress.
 * Supports JSON condition trees with AND/OR/NOT logic.
 */

class AchievementSystem {
  /**
   * @param {import('./dataLoader').DataLoader} dataLoader
   * @param {object} store — electron-store instance
   */
  constructor(dataLoader, store) {
    this.dataLoader = dataLoader;
    this.store = store;
  }

  /**
   * Check all achievement definitions against current stats.
   * Only evaluates incomplete achievements.
   * @param {object} [runContext] — optional current run state for run-level conditions
   * @returns {Promise<Array>} Newly unlocked achievements
   */
  async checkAll(runContext = {}) {
    const definitions = await this.dataLoader.load('achievements');
    if (!Array.isArray(definitions) || definitions.length === 0) return [];

    const progressMap = this.store.get('achievements') || {};
    const stats = this.store.get('globalStats') || {};

    const newlyUnlocked = [];

    for (const def of definitions) {
      if (!def || !def.id) continue;

      const current = progressMap[def.id];
      if (current && current.completed) continue;

      const context = { globalStats: stats, achievements: progressMap, runState: runContext };
      const condition = AchievementSystem.normalizeCondition(def.condition);

      const satisfied = this.evaluate(condition, context);
      if (satisfied) {
        progressMap[def.id] = {
          completed: true,
          completedAt: Date.now(),
          progress: this._getTargetCount(condition),
        };
        newlyUnlocked.push(def);
      } else {
        const progress = this._countProgress(condition, context);
        progressMap[def.id] = { completed: false, progress };
      }
    }

    if (newlyUnlocked.length > 0) {
      this.store.set('achievements', progressMap);
    } else if (Object.keys(progressMap).length > 0) {
      // Still save progress updates
      this.store.set('achievements', progressMap);
    }

    return newlyUnlocked;
  }

  /**
   * Recursively evaluate a condition tree node.
   * @param {object} node — Condition node
   * @param {object} context — { globalStats, achievements, runState }
   * @returns {boolean}
   */
  evaluate(node, context) {
    if (!node || !node.type) return false;

    switch (node.type) {
      // ── Logical combinators ──
      case 'and':
        return (node.conditions || []).every(c => this.evaluate(c, context));
      case 'or':
        return (node.conditions || []).some(c => this.evaluate(c, context));
      case 'not':
        return !this.evaluate(node.condition, context);

      // ── Global stat conditions ──
      case 'clearMirror':
        return (context.globalStats.mirrorClears || 0) >= (node.count || 1);
      case 'dieFirstFloor':
        return (context.globalStats.firstFloorDeaths || 0) >= (node.count || 1);
      case 'blessingGlobal':
        return (context.globalStats.totalBlessing || 0) >= (node.count || 1);
      case 'karmaGlobal':
        return (context.globalStats.totalKarma || 0) >= (node.count || 1);
      case 'completeInstruction':
        return (context.globalStats.totalInstructionsCompleted || 0) >= (node.count || 1);
      case 'failInstruction':
        return (context.globalStats.totalInstructionsFailed || 0) >= (node.count || 1);
      case 'refuseHiddenBoss':
        return (context.globalStats.hiddenBossRefusals || 0) >= (node.count || 1);
      case 'danmakuCompleted':
        return (context.globalStats.danmakuInstructionsCompleted || 0) >= (node.count || 1);

      // ── Run-level conditions ──
      case 'blessingRun':
        return (context.runState?.currentRunBlessing || 0) >= (node.count || 1);
      case 'karmaRun':
        return (context.runState?.currentRunKarma || 0) >= (node.count || 1);

      // ── Identity/EGO usage ──
      case 'useIdentity':
        if (!context.runState?.currentTeam) return false;
        return [...context.runState.currentTeam.values()]
          .some(v => v.identityId === node.id);
      case 'useEgo':
        if (!context.runState?.currentTeam) return false;
        return [...context.runState.currentTeam.values()]
          .some(v => (v.egoIds || []).includes(node.id));

      // ── Pool usage ──
      case 'usePool':
        return context.runState?.activePool === node.poolName;

      default:
        console.warn(`[Achievements] Unknown condition type: ${node.type}`);
        return false;
    }
  }

  /**
   * Calculate numeric progress for a condition tree.
   */
  _countProgress(node, context) {
    if (!node || !node.type) return 0;

    switch (node.type) {
      case 'and':
        if (!node.conditions || node.conditions.length === 0) return 0;
        const minValues = node.conditions.map(c => this._countProgress(c, context));
        return Math.min(...minValues);
      case 'or':
        if (!node.conditions || node.conditions.length === 0) return 0;
        const maxValues = node.conditions.map(c => this._countProgress(c, context));
        return Math.max(...maxValues);
      case 'not':
        return this.evaluate(node, context) ? 1 : 0;
      case 'clearMirror':        return context.globalStats.mirrorClears || 0;
      case 'dieFirstFloor':      return context.globalStats.firstFloorDeaths || 0;
      case 'blessingGlobal':     return context.globalStats.totalBlessing || 0;
      case 'karmaGlobal':        return context.globalStats.totalKarma || 0;
      case 'blessingRun':        return context.runState?.currentRunBlessing || 0;
      case 'karmaRun':           return context.runState?.currentRunKarma || 0;
      case 'completeInstruction': return context.globalStats.totalInstructionsCompleted || 0;
      case 'failInstruction':    return context.globalStats.totalInstructionsFailed || 0;
      case 'refuseHiddenBoss':   return context.globalStats.hiddenBossRefusals || 0;
      case 'danmakuCompleted':   return context.globalStats.danmakuInstructionsCompleted || 0;
      case 'useIdentity':
      case 'useEgo':
      case 'usePool':
        return this.evaluate(node, context) ? 1 : 0;
      default:
        return this.evaluate(node, context) ? 1 : 0;
    }
  }

  /**
   * Get the target count from a condition tree (for displaying max progress).
   */
  _getTargetCount(node) {
    if (!node || !node.type) return 1;

    switch (node.type) {
      case 'and':
        return Math.min(...(node.conditions || []).map(c => this._getTargetCount(c)));
      case 'or':
        return Math.max(...(node.conditions || []).map(c => this._getTargetCount(c)));
      case 'not':
        return 1;
      default:
        return node.count || 1;
    }
  }

  /**
   * Normalize legacy string-format conditions to JSON tree format.
   * "clearMirror 15" -> { type: "clearMirror", count: 15 }
   */
  static normalizeCondition(condition) {
    if (typeof condition === 'string') {
      const parts = condition.trim().split(/\s+/);
      const type = parts[0];
      const count = parts.length > 1 ? parseInt(parts[1], 10) : 1;
      return { type, count };
    }
    return condition;
  }
}

module.exports = { AchievementSystem };
