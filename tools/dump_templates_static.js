/**
 * 静态导出指令模板（不跑引擎、不采样）
 *
 * 数据来源只有两处：
 *   1. data/templates.json          —— 玩家可改的模板
 *   2. src/engine.js DEFAULT_TEMPLATES —— 引擎内置默认
 *
 * 引擎取模板的顺序是「data 优先，内置兜底」，所以这里也按同样顺序取。
 * 输出：设计文档/指令模板总表.md
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.resolve(ROOT, '..', '设计文档', '指令模板总表.md');

const dataTemplates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'templates.json'), 'utf8'));
const { DEFAULT_TEMPLATES } = require(path.join(ROOT, 'src', 'engine.js'));

function pick(key) {
  if (Array.isArray(dataTemplates[key]) && dataTemplates[key].length) {
    return { list: dataTemplates[key], from: 'data' };
  }
  if (Array.isArray(DEFAULT_TEMPLATES[key]) && DEFAULT_TEMPLATES[key].length) {
    return { list: DEFAULT_TEMPLATES[key], from: 'engine' };
  }
  return null;
}

// 环节分组：顺序即文档顺序。每个 base 会自动去找它的 _vague / _meta 档。
const GROUPS = [
  {
    title: '开局 · 选人格',
    note: '生成函数 `_genDeployIdentity`。每一名罪人出一条，`{sinner}`/`{identity}` 由编队与人格池替换。',
    keys: ['deploy_identity'],
  },
  {
    title: '开局 · 选 EGO',
    note: '生成函数 `_genDeployEgo`。`{sinner}`/`{ego}` 由 EGO 池替换。',
    keys: ['deploy_ego'],
  },
  {
    title: '开局 · 星光',
    note: '生成函数 `_genStarlight`。`{name}` 星光名，`{level}` 强化等级，`{taps}` 点几下。',
    keys: ['starlight', 'starlight_none'],
  },
  {
    title: '开局 · 初始饰品',
    note: '生成函数 `_genStartingRelic`。',
    keys: ['starting_relic', 'starting_relic_none'],
  },
  {
    title: '地牢 · 卡包选择',
    note: '生成函数 `_genCardpack`。`{position}` 序号，`{name}` 卡包名，`{count}` 数量。',
    keys: ['cardpack_pick', 'cardpack_position', 'cardpack_reroll'],
  },
  {
    title: '地牢 · 路线',
    note: '生成函数 `_genRoute`。`{dir}` 上/中/下。',
    keys: ['route'],
  },
  {
    title: '地牢 · 战斗（指令选择）',
    note: '生成函数 `_genCombat`。`{sinner}` 罪人，`{rank}` 速度位次。',
    keys: [
      'combat_golden_bough', 'combat_speed_attack', 'combat_speed_guard', 'combat_speed_ego',
      'combat_speed_overclock', 'combat_overclock_ego', 'combat_win_rate', 'combat_damage',
      'combat_defend_all', 'combat_all_upper', 'combat_all_lower', 'combat_no_ego',
      'combat_upper_skill', 'combat_lower_skill', 'combat_guard', 'combat_use_ego',
    ],
  },
  {
    title: '地牢 · 事件',
    note: '生成函数 `_genEvent`。`{index}` 第几个选项。',
    keys: ['event_option', 'event_vague'],
  },
  {
    title: '地牢 · 判定',
    note: '生成函数 `_genJudgment`。`{sinner}` 罪人。',
    keys: ['judgment'],
  },
  {
    title: '地牢 · 奖励卡',
    note: '生成函数 `_genEventReward`。`{position}` 最左/最右/第几个。',
    keys: ['event_reward'],
  },
  {
    title: '地牢 · 商店',
    note: '生成函数 `_genShop`。`{sinner}`/`{name}` 等视条目而定。',
    keys: [
      'shop_heal', 'shop_no_heal', 'shop_reroll', 'shop_keyword_reroll', 'shop_buy',
      'shop_buy_specific', 'shop_upgrade', 'shop_fuse', 'shop_sell', 'shop_sell_ash',
      'shop_replace_skill', 'shop_change_identity', 'shop_special_probability',
    ],
  },
  {
    title: '地牢 · 关底饰品奖励',
    note: '生成函数 `_genBossReward`。普通难度 1 条、困难 2 条。',
    keys: ['boss_reward'],
  },
  {
    title: '自由指令',
    note: '生成函数 `_genFreeInstruction`。玩家主动按「随便来一条」时出。',
    keys: ['free_instruction'],
  },
  {
    title: '已停用 / 不可达',
    note: '这些键对应的环节或分支在当前引擎里走不到，保留仅为兼容旧数据。',
    keys: ['hidden_boss_fight', 'hidden_boss_leave', 'combat_no_formation', 'deploy_ego_force_base',
      'shop_change_identity_multi', 'shop_change_identity_triple', 'combat_meta'],
  },
];

const TIERS = [
  { suffix: '', label: '明示' },
  { suffix: '_vague', label: '暗示' },
  { suffix: '_meta', label: '谜语' },
];

function placeholders(list) {
  const set = new Set();
  for (const s of list) {
    const m = String(s).match(/\{(\w+)\}/g) || [];
    for (const one of m) set.add(one);
  }
  return [...set];
}

function cell(list) {
  if (!list || !list.length) return '';
  return list.map((s) => String(s).replace(/\|/g, '\\|')).join('<br>');
}

const out = [];
out.push('# 指令模板总表（设定原文）');
out.push('');
out.push('> 本文只列**设定好的模板原文**，不跑引擎、不做采样。');
out.push('> 来源：`data/templates.json`（玩家可改）优先，缺失时用 `src/engine.js` 的 `DEFAULT_TEMPLATES` 兜底。');
out.push('> 每个基础键最多三档：**明示**（基础键）、**暗示**（`_vague`）、**谜语**（`_meta`）；');
out.push('> 出指令时按 40% / 40% / 20% 抽取，**缺档则静默回退到明示**。');
out.push('');

// 概览
let totalKeys = 0;
let missingVague = 0;
let missingMeta = 0;
const bases = [];
for (const g of GROUPS) {
  for (const k of g.keys) {
    if (k.endsWith('_vague') || k.endsWith('_meta')) continue;
    bases.push({ group: g.title, key: k });
    totalKeys += 1;
    if (!pick(k + '_vague')) missingVague += 1;
    if (!pick(k + '_meta')) missingMeta += 1;
  }
}
out.push('## 概览');
out.push('');
out.push(`- 基础模板键：**${totalKeys}** 个`);
out.push(`- 缺「暗示」档（\`_vague\`）：**${missingVague}** 个 → 这 ${missingVague} 个键永远只出明示`);
out.push(`- 缺「谜语」档（\`_meta\`）：**${missingMeta}** 个 → 这 ${missingMeta} 个键永远出不了谜语`);
out.push('');

for (const g of GROUPS) {
  out.push(`## ${g.title}`);
  out.push('');
  if (g.note) { out.push(`> ${g.note}`); out.push(''); }
  for (const baseKey of g.keys) {
    const tiers = TIERS.map((t) => ({ ...t, key: baseKey + t.suffix, got: pick(baseKey + t.suffix) }));
    const shown = tiers.filter((t) => t.got);
    if (!shown.length) continue;
    out.push(`### \`${baseKey}\``);
    const ph = placeholders([].concat(...shown.map((t) => t.got.list)));
    out.push('');
    out.push(ph.length ? `占位符：${ph.map((p) => '`' + p + '`').join(' ')}` : '无占位符（固定文本）');
    out.push('');
    out.push('| 档位 | 原文 |');
    out.push('| --- | --- |');
    for (const t of tiers) {
      if (t.got) {
        const tag = t.got.from === 'engine' ? '（内置兜底）' : '';
        out.push(`| ${t.label}${tag} | ${cell(t.got.list)} |`);
      } else {
        out.push(`| ${t.label} | _未设定 → 回退到明示_ |`);
      }
    }
    out.push('');
  }
}

fs.writeFileSync(DOC, out.join('\n'), 'utf8');
console.log('写出：', DOC);
console.log('基础键', totalKeys, '缺_vague', missingVague, '缺_meta', missingMeta);
