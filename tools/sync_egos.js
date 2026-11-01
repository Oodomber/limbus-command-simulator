/**
 * 把「用户副本」里新增的 E.G.O 合并进打包基线 data/egos.json。
 *
 * 与 sync_identities.js 同一套思路：
 *   - 以 sinner + name 为唯一键
 *   - 只补打包基线里没有的
 *   - id 规范化成 <罪人拼音>_<名字拼音>
 *   - sinCost 补齐七种罪孽（0），tags 补齐 damageType / effect / special 三个数组
 *
 * 用法：
 *   node tools/sync_egos.js            # 只看差异
 *   node tools/sync_egos.js --apply    # 写入打包基线
 */

const fs = require('fs');
const path = require('path');
const { makeId } = require('./sync_identities');

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

function normalize(item) {
  if (!item.tags || typeof item.tags !== 'object') item.tags = {};
  if (!Array.isArray(item.tags.damageType)) item.tags.damageType = [];
  if (!Array.isArray(item.tags.effect)) item.tags.effect = [];
  if (!Array.isArray(item.tags.special)) item.tags.special = [];
  const cost = {};
  const src = item.sinCost && typeof item.sinCost === 'object' ? item.sinCost : {};
  for (const s of SINS) cost[s] = Number(src[s]) || 0;
  item.sinCost = cost;
  item.attackCapacity = Number(item.attackCapacity) || 0;
  item.coinCount = Number(item.coinCount) || 0;
  item.isBaseEgo = item.isBaseEgo === true;
  if (!item.level) item.level = 'ZAYIN';
  return item;
}

function main() {
  const bundled = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  const uf = userPath();
  if (!uf || !fs.existsSync(uf)) {
    console.log('没有用户副本，无需同步');
    return;
  }
  const user = JSON.parse(fs.readFileSync(uf, 'utf8'));

  console.log(`打包基线 ${bundled.length} 条 / 用户副本 ${user.length} 条`);

  const bs = new Set(bundled.map(keyOf));
  const onlyUser = user.filter((e) => !bs.has(keyOf(e)));
  const us = new Set(user.map(keyOf));
  const onlyBundled = bundled.filter((e) => !us.has(keyOf(e)));

  console.log(`\n只存在于用户副本（要并入打包）：${onlyUser.length} 条`);
  for (const e of onlyUser) {
    console.log(`  + ${e.sinner}｜${e.name}  id=${e.id}  level=${e.level}  isBaseEgo=${e.isBaseEgo}  cost=${JSON.stringify(e.sinCost)}`);
  }
  console.log(`\n只存在于打包基线：${onlyBundled.length} 条`);
  for (const e of onlyBundled) console.log(`  - ${e.sinner}｜${e.name}`);

  if (onlyUser.length === 0) {
    console.log('\n没有要补的条目。');
    return;
  }
  if (!APPLY) {
    console.log('\n（dry run，未写入。加 --apply 执行）');
    return;
  }

  const idSet = new Set(bundled.map((e) => e.id));
  let added = 0;
  for (const e of onlyUser) {
    const item = normalize(JSON.parse(JSON.stringify(e)));
    const canonical = makeId(item);
    if (item.id !== canonical) {
      let candidate = canonical;
      let n = 2;
      while (idSet.has(candidate)) candidate = `${canonical}_${n++}`;
      console.log(`  id 规范化：${item.id || '(空)'} -> ${candidate}`);
      item.id = candidate;
    }
    idSet.add(item.id);
    bundled.push(item);
    added++;
  }
  fs.writeFileSync(BUNDLED, JSON.stringify(bundled, null, 2), 'utf8');
  console.log(`\n已写入 ${BUNDLED}，新增 ${added} 条，总计 ${bundled.length} 条。`);
}

main();
