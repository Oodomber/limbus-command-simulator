/**
 * 按用户游戏内确认的译名，批量修正数据文件里的旧译名。
 *
 * 已确认（2026-11-01，用户游戏内核对）：
 *   流浪乐队头目        -> 流浪乐队老大        （人格，辛克莱）
 *   终末火柴之光        -> 第四根火柴之焰      （E.G.O，李箱/良秀/罗佳）
 *   智慧的青枝          -> 知识树之枝          （E.G.O，辛克莱）
 *
 * 只改 name，不动 id —— id 被 ownedIdentities / identityPools 等引用，
 * 改了会让玩家的拥有记录与人格池失效。
 *
 * 用法：node tools/fix_renames.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

// [文件类型, 旧名精确匹配, 新名]
const RENAMES = [
  ['identities', '流浪乐队头目', '流浪乐队老大'],
  ['egos', '终末火柴之光', '第四根火柴之焰'],
  ['egos', '智慧的青枝', '知识树之枝'],
];

function targets() {
  const list = [
    { label: '打包数据', dir: path.join(ROOT, 'data') },
  ];
  const userData = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'limbus-command-simulator', 'data')
    : null;
  if (userData && fs.existsSync(userData)) {
    list.push({ label: '用户副本', dir: userData });
  }
  return list;
}

function patch(dir, type) {
  const file = path.join(dir, `${type}.json`);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, 'utf8');
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) return null;

  const hits = [];
  for (const item of arr) {
    for (const [t, from, to] of RENAMES) {
      if (t !== type) continue;
      if (item.name === from) {
        hits.push(`${item.sinner || ''} ${from} -> ${to}  (id 保持 ${item.id})`);
        item.name = to;
      }
    }
  }
  if (hits.length === 0) return { file, total: arr.length, hits };

  fs.writeFileSync(file, JSON.stringify(arr, null, 2), 'utf8');
  return { file, total: arr.length, hits };
}

let changed = 0;
for (const { label, dir } of targets()) {
  console.log(`\n== ${label} ${dir}`);
  for (const type of ['identities', 'egos']) {
    const r = patch(dir, type);
    if (!r) {
      console.log(`  ${type}: 无此文件`);
      continue;
    }
    if (r.hits.length === 0) {
      console.log(`  ${type}: ${r.total} 条，无需改动`);
    } else {
      changed += r.hits.length;
      console.log(`  ${type}: ${r.total} 条，改了 ${r.hits.length} 条`);
      for (const h of r.hits) console.log(`    - ${h}`);
    }
  }
}

console.log(`\n合计改写 ${changed} 处。`);
