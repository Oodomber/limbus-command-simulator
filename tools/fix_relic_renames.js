/**
 * 按游戏内文案修正饰品名字（id / 图片路径保持不变，避免打断已有引用）。
 *
 * 用法：
 *   node tools/fix_relic_renames.js           # 只看会改什么
 *   node tools/fix_relic_renames.js --apply   # 写入
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUNDLED = path.join(ROOT, 'data', 'relics.json');
const APPLY = process.argv.includes('--apply');

// 旧名 -> 新名（用户已确认以游戏内为准）
const RENAMES = {
  炼狱炎蝶之梦: '地狱蝶之梦',
  嗜伤甲虫: '拟伤虫',
};

function userPath() {
  if (!process.env.APPDATA) return null;
  return path.join(process.env.APPDATA, 'limbus-command-simulator', 'data', 'relics.json');
}

function apply(file, label) {
  if (!fs.existsSync(file)) {
    console.log(`${label}：不存在，跳过`);
    return 0;
  }
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  for (const item of list) {
    const next = RENAMES[item.name];
    if (next) {
      console.log(`  ${label}：${item.name} -> ${next}（id ${item.id} 不变）`);
      item.name = next;
      n++;
    }
  }
  if (APPLY && n > 0) fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
  return n;
}

const a = apply(BUNDLED, '打包基线');
const uf = userPath();
const b = uf ? apply(uf, '用户副本') : 0;

console.log(`\n共 ${a + b} 处改名${APPLY ? '，已写入' : '（dry run，加 --apply 写入）'}`);
