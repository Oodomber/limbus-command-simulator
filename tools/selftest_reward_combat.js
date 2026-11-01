// 临时自检：①战斗多罪人指令必须按队伍顺序；②关卡饰品奖励文案独立
const path = require('path');
const os = require('os');
const { DataLoader } = require('../src/dataLoader');
const { InstructionEngine, PHASES } = require('../src/engine');

const store = { get: () => undefined, set: () => {} };
const dl = new DataLoader(path.join(os.tmpdir(), 'jz-selftest'), path.join(__dirname, '..', 'data'));
const engine = new InstructionEngine(dl, store);

const formation = ['李箱', '浮士德', '唐吉诃德', '良秀', '默尔索', '希斯克利夫', '以实玛丽'];

(async () => {
  // ── ① 战斗顺序 ──
  let multi = 0;
  let bad = 0;
  const samples = [];
  for (let i = 0; i < 400; i++) {
    const r = await engine.generate(PHASES.COMBAT, {
      formation, poolEgoIds: [], rationality: 0.5,
    });
    const list = r.instructions.filter((x) => x.meta && x.meta.sinner);
    if (list.length < 2) continue;
    multi++;
    const idx = list.map((x) => formation.indexOf(x.meta.sinner));
    const sorted = idx.every((v, k) => k === 0 || idx[k - 1] <= v);
    if (!sorted) bad++;
    if (samples.length < 3) samples.push(list.map((x) => x.meta.sinner).join(' → '));
  }
  console.log(`战斗多罪人批次 ${multi} 个，顺序错误 ${bad} 个`);
  samples.forEach((s, i) => console.log(`  样例${i + 1}: ${s}`));

  // ── ② 关卡饰品奖励 ──
  for (const cards of [1, 2, 3]) {
    const r = await engine.generate(PHASES.COMBAT_REWARD, { vision: { readings: { cards } } });
    console.log(`关卡奖励(cards=${cards}): ${r.instructions.map((x) => x.text).join(' || ')}`);
  }
  const r2 = await engine.generate(PHASES.BOSS_REWARD, { isHardMode: false });
  console.log('关底奖励:', r2.instructions.map((x) => x.text).join(' || '));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
