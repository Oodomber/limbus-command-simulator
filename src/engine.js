/**
 * InstructionEngine — Generates instructions for each game phase.
 *
 * Phase order (pre-dungeon):
 *   deploy_identity → deploy_ego → starlight → starting_relic → dungeon(free)
 *
 * Dungeon free phases:
 *   cardpack, route, combat, event, event_reward, shop, hidden_boss, judgment, boss_reward
 *
 * Global parameters (via context):
 *   - infoCompleteness (0~1): affects precise vs vague templates
 *   - rationality (0~1): raw random, adjusted by blessing/karma before threshold check
 *   - blessing / karma: shift the rational/irrational threshold
 *   - currentFloor (1~15): current mirror dungeon floor
 *   - isHardMode: parallel superposition enabled
 *   - starlightEffects: from starlight phase, affects subsequent phases
 *   - formation: array of 12 sinner names for combat targeting
 */

const PHASES = {
  DEPLOY_IDENTITY:  'deploy_identity',
  DEPLOY_EGO:       'deploy_ego',
  STARLIGHT:        'starlight',
  STARTING_RELIC:   'starting_relic',
  CARDPACK:         'cardpack',
  ROUTE:            'route',
  COMBAT:           'combat',
  EVENT:            'event',
  EVENT_REWARD:     'event_reward',
  JUDGMENT:         'judgment',
  SHOP:             'shop',
  HIDDEN_BOSS:      'hidden_boss',
  BOSS_REWARD:      'boss_reward',
  FREE:             'free',
};

const GUIDANCE_PHASES = new Set([
  PHASES.DEPLOY_IDENTITY,
  PHASES.DEPLOY_EGO,
]);

const SINNERS = [
  '李箱', '浮士德', '堂吉诃德', '良秀', '默尔索', '鸿璐',
  '希斯克利夫', '以实玛利', '罗佳', '辛克莱', '奥提斯', '格里高尔'
];

const EGO_LEVELS = ['ZAYIN', 'TETH', 'HE', 'WAW'];

const ROUTE_OPTIONS = ['上', '中', '下'];

const STARLIGHT_IDS = {
  INTERSTELLAR_TRAVEL: 'star_agility',    // 星际旅行 — +1 cardpack shown
  METEOR_RAIN:         'star_life',       // 倾落的流星雨 — +1 starting relic
  DOUBLE_STAR_SHOP:    'star_protection', // 双星商店 — double shop items
  FULL_POSSIBILITY:    'star_fortune',    // 全面的可能性 — +1 cardpack & relic
};

const GOLDEN_BOUGH_TYPES = ['PIGRITIA', 'SUPERBIA', 'MOROSITAS', 'IRA'];

const SHOP_EFFECT_TAGS = ['烧伤', '流血', '震颤', '破裂', '沉沦', '呼吸法', '充能', '打击', '斩击', '突刺'];

// ── Default templates ──
const DEFAULT_TEMPLATES = {
  deploy_identity: [
    '致：{sinner}必须装备人格【{identity}】。',
    '{sinner}，你被指定使用{identity}。',
    '指令下达：{sinner}的人格应为{identity}。',
  ],
  deploy_identity_vague: [
    '致：{sinner}需使用具有{tags}特质的人格。',
    '{sinner}，寻找具备{tags}特质的人格。',
    '这一局，{sinner}应使用具有{tags}特质的人格。',
  ],
  deploy_ego: [
    '致：{sinner}必须装备EGO【{ego}】。',
    '{sinner}，本次携带EGO——{ego}。',
    '指令下达：{sinner}应装备{ego}。',
  ],
  deploy_ego_force_base: [
    '致：{sinner}必须仅使用初始EGO。',
  ],

  starlight: [
    '致：选择星光【{name}】至{level}级。',
    '本次星光强化指定：{name}，强化{level}级。',
  ],
  starlight_none: [
    '本轮不选择任何星光。',
    '致：不进行星光选择。',
  ],
  starting_relic: [
    '致：选择{effect}饰品作为开局饰品。',
    '开局饰品指定：{effect}类饰品。',
    '致：以{effect}饰品起始本局。',
  ],
  starting_relic_none: [
    '致：本轮无可用开局饰品。',
  ],
  cardpack_pick: [
    '致：选择卡包【{pack}】。',
    '指定卡包：{pack}。',
    '致：本层选择{pack}卡包。',
  ],
  cardpack_position: [
    '致：选择第{position}个卡包。',
    '指定第{position}个卡包。',
  ],
  cardpack_reroll: [
    '致：刷新卡包选择。',
    '刷新当前卡包选项。',
  ],
  route: [
    '致：走向{dir}路。',
    '路线指定：{dir}路。',
  ],
  combat_no_formation: [
    '致：尚未编队，请先在编队窗口中指定出击顺序。',
  ],
  combat_defend_all: [
    '致：全体守备一回合。',
    '本回合全员进入守备状态。',
  ],
  combat_no_ego: [
    '致：本回合禁止使用EGO。',
  ],
  combat_win_rate: [
    '致：按下P，按照胜率最高的模式自动战斗。',
    '致：按一次P，遵循胜率指引。',
  ],
  combat_damage: [
    '致：按下PP，按照伤害最高的模式自动战斗。',
    '致：按两次P，遵循伤害指引。',
  ],
  combat_all_upper: [
    '致：本回合全员使用上方技能。',
    '致：所有人使用上方技能攻击。',
  ],
  combat_all_lower: [
    '致：本回合全员使用下方技能。',
    '致：所有人使用下方技能攻击。',
  ],
  combat_upper_skill: [
    '致：{sinner}使用上方技能。',
    '{sinner}，本回合使用上方技能。',
  ],
  combat_lower_skill: [
    '致：{sinner}使用下方技能。',
    '{sinner}，本回合使用下方技能。',
  ],
  combat_use_ego: [
    '致：{sinner}必须使用{level}级EGO。',
    '致：{sinner}必须使用具有{tags}效果的EGO。',
    '{sinner}，释放{tags}属性的EGO！',
    '{sinner}，本回合使用{level}级EGO出击。',
  ],
  combat_overclock_ego: [
    '致：{sinner}必须超频{level}级EGO。',
    '{sinner}，将{tags}EGO超频释放！',
    '致：{sinner}，超频你的{tags}EGO。',
  ],
  combat_guard: [
    '致：{sinner}必须使用守备技能。',
    '{sinner}，本回合只可守备。',
  ],
  combat_speed_attack: [
    '致：让目前速度第{rank}位的罪人进行攻击。',
    '速度第{rank}的罪人，本回合攻击。',
  ],
  combat_speed_guard: [
    '致：让目前速度第{rank}位的罪人进行守备。',
  ],
  combat_speed_ego: [
    '致：让目前速度第{rank}位的罪人使用EGO。',
  ],
  combat_speed_overclock: [
    '致：让目前速度第{rank}位的罪人超频EGO。',
  ],
  combat_golden_bough: [
    '致：使用金枝——{type}。',
    '触动金枝的力量——{type}。',
  ],
  event_option: [
    '致：选择{option}。',
    '事件选择：{option}。',
  ],
  event_vague: [
    '致：选你觉得最赚的选项。',
    '致：选择对你最有利的选项。',
  ],
  event_reward: [
    '致：选择{position}的奖励卡。',
    '领取{position}的奖励卡。',
  ],
  shop_buy: [
    '致：购买一件{tags}饰品。',
  ],
  shop_sell: [
    '致：出售一件{tier}级饰品。',
  ],
  shop_sell_ash: [
    '致：出售骨灰瓶。',
  ],
  shop_fuse: [
    '致：合成{tier}级{tags}饰品。',
  ],
  shop_no_heal: [
    '致：禁止恢复全体体力。',
  ],
  shop_reroll: [
    '致：刷新商店。',
  ],
  shop_upgrade: [
    '致：强化一件已获取的饰品。',
  ],
  shop_keyword_reroll: [
    '致：按【{keyword}】关键词刷新商店。',
  ],
  shop_replace_skill: [
    '致：替换{sinner}的技能。',
  ],
  shop_change_identity: [
    '致：更换{sinner}的人格与EGO。',
  ],
  shop_change_identity_multi: [
    '致：更换{sinner1}、{sinner2}的人格与EGO。',
  ],
  shop_change_identity_triple: [
    '致：更换{sinner1}、{sinner2}、{sinner3}的人格与EGO。',
  ],
  shop_special_probability: [
    '致：将特殊概率提升至100%。',
  ],
  shop_heal: [
    '致：治疗全体罪人。',
  ],
  hidden_boss_fight: [
    '致：挑战隐藏BOSS。',
  ],
  hidden_boss_leave: [
    '致：离开此处，不要挑战隐藏BOSS。',
  ],
  judgment: [
    '致：由{sinner}进行判定。',
    '指定：由{sinner}负责判定此事件。',
  ],
  boss_reward: [
    '致：从关底奖励中选择第{option}个。',
  ],

  free_instruction: [
    '致：将左手放在胸前，朗诵『指令神了』三遍。',
    '致：做三个俄式挺身俯卧撑。',
    '致：向后看。',
    '致：下一场战斗时将编队中第{pos1}位罪人和第{pos2}位罪人互换位置。',
    '致：看向你的左腿。',
    '致：闭上眼睛。',
    '致：用手指在桌面上敲出当前楼层的数字。',
    '致：心中默数三个质数。',
    '致：将头转向左边再转向右边。',
    '致：下一场战斗前禁止抖腿。',
    '致：学一声猫叫。',
    '致：以当前楼层数做相应次数的深呼吸。',
    '致：接下来的三十秒内不得说话。',
    '致：将双手摊开，掌心向上。',
    '致：感化你的敌人。',
    '致：单手放在额头上直到下一条指令出现。',
    '致：用手边的任何东西敲两下桌面。',
    '致：站起来再坐下去。',
    '致：遮住世界。',
    '致：将目光投向窗外五秒。',
    '致：你的呼吸频率放缓。',
    '致：用鼻子吸气，用嘴呼气。',
    '致：触碰你右边的任何东西。',
    '致：活下去。',
    '致：保持静止直到第五个深呼吸结束。',
    '致：尊崇本心。',
    '致：你很棒。',
  ],
};

let _instructionCounter = 0;

class InstructionEngine {
  constructor(dataLoader, store) {
    this.dataLoader = dataLoader;
    this.store = store;
    this._debugTrace = [];
  }

  _trace(step, detail = '') {
    this._debugTrace.push({ step, detail, time: Date.now() });
  }

  _startTrace(phase) {
    this._debugTrace = [];
    this._trace('══════════════', `开始生成 [${phase}]`);
  }

  _finishTrace() {
    const trace = [...this._debugTrace];
    this._debugTrace = [];
    return trace;
  }

  // ═══════════════════════════════════════════
  //  Main entry
  // ═══════════════════════════════════════════

  async generate(phase, context = {}) {
    const infoCompleteness = context.infoCompleteness ?? Math.random();
    const rawRationality = context.rationality ?? Math.random();
    this._startTrace(phase);

    let result;
    switch (phase) {
      case PHASES.DEPLOY_IDENTITY:  result = await this._deployIdentity(context); break;
      case PHASES.DEPLOY_EGO:       result = await this._deployEgo(infoCompleteness, context); break;
      case PHASES.STARLIGHT:        result = await this._genStarlight(); break;
      case PHASES.STARTING_RELIC:   result = await this._genStartingRelic(context); break;
      case PHASES.CARDPACK:         result = await this._genCardpack(context); break;
      case PHASES.ROUTE:            result = await this._genRoute(); break;
      case PHASES.COMBAT:           result = await this._genCombat(rawRationality, context); break;
      case PHASES.EVENT:            result = await this._genEvent(infoCompleteness); break;
      case PHASES.EVENT_REWARD:     result = await this._genEventReward(); break;
      case PHASES.SHOP:             result = await this._genShop(rawRationality, context); break;
      case PHASES.JUDGMENT:         result = await this._genJudgment(context); break;
      case PHASES.HIDDEN_BOSS:      result = await this._genHiddenBoss(); break;
      case PHASES.BOSS_REWARD:      result = await this._genBossReward(context); break;
      default: throw new Error(`Unknown phase: ${phase}`);
    }
    result.debugTrace = this._finishTrace();
    return result;
  }

  // ═══════════════════════════════════════════
  //  Rationality threshold (blessing/karma-adjusted)
  // ═══════════════════════════════════════════

  /**
   * Determine if a raw rationality value counts as "rational" or "irrational"
   * based on global blessing/karma.
   *
   * Default thresholds: >0.4 rational, <0.2 irrational
   * Blessing lowers the threshold (makes it easier to be rational)
   * Karma raises the threshold (makes it harder to be rational)
   * Ratio: 1 blessing ≈ 5 karma in effect
   *
   * isRational: use when deciding to follow "best strategy"
   * isIrrational: use when deciding to act against best strategy
   * (neutral zone: between irrational and rational — neither strongly)
   */
  _isRational(rawRationality, context) {
    const blessing = context.blessing || 0;
    const karma = context.karma || 0;
    // 1 blessing ≈ 5 karma in offset power (blessing earns 1 at a time, karma earns 5)
    const shift = blessing / 400 - karma / 600;
    const threshold = 0.4 - shift;
    return rawRationality > threshold;
  }

  _isIrrational(rawRationality, context) {
    const blessing = context.blessing || 0;
    const karma = context.karma || 0;
    const shift = blessing / 400 - karma / 600;
    const threshold = 0.2 - shift;
    return rawRationality < threshold;
  }

  // ═══════════════════════════════════════════
  //  Core mechanic detection (≥5 sinners → core)
  // ═══════════════════════════════════════════

  /**
   * Determine team core mechanics.
   * - If ≥5 sinners in the pool share an effect via coreMechanic → it's a core effect
   * - If no effect reaches 5, pick the most common effect(s)
   * - Ties at most-common are randomly broken
   */
  _determineCoreMechanics(identities, poolIds) {
    // Only these 7 status effects can be core mechanics
    const VALID_CORE = ['烧伤', '流血', '震颤', '破裂', '沉沦', '呼吸法', '充能'];
    const pool = this._filterByPool(identities, poolIds);

    // Count sinners per effect (by coreMechanic), only allowed effects
    const effectSinners = new Map();
    for (const effect of VALID_CORE) {
      effectSinners.set(effect, new Set());
    }
    for (const id of pool) {
      if (!id.coreMechanic || id.coreMechanic.length === 0) continue;
      for (const effect of id.coreMechanic) {
        if (effectSinners.has(effect)) {
          effectSinners.get(effect).add(id.sinner);
        }
      }
    }

    // Remove effects with 0 sinners
    for (const [effect, sinners] of effectSinners) {
      if (sinners.size === 0) effectSinners.delete(effect);
    }

    if (effectSinners.size === 0) {
      return [this._pickRandom(VALID_CORE)];
    }

    // Check for ≥5 threshold
    const coreEffects = [];
    for (const [effect, sinners] of effectSinners) {
      if (sinners.size >= 5) coreEffects.push(effect);
    }

    if (coreEffects.length > 0) return coreEffects;

    // No effect reaches 5 — pick the most common from the 7
    let maxCount = 0;
    for (const [, sinners] of effectSinners) {
      if (sinners.size > maxCount) maxCount = sinners.size;
    }
    const best = [];
    for (const [effect, sinners] of effectSinners) {
      if (sinners.size === maxCount) best.push(effect);
    }
    return [this._pickRandom(best)];
  }

  // ═══════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════

  _generateId() {
    _instructionCounter++;
    return `inst_${Date.now()}_${_instructionCounter}`;
  }

  _makeInstruction(phase, text, isGuidance, meta = {}) {
    return {
      id: this._generateId(), phase, text, isGuidance,
      timestamp: Date.now(), status: 'pending', meta,
    };
  }

  _pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  _fillTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }

  _filterByPool(items, poolIds) {
    if (!poolIds || poolIds.length === 0) return items;
    const set = new Set(poolIds);
    const filtered = items.filter(i => set.has(i.id));
    if (filtered.length === 0) {
      this._trace('⚠ 池过滤为空', `poolIds=${poolIds.length}个, items=${items.length}条 → 回退全部`);
      return items;
    }
    return filtered;
  }

  _getFieldSinners(context) {
    const formation = context.formation || [];
    // Only return assigned sinners (capped at 7). No fallback — must have formation.
    return formation.slice(0, 7);
  }

  _computeStarlightEffects(selectedStarlights) {
    let interstellarTravelLevel = 0;
    let meteorRainSelected = false;
    let doubleStarShopSelected = false;
    let fullPossibilitySelected = false;
    for (const s of selectedStarlights) {
      const id = s.starlightId || s.id || '';
      const level = s.level ?? 1;
      if (id === STARLIGHT_IDS.INTERSTELLAR_TRAVEL) interstellarTravelLevel = level;
      else if (id === STARLIGHT_IDS.METEOR_RAIN) meteorRainSelected = true;
      else if (id === STARLIGHT_IDS.DOUBLE_STAR_SHOP) doubleStarShopSelected = true;
      else if (id === STARLIGHT_IDS.FULL_POSSIBILITY) fullPossibilitySelected = true;
    }
    return { interstellarTravelLevel, meteorRainSelected, doubleStarShopSelected, fullPossibilitySelected };
  }

  /** Compute the number of cardpack rerolls available based on starlight effects */
  _getCardpackRerollCount(effects) {
    const interstellarLevel = (effects && effects.interstellarTravelLevel) || 0;
    return 1 + interstellarLevel * 2; // lv0→1, lv1→3, lv2→5 (capped in game at 4)
  }

  /** Compute the number of cardpacks shown */
  _getCardpackCount(effects) {
    const interstellarLevel = (effects && effects.interstellarTravelLevel) || 0;
    const fullPoss = (effects && effects.fullPossibilitySelected) || false;
    return 3 + (interstellarLevel > 0 ? 1 : 0) + (fullPoss ? 1 : 0);
  }

  // ═══════════════════════════════════════════
  //  Phase 1: Deploy Identity (Guidance)
  // ═══════════════════════════════════════════

  async _deployIdentity(context) {
    const identities = await this.dataLoader.load('identities');
    const templates = await this._getTemplates();
    const tplExact = templates.deploy_identity || DEFAULT_TEMPLATES.deploy_identity;
    const tplVague = templates.deploy_identity_vague || DEFAULT_TEMPLATES.deploy_identity_vague;
    const poolIds = context.poolIdentityIds || null;

    let pool = identities;
    if (poolIds && poolIds.length > 0) {
      const poolSet = new Set(poolIds);
      pool = identities.filter(i => poolSet.has(i.id));
    }

    const uniqueSinners = [...new Set(pool.map(i => i.sinner))];
    this._trace('池中罪人', `${uniqueSinners.length}人: ${uniqueSinners.join(',')}`);

    const coreMechanics = this._determineCoreMechanics(identities, poolIds);
    this._trace('核心效果判定', coreMechanics.length > 0 ? coreMechanics.join(', ') : '无(随缘选取)');

    const instructions = [];
    for (const sinner of uniqueSinners) {
      const sinnerIdentities = pool.filter(i => i.sinner === sinner);
      const thisInfoCompleteness = Math.random();

      let picked;
      if (coreMechanics.length > 0 && Math.random() < 0.7) {
        const matching = sinnerIdentities.filter(i =>
          i.coreMechanic && i.coreMechanic.some(m => coreMechanics.includes(m))
        );
        if (matching.length > 0) {
          picked = this._pickRandom(matching);
          this._trace(`${sinner}选取`, `匹配核心效果 → ${picked.name} (${(picked.coreMechanic||[]).join(',')})`);
        } else {
          picked = this._pickRandom(sinnerIdentities);
          this._trace(`${sinner}选取`, `无匹配核心 → 随机 → ${picked.name}`);
        }
      } else {
        picked = this._pickRandom(sinnerIdentities);
        this._trace(`${sinner}选取`, `非核心倾向 → 随机 → ${picked.name}`);
      }

      let text;
      if (thisInfoCompleteness > 0.7) {
        const template = this._pickRandom(tplExact);
        text = this._fillTemplate(template, { sinner, identity: picked.name });
        this._trace(`${sinner}模板`, `精确(IC=${thisInfoCompleteness.toFixed(2)}) → "${text}"`);
      } else {
        const allTags = [
          ...(picked.tags?.faction || []),
          ...(picked.tags?.effect || []),
          ...(picked.tags?.special || []),
        ];
        const shuffled = [...allTags].sort(() => Math.random() - 0.5);
        const tagCount = Math.min(Math.floor(Math.random() * 3) + 1, shuffled.length);
        const selectedTags = shuffled.slice(0, tagCount);
        const template = this._pickRandom(tplVague);
        text = this._fillTemplate(template, { sinner, tags: selectedTags.join('、') });
        this._trace(`${sinner}模板`, `模糊(IC=${thisInfoCompleteness.toFixed(2)}) tags=${selectedTags.join('、')} → "${text}"`);
      }

      instructions.push(this._makeInstruction(PHASES.DEPLOY_IDENTITY, text, true, {
        sinner, identityId: picked.id, infoCompleteness: thisInfoCompleteness,
      }));
    }

    // Core mechanics: calculate from ACTUAL selected 12 identities, not the pool
    const selectedIds = instructions.map(i => i.meta.identityId).filter(Boolean);
    const selectedIdentities = identities.filter(i => selectedIds.includes(i.id));
    const teamCoreMechanics = this._determineCoreMechanics(selectedIdentities, null);

    return {
      instructions, phase: PHASES.DEPLOY_IDENTITY, isGuidance: true,
      coreMechanics: teamCoreMechanics,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 2: Deploy EGO (Guidance)
  // ═══════════════════════════════════════════

  async _deployEgo(_infoCompleteness, context) {
    const egos = await this.dataLoader.load('egos');
    const templates = await this._getTemplates();
    const poolIds = context.poolEgoIds || null;

    let pool = egos;
    if (poolIds && poolIds.length > 0) {
      const poolSet = new Set(poolIds);
      pool = egos.filter(e => poolSet.has(e.id));
    }

    const uniqueSinners = [...new Set(pool.map(e => e.sinner))];
    const instructions = [];

    for (const sinner of uniqueSinners) {
      const sinnerEgos = pool.filter(e => e.sinner === sinner);
      if (sinnerEgos.length === 0) continue;

      // Group EGOs by level — a sinner can equip at most one per level
      const byLevel = {};
      for (const ego of sinnerEgos) {
        const lvl = ego.level || 'ZAYIN';
        if (!byLevel[lvl]) byLevel[lvl] = [];
        byLevel[lvl].push(ego);
      }
      const availableLevels = Object.keys(byLevel);

      // Pick 1~3 levels, capped by how many levels actually have EGOs
      const pickCount = Math.min(
        Math.floor(Math.random() * 3) + 1,
        availableLevels.length
      );
      this._trace(`${sinner} EGO数`, `${pickCount}条 (${availableLevels.length}个等级: ${availableLevels.join(',')})`);

      // Randomly select which levels to pick from, then pick one random EGO per level
      const shuffledLevels = [...availableLevels].sort(() => Math.random() - 0.5);
      const selectedLevels = shuffledLevels.slice(0, pickCount);

      for (const lvl of selectedLevels) {
        const ego = this._pickRandom(byLevel[lvl]);
        const tplKey = 'deploy_ego';
        const tpl = this._pickRandom(templates[tplKey] || DEFAULT_TEMPLATES[tplKey]);
        const text = this._fillTemplate(tpl, { sinner, ego: ego.name });

        instructions.push(this._makeInstruction(PHASES.DEPLOY_EGO, text, true, {
          sinner, egoId: ego.id,
        }));
      }
    }

    // Throw in occasional force-base (rare).
    // Must NOT conflict with EGO selection instructions for the same sinner.
    // Only pick from sinners who have no EGO instructions in this batch.
    const sinnersWithEgoInstructions = new Set(instructions.map(i => i.meta?.sinner).filter(Boolean));
    const forceBaseCandidates = uniqueSinners.filter(s => !sinnersWithEgoInstructions.has(s));
    if (forceBaseCandidates.length > 0 && Math.random() < 0.15) {
      const sinner = this._pickRandom(forceBaseCandidates);
      const tplKey = 'deploy_ego_force_base';
      const tpl = this._pickRandom(templates[tplKey] || DEFAULT_TEMPLATES[tplKey]);
      const text = this._fillTemplate(tpl, { sinner });
      instructions.push(this._makeInstruction(PHASES.DEPLOY_EGO, text, true, { sinner, egoId: 'base', infoCompleteness: undefined }));
    }

    return { instructions, phase: PHASES.DEPLOY_EGO, isGuidance: true };
  }

  // ═══════════════════════════════════════════
  //  Phase 3: Starlight
  // ═══════════════════════════════════════════

  async _genStarlight() {
    const starlights = await this.dataLoader.load('starlight');
    const templates = await this._getTemplates();

    if (starlights.length === 0) {
      const tpl = this._pickRandom(DEFAULT_TEMPLATES.starlight_none);
      return {
        instructions: [this._makeInstruction(PHASES.STARLIGHT, tpl, false)],
        phase: PHASES.STARLIGHT, isGuidance: false,
        starlightEffects: this._computeStarlightEffects([]),
      };
    }

    const count = Math.floor(Math.random() * (starlights.length + 1)); // 0~10

    if (count === 0) {
      const tpl = this._pickRandom(templates.starlight_none || DEFAULT_TEMPLATES.starlight_none);
      return {
        instructions: [this._makeInstruction(PHASES.STARLIGHT, tpl, false)],
        phase: PHASES.STARLIGHT, isGuidance: false,
        starlightEffects: this._computeStarlightEffects([]),
      };
    }

    const shuffled = [...starlights].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);
    const instructions = selected.map(star => {
      // Level: 0 (not upgraded), 1 (basic), or 2 (enhanced)
      const level = Math.floor(Math.random() * 3); // 0, 1, 2
      const tpl = this._pickRandom(templates.starlight || DEFAULT_TEMPLATES.starlight);
      const text = this._fillTemplate(tpl, { name: star.name, level: String(level) });
      return this._makeInstruction(PHASES.STARLIGHT, text, false, { starlightId: star.id, level });
    });

    return {
      instructions, phase: PHASES.STARLIGHT, isGuidance: false,
      starlightEffects: this._computeStarlightEffects(
        selected.map(s => ({
          starlightId: s.id,
          level: instructions.find(i => i.meta.starlightId === s.id)?.meta?.level || 0,
        }))
      ),
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 4: Starting Relic (simplified — core mechanic only)
  // ═══════════════════════════════════════════

  async _genStartingRelic(context) {
    const templates = await this._getTemplates();

    // Use team core mechanics from deploy_identity (already stored in context)
    const coreMechanics = context.coreMechanics || [];
    if (coreMechanics.length === 0) {
      const tpl = this._pickRandom(templates.starting_relic_none || DEFAULT_TEMPLATES.starting_relic_none);
      return {
        instructions: [this._makeInstruction(PHASES.STARTING_RELIC, tpl, false)],
        phase: PHASES.STARTING_RELIC, isGuidance: false,
      };
    }

    // Pick one core mechanic at random
    const pickedEffect = this._pickRandom(coreMechanics);

    const tpl = this._pickRandom(templates.starting_relic || DEFAULT_TEMPLATES.starting_relic);
    const text = this._fillTemplate(tpl, { effect: pickedEffect });

    return {
      instructions: [this._makeInstruction(PHASES.STARTING_RELIC, text, false, { effect: pickedEffect })],
      phase: PHASES.STARTING_RELIC, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 5: Cardpack (floor-based + starlight-aware)
  // ═══════════════════════════════════════════

  async _genCardpack(context) {
    const cardpacks = await this.dataLoader.load('cardpacks');
    const templates = await this._getTemplates();
    const effects = context.starlightEffects || {};
    const packCount = this._getCardpackCount(effects);
    const rerollCount = this._getCardpackRerollCount(effects);

    // Track used rerolls to avoid exceeding limit
    const usedRerolls = context.usedCardpackRerolls || 0;
    const remainingRerolls = Math.max(0, rerollCount - usedRerolls);

    const currentFloor = context.currentFloor || 1;

    // Determine mode from floor range
    let mode;
    if (currentFloor <= 5) mode = context.isHardMode ? 'hard' : 'normal';
    else if (currentFloor <= 10) mode = 'parallel';
    else mode = 'extreme';

    this._trace('当前层数', `第${currentFloor}层 (${mode})`);

    // 40% chance: use real cardpack name filtered by floor
    const useRealPack = Math.random() < 0.4;
    if (useRealPack && cardpacks && cardpacks.length > 0) {
      const floorPacks = cardpacks.filter(p => {
        if (!p.availability) return false;
        const avail = p.availability[mode];
        // normal/hard: array of floor numbers (e.g. [1,2,3])
        // parallel/extreme: true/false boolean
        if (mode === 'parallel' || mode === 'extreme') {
          return avail === true;
        }
        return Array.isArray(avail) && avail.includes(currentFloor);
      });
      if (floorPacks.length > 0) {
        this._trace('卡包匹配', `${floorPacks.length}个可用: ${floorPacks.slice(0,5).map(p=>p.name).join(', ')}${floorPacks.length>5?'...':''}`);
        const picked = this._pickRandom(floorPacks);
        const tpl = this._pickRandom(templates.cardpack_pick || DEFAULT_TEMPLATES.cardpack_pick);
        const text = this._fillTemplate(tpl, { pack: picked.name });
        return {
          instructions: [this._makeInstruction(PHASES.CARDPACK, text, false, { cardpackId: picked.id })],
          phase: PHASES.CARDPACK, isGuidance: false,
        };
      }
      this._trace('卡包匹配', `${mode}模式下无可用卡包，使用序号描述`);
    }

    // Reroll: only if rerolls remain, and probability decreases as rerolls are used
    const rerollChance = remainingRerolls > 0 ? Math.min(0.35, remainingRerolls * 0.12) : 0;
    if (Math.random() < rerollChance) {
      const tpl = this._pickRandom(templates.cardpack_reroll || DEFAULT_TEMPLATES.cardpack_reroll);
      return {
        instructions: [this._makeInstruction(PHASES.CARDPACK, tpl, false, {
          isReroll: true, remainingRerolls: remainingRerolls - 1,
        })],
        phase: PHASES.CARDPACK, isGuidance: false,
      };
    }

    // Position-based pick
    const position = Math.floor(Math.random() * packCount) + 1;
    const tpl = this._pickRandom(templates.cardpack_position || DEFAULT_TEMPLATES.cardpack_position);
    const text = this._fillTemplate(tpl, { position: String(position) });
    return {
      instructions: [this._makeInstruction(PHASES.CARDPACK, text, false, { cardpackNum: position })],
      phase: PHASES.CARDPACK, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 6: Route
  // ═══════════════════════════════════════════

  async _genRoute() {
    const templates = await this._getTemplates();
    const dir = this._pickRandom(ROUTE_OPTIONS);
    const tpl = this._pickRandom(templates.route || DEFAULT_TEMPLATES.route);
    const text = this._fillTemplate(tpl, { dir });
    return {
      instructions: [this._makeInstruction(PHASES.ROUTE, text, false, { direction: dir })],
      phase: PHASES.ROUTE, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 7: Combat (3 categories)
  // ═══════════════════════════════════════════

  async _genCombat(rawRationality, context) {
    const templates = await this._getTemplates();
    const egos = await this.dataLoader.load('egos');
    const fieldSinners = this._getFieldSinners(context);
    const poolEgoIds = context.poolEgoIds || null;

    // No formation — prompt to set it first
    if (fieldSinners.length === 0) {
      const tpl = this._pickRandom(templates.combat_no_formation || DEFAULT_TEMPLATES.combat_no_formation);
      return {
        instructions: [this._makeInstruction(PHASES.COMBAT, tpl, false, {
          category: 'combat_no_formation',
        })],
        phase: PHASES.COMBAT, isGuidance: false,
      };
    }

    const isRational = this._isRational(rawRationality, context);

    // ── Special: Golden Bough (~2%) ──
    if (Math.random() < 0.02) {
      const gbType = this._pickRandom(GOLDEN_BOUGH_TYPES);
      const tpl = this._pickRandom(templates.combat_golden_bough || DEFAULT_TEMPLATES.combat_golden_bough);
      const text = this._fillTemplate(tpl, { type: gbType });
      return {
        instructions: [this._makeInstruction(PHASES.COMBAT, text, false, {
          category: 'combat_golden_bough', goldenBoughType: gbType,
        })],
        phase: PHASES.COMBAT, isGuidance: false,
      };
    }

    const instructions = [];

    // ── 20%: Speed-based instruction ──
    if (Math.random() < 0.20) {
      const speedKeys = ['combat_speed_attack', 'combat_speed_guard', 'combat_speed_ego', 'combat_speed_overclock'];
      const key = this._pickRandom(speedKeys);
      const maxRank = Math.min(fieldSinners.length, 7);
      const rank = Math.floor(Math.random() * maxRank) + 1;
      const tpl = this._pickRandom(templates[key] || DEFAULT_TEMPLATES[key]);
      const text = this._fillTemplate(tpl, { rank: String(rank) });
      instructions.push(this._makeInstruction(PHASES.COMBAT, text, false, { category: key, speedRank: rank }));
    }
    // ── 30%: Global instruction ──
    else if (Math.random() < 0.30) {
      const globalOptions = [
        'combat_defend_all',
        'combat_win_rate', 'combat_win_rate',
        'combat_damage', 'combat_damage',
        'combat_all_upper',
        'combat_all_lower',
        'combat_no_ego',
      ];
      const key = this._pickRandom(globalOptions);
      const tpl = this._pickRandom(templates[key] || DEFAULT_TEMPLATES[key]);
      const text = this._fillTemplate(tpl, {});
      instructions.push(this._makeInstruction(PHASES.COMBAT, text, false, { category: key }));

    } else {
      // ── Individual instructions (1~fieldSinners.length, max 7) ──
      const count = Math.max(1, Math.floor(Math.random() * Math.min(fieldSinners.length, 7)) + 1);
      const shuffled = [...fieldSinners].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(count, shuffled.length));

      for (const sinner of selected) {
        // Build per-sinner EGO pool (strict: only from selected EGO pool)
        let sinnerEgosInPool = egos.filter(e => e.sinner === sinner);
        if (poolEgoIds && poolEgoIds.length > 0) {
          const poolSet = new Set(poolEgoIds);
          sinnerEgosInPool = sinnerEgosInPool.filter(e => poolSet.has(e.id));
        }
        const hasNonBaseEgo = sinnerEgosInPool.some(e => !e.isBaseEgo);
        const hasAnyEgoInPool = sinnerEgosInPool.length > 0;

        // Rational → more attack (upper/lower), less ego/guard
        // If sinner has no non-base EGO in pool, reduce ego-related options
        // (base EGO can't be overclocked, and "use base EGO" is a trivial instruction)
        let individualOptions;
        if (isRational) {
          individualOptions = ['combat_upper_skill','combat_upper_skill','combat_upper_skill',
             'combat_lower_skill','combat_lower_skill','combat_lower_skill',
             'combat_use_ego','combat_guard'];
        } else {
          individualOptions = ['combat_upper_skill','combat_upper_skill',
             'combat_lower_skill','combat_lower_skill',
             'combat_use_ego','combat_use_ego','combat_use_ego',
             'combat_guard','combat_guard','combat_guard'];
        }
        // If sinner only has base EGOs in pool, remove overclock-prone weight
        // (keep at most 1 "combat_use_ego" entry since base EGO is always available)
        if (!hasNonBaseEgo && hasAnyEgoInPool) {
          // All EGOs in pool are base — reduce weight to 1 entry
          individualOptions = individualOptions.filter(k => k !== 'combat_use_ego');
          individualOptions.push('combat_use_ego');
        }

        const key = this._pickRandom(individualOptions);

        let tplVars = { sinner };

        if (key === 'combat_use_ego') {
          if (sinnerEgosInPool.length > 0) {
            const ego = this._pickRandom(sinnerEgosInPool);
            const level = ego.level || 'ZAYIN';
            // Build tag pool for vague description to avoid mismatch
            // with deploy phase (player may have picked a different EGO)
            const allTags = [
              ...(ego.tags?.damageType || []),
              ...(ego.tags?.effect || []),
              ...(ego.tags?.sinAffinity || []),
            ];
            const tag = allTags.length > 0
              ? this._pickRandom(allTags)
              : '通用';
            Object.assign(tplVars, { level, tags: tag });

            // Overclock: less likely when rational; only for non-base EGO
            // (base EGO cannot be overclocked in the game)
            const overclockChance = isRational ? 0.1 : 0.35;
            if (Math.random() < overclockChance && !ego.isBaseEgo) {
              const ocTpl = this._pickRandom(templates.combat_overclock_ego || DEFAULT_TEMPLATES.combat_overclock_ego);
              const text = this._fillTemplate(ocTpl, tplVars);
              instructions.push(this._makeInstruction(PHASES.COMBAT, text, false, {
                sinner, category: 'combat_overclock_ego', egoId: ego.id,
              }));
              continue;
            }
            // If the picked EGO is base EGO, still generate a normal "use EGO" instruction
          } else {
            // No EGO in pool for this sinner — skip ego instruction entirely
            // Fall back to upper/lower skill instead
            const fallbackKey = this._pickRandom(['combat_upper_skill', 'combat_lower_skill', 'combat_guard']);
            const tpl = this._pickRandom(templates[fallbackKey] || DEFAULT_TEMPLATES[fallbackKey]);
            const text = this._fillTemplate(tpl, { sinner });
            instructions.push(this._makeInstruction(PHASES.COMBAT, text, false, { sinner, category: fallbackKey, rationality: rawRationality, isRational }));
            continue;
          }
        }

        const tpl = this._pickRandom(templates[key] || DEFAULT_TEMPLATES[key]);
        const text = this._fillTemplate(tpl, tplVars);
        instructions.push(this._makeInstruction(PHASES.COMBAT, text, false, { sinner, category: key, rationality: rawRationality, isRational }));
      }
    }

    return { instructions, phase: PHASES.COMBAT, isGuidance: false };
  }

  // ═══════════════════════════════════════════
  //  Phase 8: Event
  // ═══════════════════════════════════════════

  async _genEvent(infoCompleteness) {
    const templates = await this._getTemplates();

    if (infoCompleteness < 0.25) {
      const tpl = this._pickRandom(templates.event_vague || DEFAULT_TEMPLATES.event_vague);
      return {
        instructions: [this._makeInstruction(PHASES.EVENT, tpl, false)],
        phase: PHASES.EVENT, isGuidance: false,
      };
    }

    const optionCount = Math.floor(Math.random() * 3) + 2; // 2~4
    const optionNum = Math.floor(Math.random() * optionCount) + 1;

    // Describe option position without repetition
    let optionLabel;
    if (optionCount === 2) {
      optionLabel = optionNum === 1 ? '第一个' : '第二个';
    } else {
      const style = Math.random();
      if (style < 0.4 && optionNum <= 2) {
        optionLabel = optionNum === 1 ? '第一个' : '第二个';
      } else if (style < 0.7 && (optionCount - optionNum + 1) <= 2) {
        const rev = optionCount - optionNum + 1;
        optionLabel = rev === 1 ? '倒数第一个' : '倒数第二个';
      } else {
        optionLabel = optionNum === 1 ? '最上面的'
          : optionNum === optionCount ? '最下面的'
          : optionNum <= Math.ceil(optionCount / 2)
            ? `从上往下第${optionNum}个`
            : `从下往上第${optionCount - optionNum + 1}个`;
      }
    }

    const tpl = this._pickRandom(templates.event_option || DEFAULT_TEMPLATES.event_option);
    const text = this._fillTemplate(tpl, { option: optionLabel });

    return {
      instructions: [this._makeInstruction(PHASES.EVENT, text, false, {
        optionNum, optionCount, optionLabel,
      })],
      phase: PHASES.EVENT, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 9: Event Reward (position only)
  // ═══════════════════════════════════════════

  async _genEventReward() {
    const templates = await this._getTemplates();
    const cardCount = Math.floor(Math.random() * 3) + 2; // 2~4
    const pickIndex = Math.floor(Math.random() * cardCount);

    const position = pickIndex === 0 ? '最左边'
      : pickIndex === cardCount - 1 ? '最右边'
      : pickIndex === 1 ? `从左往右第2个`
      : `从右往左第2个`;

    const tpl = this._pickRandom(templates.event_reward || DEFAULT_TEMPLATES.event_reward);
    const text = this._fillTemplate(tpl, { position });

    return {
      instructions: [this._makeInstruction(PHASES.EVENT_REWARD, text, false, { cardCount, position })],
      phase: PHASES.EVENT_REWARD, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 10: Shop (rationality-aware, no conflicts)
  // ═══════════════════════════════════════════

  async _genShop(rawRationality, context) {
    const templates = await this._getTemplates();
    const identities = await this.dataLoader.load('identities');
    const isRational = this._isRational(rawRationality, context);
    const isIrrational = this._isIrrational(rawRationality, context);

    const count = Math.floor(Math.random() * 5) + 1; // 1~5

    // Collect available shop templates
    const shopOps = [
      'shop_buy', 'shop_sell', 'shop_fuse', 'shop_upgrade',
      'shop_reroll', 'shop_keyword_reroll', 'shop_special_probability',
      'shop_no_heal', 'shop_heal',
      'shop_replace_skill', 'shop_change_identity',
    ];

    const tags = SHOP_EFFECT_TAGS;
    const coreMechanics = context.coreMechanics || [];

    let hasHealOrNoHeal = false;
    let hasChangeIdentity = false;
    const instructions = [];

    const available = [...shopOps];

    for (let i = 0; i < count && available.length > 0; i++) {
      // Filter out conflicting ops
      const candidates = available.filter(key => {
        if (hasHealOrNoHeal && (key === 'shop_heal' || key === 'shop_no_heal')) return false;
        if (hasChangeIdentity && key === 'shop_change_identity') return false;
        return true;
      });
      if (candidates.length === 0) break;

      const key = this._pickRandom(candidates);
      if (key === 'shop_heal' || key === 'shop_no_heal') hasHealOrNoHeal = true;
      if (key === 'shop_change_identity') hasChangeIdentity = true;

      const idx = available.indexOf(key);
      if (idx >= 0) available.splice(idx, 1);

      const tpl = this._pickRandom(templates[key] || DEFAULT_TEMPLATES[key]);
      const tier = this._pickRandom(['I', 'II', 'III', 'IV', 'V']);

      let tag;
      if (isRational && coreMechanics.length > 0) {
        // Rational: prefer core-mechanic-related tags
        tag = Math.random() < 0.7
          ? this._pickRandom(coreMechanics)
          : this._pickRandom(tags);
      } else if (isIrrational) {
        // Irrational: avoid core mechanic tags
        const nonCore = tags.filter(t => !coreMechanics.includes(t));
        tag = nonCore.length > 0 ? this._pickRandom(nonCore) : this._pickRandom(tags);
      } else {
        tag = this._pickRandom(tags);
      }

      let text, meta = { shopAction: key };

      switch (key) {
        case 'shop_buy':
          text = this._fillTemplate(tpl, { tags: tag, tier });
          meta.tag = tag; meta.tier = tier;
          break;
        case 'shop_sell':
          // Rational: prefer selling 骨灰瓶 (ash bottle) or low-tier items
          if (isRational && Math.random() < 0.4) {
            const ashTpl = this._pickRandom(templates.shop_sell_ash || DEFAULT_TEMPLATES.shop_sell_ash);
            text = ashTpl;
            meta.sellTarget = '骨灰瓶';
          } else if (isIrrational) {
            // Irrational: sell high-tier or core items
            const badTier = this._pickRandom(['III', 'IV', 'V']);
            text = this._fillTemplate(tpl, { tier: badTier });
            meta.tier = badTier;
          } else {
            text = this._fillTemplate(tpl, { tier });
            meta.tier = tier;
          }
          break;
        case 'shop_fuse':
          // Fuse only I~IV tiers
          const fuseTier = isIrrational ? this._pickRandom(['III', 'IV']) : this._pickRandom(['I', 'II', 'III', 'IV']);
          text = this._fillTemplate(tpl, { tags: tag, tier: fuseTier });
          meta.tag = tag; meta.tier = fuseTier;
          break;
        case 'shop_change_identity': {
          // Rational: replace non-core sinners → core, or upgrade rarity within core
          // Irrational: replace core sinners → non-core, or downgrade rarity
          const teamSinners = context.currentTeam ? [...context.currentTeam.keys()] : SINNERS;

          // Classify each sinner: has core mechanic identity?
          const coreSinners = [];
          const nonCoreSinners = [];
          for (const sinner of teamSinners) {
            const sinnerIdentities = identities.filter(i => i.sinner === sinner);
            const hasCore = sinnerIdentities.some(i =>
              i.coreMechanic && i.coreMechanic.some(m => coreMechanics.includes(m))
            );
            if (hasCore) coreSinners.push(sinner);
            else nonCoreSinners.push(sinner);
          }

          // Pick targets based on rationality
          let targets;
          if (isRational && nonCoreSinners.length > 0) {
            // Replace non-core sinners (up to 3)
            targets = [...nonCoreSinners].sort(() => Math.random() - 0.5).slice(0, Math.min(3, nonCoreSinners.length));
            this._trace('商店换人', `合理→替换无核心效果的罪人: ${targets.join(',')}`);
          } else if (isIrrational && coreSinners.length > 0) {
            // Replace core sinners (up to 3)
            targets = [...coreSinners].sort(() => Math.random() - 0.5).slice(0, Math.min(3, coreSinners.length));
            this._trace('商店换人', `不合理→替换核心效果罪人: ${targets.join(',')}`);
          } else {
            // Neutral: random
            targets = [...SINNERS].sort(() => Math.random() - 0.5).slice(0, Math.floor(Math.random() * 3) + 1);
            this._trace('商店换人', `中庸→随机: ${targets.join(',')}`);
          }

          meta.targets = targets;
          if (targets.length === 3) {
            const tpl3 = this._pickRandom(templates.shop_change_identity_triple || DEFAULT_TEMPLATES.shop_change_identity_triple);
            text = this._fillTemplate(tpl3, { sinner1: targets[0], sinner2: targets[1], sinner3: targets[2] });
          } else if (targets.length === 2) {
            const tpl2 = this._pickRandom(templates.shop_change_identity_multi || DEFAULT_TEMPLATES.shop_change_identity_multi);
            text = this._fillTemplate(tpl2, { sinner1: targets[0], sinner2: targets[1] });
          } else {
            text = this._fillTemplate(tpl, { sinner: targets[0] });
          }
          break;
        }
        case 'shop_keyword_reroll':
          text = this._fillTemplate(tpl, { keyword: tag });
          meta.keyword = tag;
          break;
        case 'shop_replace_skill':
          text = this._fillTemplate(tpl, { sinner: this._pickRandom(SINNERS) });
          break;
        default:
          text = this._fillTemplate(tpl, { tags: tag, tier });
          break;
      }

      instructions.push(this._makeInstruction(PHASES.SHOP, text, false, meta));
    }

    return { instructions, phase: PHASES.SHOP, isGuidance: false };
  }

  // ═══════════════════════════════════════════
  //  Phase 11: Hidden Boss
  // ═══════════════════════════════════════════

  async _genHiddenBoss() {
    const templates = await this._getTemplates();
    const fight = Math.random() < 0.5;
    const key = fight ? 'hidden_boss_fight' : 'hidden_boss_leave';
    const tpl = this._pickRandom(templates[key] || DEFAULT_TEMPLATES[key]);
    return {
      instructions: [this._makeInstruction(PHASES.HIDDEN_BOSS, tpl, false, { fight })],
      phase: PHASES.HIDDEN_BOSS, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 12: Judgment
  // ═══════════════════════════════════════════

  async _genJudgment(context) {
    const templates = await this._getTemplates();
    const teamSinners = context.currentTeam ? [...context.currentTeam.keys()] : [];
    const sinner = teamSinners.length > 0
      ? this._pickRandom(teamSinners)
      : this._pickRandom(SINNERS);
    const tpl = this._pickRandom(templates.judgment || DEFAULT_TEMPLATES.judgment);
    const text = this._fillTemplate(tpl, { sinner });
    return {
      instructions: [this._makeInstruction(PHASES.JUDGMENT, text, false, { sinner })],
      phase: PHASES.JUDGMENT, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════
  //  Phase 13: Boss Reward
  // ═══════════════════════════════════════════

  async _genBossReward(context) {
    const templates = await this._getTemplates();
    const isHardMode = context.isHardMode || false;

    if (isHardMode) {
      // Hard mode: 4 options, pick 2 — generate TWO separate instructions
      const first = Math.floor(Math.random() * 4) + 1;
      let second;
      do { second = Math.floor(Math.random() * 4) + 1; } while (second === first);

      const tpl1 = this._pickRandom(templates.boss_reward || DEFAULT_TEMPLATES.boss_reward);
      const text1 = this._fillTemplate(tpl1, { option: String(first) });
      const tpl2 = this._pickRandom(templates.boss_reward || DEFAULT_TEMPLATES.boss_reward);
      const text2 = this._fillTemplate(tpl2, { option: String(second) });

      return {
        instructions: [
          this._makeInstruction(PHASES.BOSS_REWARD, text1, false, { isHardMode: true, pick: 1, option: first, totalOptions: 4 }),
          this._makeInstruction(PHASES.BOSS_REWARD, text2, false, { isHardMode: true, pick: 2, option: second, totalOptions: 4 }),
        ],
        phase: PHASES.BOSS_REWARD, isGuidance: false,
      };
    } else {
      const option = Math.floor(Math.random() * 3) + 1;
      const tpl = this._pickRandom(templates.boss_reward || DEFAULT_TEMPLATES.boss_reward);
      const text = this._fillTemplate(tpl, { option: String(option) });
      return {
        instructions: [this._makeInstruction(PHASES.BOSS_REWARD, text, false, {
          isHardMode: false, pick: 1, option, totalOptions: 3,
        })],
        phase: PHASES.BOSS_REWARD, isGuidance: false,
      };
    }
  }

  // ═══════════════════════════════════════════
  //  Template loading
  // ═══════════════════════════════════════════

  // ═══════════════════════════════════════════
  //  Free instruction (random idle trigger)
  // ═══════════════════════════════════════════

  async _genFreeInstruction(context) {
    const templates = await this._getTemplates();
    const pool = templates.free_instruction || DEFAULT_TEMPLATES.free_instruction || ['致：等待。'];
    const tpl = this._pickRandom(pool);
    const p1 = Math.floor(Math.random() * 7) + 1;
    let p2 = Math.floor(Math.random() * 7) + 1;
    while (p2 === p1) p2 = Math.floor(Math.random() * 7) + 1;
    const text = this._fillTemplate(tpl, {
      pos1: String(p1),
      pos2: String(p2),
    });

    this._trace('自由指令', `随机模板 → "${text}"`);
    return {
      instructions: [this._makeInstruction(PHASES.FREE, text, false, { category: 'free' })],
      phase: PHASES.FREE, isGuidance: false,
    };
  }

  // ═══════════════════════════════════════════

  async _getTemplates() {
    try { return await this.dataLoader.load('templates'); }
    catch { return DEFAULT_TEMPLATES; }
  }
}

module.exports = { InstructionEngine, PHASES, GUIDANCE_PHASES, STARLIGHT_IDS };
