// 环节时序状态机：把逐帧的锚点得分变成稳定的「现在在哪一页」
// 两条防线：① 迟滞（连续 N 帧一致 + 领先幅度足够）② 合法转移图（非法跳转直接丢）

const PHASES = [
  'cardpack',
  'route',
  'combat',
  'combat_battle',
  'event',
  'judgment',
  'event_reward',
  'shop',
  'boss_reward',
];

// 地牢里的实际流转：选卡包 → 路线 → 各种节点 → 关底奖励 → 回到选卡包
// 允许「自环」（同一页多帧）与少量合理回退（比如误触返回）。
const LEGAL = {
  cardpack: ['route', 'cardpack', 'combat', 'event', 'shop'],
  route: ['cardpack', 'route', 'combat', 'event', 'shop', 'boss_reward', 'judgment'],
  combat: ['combat_battle', 'combat', 'route', 'boss_reward'],
  combat_battle: ['combat', 'combat_battle', 'route', 'boss_reward'],
  event: ['judgment', 'event_reward', 'event', 'route'],
  judgment: ['event', 'judgment', 'event_reward', 'route'],
  event_reward: ['route', 'event_reward', 'cardpack'],
  shop: ['route', 'shop', 'event', 'cardpack'],
  boss_reward: ['cardpack', 'boss_reward', 'route'],
};

const DEFAULTS = {
  holdFrames: 3, // 合法转移：连续多少帧一致才切换
  illegalHoldFrames: 4, // 图上没画的转移：多要一帧证据才认（不直接丢，避免死锁）
  leadRatio: 1.15, // 候选得分要比当前高多少才算「真的换了」（比例门槛）
  leadAbs: 0.06, // 绝对领先门槛：只要拉开这么多就够，避免比例门槛在小分差时死锁
  minScore: 0.45, // 低于这个分数视为「认不出来」
};

class VisionStateMachine {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.legal = opts.legal || LEGAL;
    this.reset();
  }

  reset(initial = null) {
    this.phase = initial;
    this.candidate = null;
    this.candidateCount = 0;
    this.history = [];
    this.lastScores = null;
    this.rejected = [];
    return this;
  }

  /** 取分数最高的环节 */
  static argmax(scores) {
    let best = null;
    let bestScore = -Infinity;
    for (const k of Object.keys(scores)) {
      if (scores[k] > bestScore) {
        bestScore = scores[k];
        best = k;
      }
    }
    return { phase: best, score: bestScore };
  }

  /**
   * 喂一帧的锚点得分。
   * @param {Record<string, number>} scores 每个环节的相似度，0~1
   * @returns {{phase: string|null, changed: boolean, confident: boolean, reason: string}}
   */
  observe(scores) {
    this.lastScores = scores;
    const { phase: top, score: topScore } = VisionStateMachine.argmax(scores);
    const confident = topScore >= this.cfg.minScore;

    if (this.phase === null) {
      // 冷启动：连续 holdFrames 帧都指向同一页才认
      if (top === this.candidate) this.candidateCount++;
      else {
        this.candidate = top;
        this.candidateCount = 1;
      }
      if (confident && this.candidateCount >= this.cfg.holdFrames) {
        this.phase = top;
        this.candidateCount = 0;
        this.candidate = null;
        this._push(top, 'boot');
        return { phase: this.phase, changed: true, confident, reason: 'boot' };
      }
      return { phase: null, changed: false, confident, reason: 'cold' };
    }

    const currentScore = scores[this.phase] ?? 0;

    // 仍是当前页：清空候选
    if (top === this.phase) {
      this.candidate = null;
      this.candidateCount = 0;
      return { phase: this.phase, changed: false, confident, reason: 'hold' };
    }

    // 切换需要足够领先，否则当作抖动。
    // 用「绝对差 + 比例」双门槛：单纯乘系数时，旧页残留 0.48 / 新页 0.50 永远达不到 1.15 倍，
    // 会每帧清空候选、死锁在旧环节；而旧页得分为负时比例门槛又会完全失效。
    const lead = topScore - currentScore;
    const enoughLead = lead >= this.cfg.leadAbs || topScore >= currentScore * this.cfg.leadRatio;
    if (!confident || !enoughLead) {
      this.candidate = null;
      this.candidateCount = 0;
      return { phase: this.phase, changed: false, confident, reason: 'weak' };
    }

    // 非法转移不直接丢：图上没画的跳转在真实操作里确实会发生（比如打完直接回路线再进事件），
    // 只是要求更多帧证据，否则会死锁在某一页。
    const allowed = this.legal[this.phase] || [];
    const legal = allowed.includes(top);

    if (top === this.candidate) this.candidateCount++;
    else {
      this.candidate = top;
      this.candidateCount = 1;
    }

    const need = legal ? this.cfg.holdFrames : this.cfg.illegalHoldFrames;
    if (this.candidateCount >= need) {
      const from = this.phase;
      this.phase = top;
      this.candidate = null;
      this.candidateCount = 0;
      this._push(top, `from:${from}`);
      if (!legal) this.rejected.push({ from, to: top, score: topScore, frames: need });
      return { phase: this.phase, changed: true, confident, reason: `switch:${from}->${top}${legal ? '' : '(illegal)'}` };
    }
    return { phase: this.phase, changed: false, confident, reason: legal ? 'pending' : 'pending-illegal' };
  }

  _push(phase, why) {
    this.history.push({ phase, why, at: this.history.length });
  }
}

module.exports = { PHASES, LEGAL, DEFAULTS, VisionStateMachine };
