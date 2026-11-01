/**
 * 统一 E.G.O 数据的字段形状，并让「用户副本」与「打包基线」完全一致。
 *
 * 1. 所有条目的 sinCost 补齐七种罪孽（缺失按 0）
 * 2. tags.damageType / tags.effect / tags.special 统一成数组
 * 3. 用户副本按 sinner|name 对齐打包基线（id / 全部字段），保证运行时读到的就是同一份
 *
 * 用法：
 *   node tools/normalize_egos.js           # 只看统计
 *   node tools/normalize_egos.js --apply   # 写入
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUNDLED = path.join(ROOT, 'data', 'egos.json');
const APPLY = process.argv.includes('--apply');
const SINS = ['暴怒', '色欲', '怠惰', '暴食', '忧郁', '傲慢', '嫉妒'];

function userPath() {
  if (!process.env.APPDATA) return null;
  return path.join(process.env.APPDATA, 'limbus-command-simulator', 'data', 'egos.json');
}

function keyOf(e) {
  return `${e.sinner || ''}|${e.name || ''}`;
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .sort()
      .reduce((acc, k) => {
        acc[k] = canon(v[k]);
        return acc;
      }, {});
  }
  return v;
}

function normalize(item) {
  let changed = 0;
  const src = item.sinCost && typeof item.sinCost === 'object' ? item.sinCost : {};
  const next = {};
  for (const s of SINS) next[s] = Number(src[s]) || 0;
  if (Object.keys(src).length !== SINS.length) changed++;
  item.sinCost = next;
  if (!item.tags || typeof item.tags !== 'object') {
    item.tags = {};
    changed++;
  }
  for (const f of ['damageType', 'effect', 'special']) {
    if (!Array.isArray(item.tags[f])) {
      item.tags[f] = [];
      changed++;
    }
  }
  return changed;
}

const bundled = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
let shapeFixes = 0;
for (const e of bundled) shapeFixes += normalize(e);

const uf = userPath();
const user = uf && fs.existsSync(uf) ? JSON.parse(fs.readFileSync(uf, 'utf8')) : null;
let userShape = 0;
if (user) for (const e of user) userShape += normalize(e);

let aligned = 0;
if (user) {
  const bmap = new Map(bundled.map((e) => [keyOf(e), e]));
  for (const e of user) {
    const target = bmap.get(keyOf(e));
    if (!target) continue;
    const before = JSON.stringify(canon(e));
    const copy = JSON.parse(JSON.stringify(target));
    for (const f of Object.keys(e)) if (!(f in copy)) delete e[f];
    Object.assign(e, copy);
    if (JSON.stringify(canon(e)) !== before) aligned++;
  }
}

console.log(`打包 ${bundled.length} 条，形状修正 ${shapeFixes} 处`);
if (user) console.log(`用户副本 ${user.length} 条，形状修正 ${userShape} 处，对齐 ${aligned} 条`);

if (APPLY) {
  fs.writeFileSync(BUNDLED, JSON.stringify(bundled, null, 2), 'utf8');
  if (user) fs.writeFileSync(uf, JSON.stringify(user, null, 2), 'utf8');
  console.log('已写入。');
} else {
  console.log('（dry run，未写入。加 --apply 执行）');
}
