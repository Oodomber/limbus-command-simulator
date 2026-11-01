/**
 * 数据洁癖工具：修掉 tags 里明显写错的标签，并让「用户副本」与「打包基线」逐字段一致。
 *
 * 目前处理：
 *   1. 双写前缀 `EE.G.O装备` -> `E.G.O装备`
 *   2. 把用户副本里那些「打包基线没有的空 tags.special」删掉（等价但会让比对噪声大）
 *   3. 共用条目：把打包基线的 faction / special / tags 原样写回用户副本，保证两边完全一致
 *
 * 用法：
 *   node tools/fix_data_typos.js           # 只看差异
 *   node tools/fix_data_typos.js --apply   # 写入
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

const PAIRS = [
  { name: 'identities', bundled: path.join(ROOT, 'data', 'identities.json') },
  { name: 'egos', bundled: path.join(ROOT, 'data', 'egos.json') },
];

function userPathFor(name) {
  if (!process.env.APPDATA) return null;
  return path.join(process.env.APPDATA, 'limbus-command-simulator', 'data', `${name}.json`);
}

function keyOf(item) {
  if (item.sinner) return `${item.sinner}|${item.name}`;
  return item.name || item.id;
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

function fixTags(tags) {
  if (!tags) return 0;
  let fixes = 0;
  for (const field of Object.keys(tags)) {
    const arr = tags[field];
    if (!Array.isArray(arr)) continue;
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== 'string') continue;
      const fixed = arr[i].replace(/^EE\.G\.O/, 'E.G.O');
      if (fixed !== arr[i]) {
        console.log(`    标签修正：${arr[i]} -> ${fixed}`);
        arr[i] = fixed;
        fixes++;
      }
    }
  }
  return fixes;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

let totalFixes = 0;
let totalAlign = 0;

for (const pair of PAIRS) {
  console.log(`\n=== ${pair.name}`);
  const bundled = loadJson(pair.bundled);
  const userFile = userPathFor(pair.name);
  const user = userFile && fs.existsSync(userFile) ? loadJson(userFile) : null;

  // 1. 修打包基线与用户副本的标签拼写
  for (const item of bundled) totalFixes += fixTags(item.tags);
  if (user) for (const item of user) totalFixes += fixTags(item.tags);

  // 2. 对齐用户副本里与打包基线共用的条目
  if (user) {
    const bmap = new Map(bundled.map((x) => [keyOf(x), x]));
    for (const item of user) {
      const target = bmap.get(keyOf(item));
      if (!target) continue;
      const before = JSON.stringify(canon(item));
      item.tags = JSON.parse(JSON.stringify(target.tags || {}));
      item.faction = target.faction;
      item.special = target.special;
      if (canon(item).name !== undefined) item.name = target.name;
      if (JSON.stringify(canon(item)) !== before) totalAlign++;
    }
  }

  console.log(`  基线 ${bundled.length} 条${user ? ` / 用户副本 ${user.length} 条` : ' / 无用户副本'}`);

  if (APPLY) {
    fs.writeFileSync(pair.bundled, JSON.stringify(bundled, null, 2), 'utf8');
    if (user) fs.writeFileSync(userFile, JSON.stringify(user, null, 2), 'utf8');
  }
}

console.log(`\n标签修正 ${totalFixes} 处，用户副本对齐 ${totalAlign} 条`);
if (!APPLY) {
  console.log('（dry run，未写入。确认无误后加 --apply 执行）');
} else {
  console.log('已写入。');
}
