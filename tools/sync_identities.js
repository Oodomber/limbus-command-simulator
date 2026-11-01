/**
 * 把「用户副本」里新增的人格合并进打包基线 data/identities.json。
 *
 * 背景：
 *   dataLoader 的读取优先级是 userData/data/*.json > 打包 data/*.json，
 *   所以用编辑器新增的人格只落在用户副本里，打包基线不会变。
 *   这个脚本把用户副本里的新增条目搬进打包基线，让两边一致。
 *
 * 规则：
 *   - 以 sinner + name 作为唯一键（id 不可靠：新增条目是 new_<时间戳>）
 *   - 打包基线里没有的、用户副本里有的 → 追加
 *   - 两边都有的 → 保留打包基线那条（不覆盖），只在 --apply 时报告差异
 *   - 新增条目的 id 如果是 new_<数字>，重新生成为 <sinner拼音>_<name拼音>
 *   - 依据 tags 重新生成冗余字段 faction / special
 *
 * 用法：
 *   node tools/sync_identities.js            # 只看差异（dry run）
 *   node tools/sync_identities.js --apply    # 真的写进 data/identities.json
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUNDLED = path.join(ROOT, 'data', 'identities.json');
const USER_DATA = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'limbus-command-simulator', 'data', 'identities.json')
  : null;

const APPLY = process.argv.includes('--apply');

// 罪人 → 拼音（与现有 id 的前缀保持一致）
const SINNER_PINYIN = {
  李箱: 'yi_sang',
  浮士德: 'faust',
  堂吉诃德: 'don_quixote',
  良秀: 'ryoshu',
  默尔索: 'meursault',
  鸿璐: 'hong_lu',
  希斯克利夫: 'heathcliff',
  以实玛利: 'ishmael',
  罗佳: 'rodion',
  辛克莱: 'sinclair',
  奥提斯: 'outis',
  格里高尔: 'gregor',
};

// 常用字 → 拼音（人格名里出现频率最高的那批，够用即可）
const CHAR_PINYIN = {
  黎: 'li', 明: 'ming', 事: 'shi', 务: 'wu', 所: 'suo', 收: 'shou', 尾: 'wei', 人: 'ren',
  代: 'dai', 表: 'biao', 高: 'gao', 级: 'ji', 定: 'ding', 制: 'zhi', 黑: 'hei', 派: 'pai',
  广: 'guang', 播: 'bo', 室: 'shi', 鞋: 'xie', 馆: 'guan', 改: 'gai', 衣: 'yi', 品: 'pin',
  牌: 'pai', 经: 'jing', 理: 'li', 红: 'hong', 裁: 'cai', 缝: 'feng', 之: 'zhi', 王: 'wang',
  赤: 'chi', 神: 'shen', 精: 'jing', 店: 'dian', 流: 'liu', 浪: 'lang', 乐: 'yue', 队: 'dui',
  老: 'lao', 大: 'da', 东: 'dong', 部: 'bu', 科: 'ke', 协: 'xie', 会: 'hui', 次: 'ci',
  元: 'yuan', 撕: 'si', 裂: 'lie', 者: 'zhe', 庄: 'zhuang', 严: 'yan', 哀: 'ai', 悼: 'diao',
  影: 'ying', 镜: 'jing', 反: 'fan', 射: 'she', 触: 'chu', 觉: 'jue', 拒: 'ju', 绝: 'jue',
  宣: 'xuan', 告: 'gao', 空: 'kong', 洞: 'dong', 焰: 'yan', 火: 'huo', 柴: 'chai', 根: 'gen',
  第: 'di', 四: 'si', 知: 'zhi', 识: 'shi', 树: 'shu', 枝: 'zhi', 青: 'qing', 智: 'zhi',
  慧: 'hui', 苦: 'ku', 难: 'nan', 致: 'zhi', 与: 'yu', 提: 'ti', 灯: 'deng', 脑: 'nao',
  叶: 'ye', 公: 'gong', 司: 'si', 边: 'bian', 狱: 'yu', 城: 'cheng', 保: 'bao', 安: 'an',
  六: 'liu', 协: 'xie', 七: 'qi', 八: 'ba', 十: 'shi', 二: 'er', 三: 'san', 一: 'yi',
};

function slugify(text) {
  const out = [];
  for (const ch of String(text || '')) {
    if (/[a-z0-9]/i.test(ch)) out.push(ch.toLowerCase());
    else if (CHAR_PINYIN[ch]) out.push(CHAR_PINYIN[ch]);
  }
  return out.join('_') || 'unknown';
}

function makeId(item) {
  const s = SINNER_PINYIN[item.sinner] || 'sinner';
  return `${s}_${slugify(item.name)}`;
}

function rebuildRedundant(item) {
  const t = item.tags || {};
  const factionParts = [];
  if (Array.isArray(t.faction)) factionParts.push(...t.faction);
  item.faction = factionParts.length ? `${item.name}、${factionParts.join('、')}` : '';
  if (Array.isArray(t.special) && t.special.length) item.special = t.special.join('、');
  else item.special = '';
}

function key(item) {
  return `${item.sinner || ''}|${item.name || ''}`;
}

function load(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const bundled = load(BUNDLED);
  if (!bundled) {
    console.error('找不到打包基线：', BUNDLED);
    process.exit(1);
  }
  const user = load(USER_DATA);
  if (!user) {
    console.log('没有用户副本，无需同步：', USER_DATA);
    return;
  }

  console.log(`打包基线 ${bundled.length} 条`);
  console.log(`用户副本 ${user.length} 条`);

  const bs = new Map(bundled.map((x) => [key(x), x]));
  const us = new Map(user.map((x) => [key(x), x]));

  const onlyUser = [...us.keys()].filter((k) => !bs.has(k));
  const onlyBundled = [...bs.keys()].filter((k) => !us.has(k));

  console.log(`\n只存在于用户副本（需要并入打包）：${onlyUser.length} 条`);
  onlyUser.forEach((k) => {
    const it = us.get(k);
    console.log(`  + ${it.sinner}｜${it.name}  (当前 id: ${it.id})`);
  });

  console.log(`\n只存在于打包基线（用户副本里没有）：${onlyBundled.length} 条`);
  onlyBundled.forEach((k) => {
    const it = bs.get(k);
    console.log(`  - ${it.sinner}｜${it.name}  (id: ${it.id})`);
  });

  if (onlyUser.length === 0) {
    console.log('\n没有要补的条目，结束。');
    return;
  }

  if (!APPLY) {
    console.log('\n（dry run，未写入。确认无误后加 --apply 执行）');
    return;
  }

  const idSet = new Set(bundled.map((x) => x.id));
  let added = 0;
  for (const k of onlyUser) {
    const src = us.get(k);
    const item = JSON.parse(JSON.stringify(src));
    if (!item.id || /^new_\d+$/.test(item.id) || idSet.has(item.id)) {
      let candidate = makeId(item);
      let n = 2;
      while (idSet.has(candidate)) candidate = `${makeId(item)}_${n++}`;
      console.log(`  id 规范化：${item.id} -> ${candidate}`);
      item.id = candidate;
    }
    idSet.add(item.id);
    rebuildRedundant(item);
    bundled.push(item);
    added++;
  }

  fs.writeFileSync(BUNDLED, JSON.stringify(bundled, null, 2), 'utf8');
  console.log(`\n已写入 ${BUNDLED}，新增 ${added} 条，总计 ${bundled.length} 条。`);
  console.log('提示：用户副本仍然优先，两边内容一致即可；如需让打包基线生效可删除用户副本。');
}

main();
