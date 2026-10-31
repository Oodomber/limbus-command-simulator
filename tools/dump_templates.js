/**
 * dump_templates.js — 把引擎里所有「实际会出的指令」抖出来，供人工审阅。
 *
 * 不是读 templates.json 静态列表，而是真的跑指令引擎：每个环节生成 N 次，
 * 记录每次用到的模板键、填充后的文本、以及触发占比，最后汇总成 Markdown。
 *
 * 用法：node tools/dump_templates.js [每环节次数]
 * 产物：设计文档/指令模板总表.md
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '..', '设计文档', '指令模板总表.md');

const { InstructionEngine, DEFAULT_TEMPLATES } = require(path.join(ROOT, 'src', 'engine'));
const { DataLoader } = require(path.join(ROOT, 'src', 'dataLoader'));

const N = Number(process.argv[2] || 300);

// 极简 store，够引擎读默认值即可
const mem = new Map();
const store = {
  get: (k, d) => (mem.has(k) ? mem.get(k) : d),
  set: (k, v) => mem.set(k, v),
};

const PHASE_LIST = [
  'deploy_identity', 'deploy_ego', 'starlight', 'starting_relic',
  'cardpack', 'route', 'combat', 'event', 'judgment', 'event_reward',
  'shop', 'boss_reward', 'free_instruction',
];

const PHASE_LABEL = {
  deploy_identity: '开局·选人格',
  deploy_ego: '开局·选 EGO',
  starlight: '开局·星光',
  starting_relic: '开局·初始饰品',
  cardpack: '卡包选择',
  route: '路线',
  combat: '战斗（指令选择）',
  event: '事件',
  judgment: '判定',
  event_reward: '奖励卡',
  shop: '商店',
  boss_reward: '关底饰品奖励',
  free_instruction: '自由指令',
};

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

function makeContext() {
  const teamSize = randInt(1, 6);
  const team = [];
  for (let i = 0; i < teamSize; i++) team.push('s' + i);
  const starlightLevel = randInt(0, 2);
  return {
    currentTeam: new Set(team),
    formation: team,
    poolIdentityIds: null,
    poolEgoIds: null,
    starlightEffects: {
      interstellarTravel: starlightLevel,
      starOfInterstellarTravel: starlightLevel,
      meteorRain: Math.random() < 0.3,
      doubleStarShop: Math.random() < 0.3,
      comprehensivePossibility: Math.random() < 0.3,
    },
    isHardMode: Math.random() < 0.5,
    blessing: randInt(0, 400),
    karma: randInt(0, 300),
    currentFloor: randInt(1, 15),
    coreMechanics: [],
    usedCardpackRerolls: randInt(0, 2),
    recognizedItems: null,
  };
}

async function main() {
  const userData = path.join(os.tmpdir(), 'jz-dump-userdata');
  fs.mkdirSync(userData, { recursive: true });
  const dataLoader = new DataLoader(userData, path.join(ROOT, 'data'));
  const engine = new InstructionEngine(dataLoader, store);

  // 钩住模板选择与填充，准确记录「哪段文字来自哪个模板键」。
  // 不能简单地「取第一个 pick」——战斗/商店一次会生成多条指令，
  // pick 与 fill 是交替发生的，必须靠文本本身做配对。
  let lastKey = '(unknown)';
  let fills = [];
  let picks = [];
  const origPick = engine._pickTieredTemplate.bind(engine);
  engine._pickTieredTemplate = function (templates, key, fallbackKey) {
    const tpl = origPick(templates, key, fallbackKey);
    lastKey = key;
    picks.push({ key, text: tpl });
    return tpl;
  };
  const origFill = engine._fillTemplate.bind(engine);
  engine._fillTemplate = function (template, vars) {
    const text = origFill(template, vars);
    fills.push({ key: lastKey, text });
    return text;
  };

  const stats = {};
  const phaseInfo = {};

  for (const phase of PHASE_LIST) {
    phaseInfo[phase] = { runs: 0, empty: 0, errors: 0, perRun: [] };
    for (let i = 0; i < N; i++) {
      fills = [];
      lastKey = '(unknown)';
      let res = null;
      try {
        res = await engine.generate(phase, makeContext());
      } catch (e) {
        phaseInfo[phase].errors++;
        if (phaseInfo[phase].errors === 1) phaseInfo[phase].firstError = e.message;
        continue;
      }
      phaseInfo[phase].runs++;
      const insts = (res && res.instructions) || [];
      if (!insts.length) { phaseInfo[phase].empty++; continue; }
      phaseInfo[phase].perRun.push(insts.length);
      for (const inst of insts) {
        const text = String(inst.text || '');
        const hit = fills.find((f) => f.text === text) || picks.find((p) => p.text === text);
        const key = (hit && hit.key) || ('(专用生成逻辑)');
        if (!stats[key]) stats[key] = { count: 0, samples: new Map(), phases: new Set() };
        stats[key].count++;
        stats[key].phases.add(phase);
        stats[key].samples.set(text, (stats[key].samples.get(text) || 0) + 1);
      }
    }
  }

  // ── 生成 Markdown ──
  const lines = [];
  lines.push('# 指令模板总表（引擎实际会出的指令）');
  lines.push('');
  lines.push('> 本文由 `tools/dump_templates.js` 跑真实指令引擎生成，不是静态模板清单。');
  lines.push(`> 每个环节跑 ${N} 次、上下文随机（编队 1~6 人、普通/困难、加护 0~400、业 0~300、层数 1~15、星光效果随机）。`);
  lines.push('> 「触发占比」= 该模板键在本环节所有出招里的占比，用来判断哪些指令其实很少出现。');
  lines.push('');

  lines.push('## 一、每个环节会出哪些指令');
  lines.push('');
  for (const phase of PHASE_LIST) {
    const info = phaseInfo[phase];
    const keys = Object.keys(stats).filter((k) => stats[k].phases.has(phase));
    lines.push(`### ${PHASE_LABEL[phase]} \`${phase}\``);
    lines.push('');
    if (info.errors) {
      lines.push(`- 生成报错 ${info.errors}/${N} 次：${info.firstError || ''}`);
    }
    if (!keys.length) {
      lines.push('- （该环节没有产出任何指令）');
      lines.push('');
      continue;
    }
    const total = keys.reduce((s, k) => s + stats[k].count, 0);
    const avg = info.perRun.reduce((a, b) => a + b, 0) / Math.max(1, info.perRun.length);
    lines.push(`- 平均每次出 ${avg.toFixed(2)} 条；空结果 ${info.empty} 次`);
    lines.push('');
    lines.push('| 模板键 | 触发占比 | 示例文本 |');
    lines.push('| --- | --- | --- |');
    const sorted = keys.sort((a, b) => stats[b].count - stats[a].count);
    for (const k of sorted) {
      const st = stats[k];
      const pct = ((st.count / total) * 100).toFixed(1) + '%';
      const samples = [...st.samples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const ex = samples.map(([t]) => t.replace(/\|/g, '\\|')).join('<br>');
      lines.push(`| \`${k}\` | ${pct} | ${ex} |`);
    }
    lines.push('');
  }

  lines.push('## 二、每个模板键的全部变体（明示 / 暗示 / 谜语）');
  lines.push('');
  const allKeys = new Set([...Object.keys(DEFAULT_TEMPLATES), ...Object.keys(stats)]);
  const baseKeys = [];
  for (const k of allKeys) {
    if (k.endsWith('_vague') || k.endsWith('_meta')) continue;
    baseKeys.push(k);
  }
  for (const k of baseKeys.sort()) {
    const base = DEFAULT_TEMPLATES[k] || null;
    const vague = DEFAULT_TEMPLATES[k + '_vague'] || null;
    const meta = DEFAULT_TEMPLATES[k + '_meta'] || null;
    const used = stats[k] ? stats[k].count : 0;
    lines.push(`### \`${k}\`${used ? `（实测出过 ${used} 次）` : '（实测未触发）'}`);
    lines.push('');
    if (base) base.forEach((t) => lines.push(`- 明示：${t}`));
    if (vague) vague.forEach((t) => lines.push(`- 暗示：${t}`));
    if (meta) meta.forEach((t) => lines.push(`- 谜语：${t}`));
    if (!base) lines.push('- 没有基础模板');
    if (!vague) lines.push('- 缺 `_vague`（40% 的暗示档会落到明示）');
    if (!meta) lines.push('- 缺 `_meta`（20% 的谜语档会落到明示）');
    lines.push('');
  }

  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
  console.log('写出：', OUT);
  console.log('模板键总数', Object.keys(stats).length);
}

main().catch((e) => { console.error(e); process.exit(1); });
