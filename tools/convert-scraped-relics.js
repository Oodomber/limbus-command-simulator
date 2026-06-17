/**
 * convert-scraped-relics.js — 将浏览器端爬取的饰品JSON转为标准 relics.json 格式
 *
 * 用法: node tools/convert-scraped-relics.js
 *
 * 1. 读取 饰品爬取/ego_acc_YYYY-MM-DD.json（最新日期）
 * 2. 匹配旧 data/relics.json 中的 ID（按名称）
 * 3. 新饰品用 pinyinSlug 生成 ID（兼容 Python crawler_utils._simple_pinyin）
 * 4. 写入 data/relics.json + 数据爬取/relics.json
 */

const fs = require('fs');
const path = require('path');

// ── 拼音字符映射（与 Python crawler_utils._simple_pinyin 同步） ──
const CHAR_MAP = {
  // 罪人
  "李":"li","箱":"xiang","浮":"fu","士":"shi","德":"de",
  "唐":"tang","吉":"ji","诃":"he","尔":"er",
  "良":"liang","秀":"xiu",
  "默":"mo","索":"suo",
  "鸿":"hong","璐":"lu",
  "希":"xi","斯":"si","克":"ke","利":"li","夫":"fu",
  "以":"yi","实":"shi","玛":"ma",
  "罗":"luo","佳":"jia",
  "辛":"xin","莱":"lai",
  "奥":"ao","提":"ti",
  "格":"ge","里":"li","高":"gao",
  // 常用词
  "杀":"sha","手":"shou","人":"ren","员":"yuan",
  "大":"da","副":"fu","清":"qing","扫":"sao",
  "收":"shou","尾":"wei","事":"shi","务":"wu","所":"suo",
  "火":"huo","光":"guang","剑":"jian","契":"qi","组":"zu",
  "六":"liu","协":"xie","会":"hui","一":"yi","二":"er","三":"san",
  "四":"si","五":"wu","七":"qi","八":"ba","九":"jiu","十":"shi",
  "南":"nan","部":"bu","北":"bei","科":"ke","等":"deng","级":"ji",
  "指":"zhi","挥":"hui","官":"guan","见":"jian","习":"xi",
  "黑":"hei","云":"yun","臼":"jiu","齿":"chi",
  "玫":"mei","瑰":"gui","工":"gong","匠":"jiang",
  "新":"xin","年":"nian","春":"chun","节":"jie",
  "船":"chuan","长":"zhang","金":"jin","笠":"li",
  "死":"si","亡":"wang","枪":"qiang",
  "花":"hua","园":"yuan","小":"xiao","鸟":"niao",
  "象":"xiang","牙":"ya","号":"hao","蝴":"hu","蝶":"die",
  "山":"shan","茶":"cha","之":"zhi","主":"zhu","角":"jiao",
  "中":"zhong","指":"zhi","派":"pai","徒":"tu",
  "鱼":"yu","叉":"cha","猎":"lie",
  "准":"zhun","备":"bei",
  "镜":"jing","子":"zi","世":"shi","界":"jie",
  "血":"xue","魔":"mo","僧":"seng",
  "庄":"zhuang","严":"yan","哀":"ai","悼":"dao",
  "凶":"xiong","弹":"dan",
  "工":"gong","业":"ye","革":"ge","命":"ming",
  "暴":"bao","雨":"yu","办":"ban","公":"gong","室":"shi",
  "提":"ti","灯":"deng","星":"xing",
  "铁":"tie","道":"dao","迷":"mi","宫":"gong",
  "绽":"zhan","放":"fang","融":"rong","合":"he",
  "炼":"lian","狱":"yu","炎":"yan","梦":"meng",
  "倒":"dao","错":"cuo",
  "尘":"chen","归":"gui",
  "采":"cai","包":"bao",
  "嗜":"shi","伤":"shang","甲":"jia","虫":"chong",
  "咖":"ka","啡":"fei","与":"yu","纸":"zhi","鹤":"he",
  "朱":"zhu","红":"hong","蛾":"e","群":"qun",
  "染":"ran","钉":"ding",
  "炽":"chi","热":"re","羽":"yu",
  "鲜":"xian","装":"zhuang",
};

function simplePinyin(text) {
  let result = [];
  for (const ch of text) {
    if (CHAR_MAP[ch]) {
      result.push(CHAR_MAP[ch]);
    } else if (/[a-zA-Z]/.test(ch)) {
      result.push(ch.toLowerCase());
    } else if (/[0-9]/.test(ch)) {
      result.push(ch);
    } else if (ch === ' ' || ch === '-' || ch === '–') {
      result.push('_');
    } else if (ch.codePointAt(0) > 127) {
      // 未知中文字符: 用 Python 风格 c+hex
      result.push('c' + ch.codePointAt(0).toString(16));
    }
    // 跳过其他 ASCII 符号
  }
  return result.join('').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function generateRelicId(name) {
  return simplePinyin(name);
}

// ── 主流程 ──
const rootDir = path.join(__dirname, '..');
const scrapeDir = path.join(rootDir, '..', '饰品爬取');
const crawlDir = path.join(rootDir, '..', '数据爬取');
const dataDir = path.join(rootDir, 'data');

// 找最新的 scraped JSON
const files = fs.readdirSync(scrapeDir).filter(f => f.startsWith('ego_acc_') && f.endsWith('.json'));
if (files.length === 0) {
  console.error('❌ 未在 饰品爬取/ 中找到 ego_acc_*.json 文件');
  process.exit(1);
}
files.sort();
const latestFile = files[files.length - 1];
console.log(`📄 源文件: 饰品爬取/${latestFile}`);

// 读取爬取数据
const raw = JSON.parse(fs.readFileSync(path.join(scrapeDir, latestFile), 'utf8'));
const scraped = raw.accessories || raw;
console.log(`   ${scraped.length} 条饰品`);

// 读取旧 relics.json 建立 name→id 映射
let oldNameToId = {};
const oldPath = path.join(dataDir, 'relics.json');
if (fs.existsSync(oldPath)) {
  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  for (const item of oldData) {
    if (item.name && item.id) {
      oldNameToId[item.name] = item.id;
    }
  }
  console.log(`   旧数据: ${oldData.length} 条, ${Object.keys(oldNameToId).length} 个已映射ID`);
}

// ── 转换 ──
const result = [];
let reused = 0, generated = 0;

for (const item of scraped) {
  const name = item.name;
  if (!name) continue;

  let id;
  if (oldNameToId[name]) {
    id = oldNameToId[name];
    reused++;
  } else {
    id = generateRelicId(name);
    generated++;
    console.log(`   🆕 新ID: ${name} → ${id}`);
  }

  // 确保 tags 结构完整
  const tags = item.tags || {};
  const sinAffinity = Array.isArray(tags.sinAffinity) ? tags.sinAffinity : [];
  const effect = Array.isArray(tags.effect) ? tags.effect : [];

  result.push({
    id,
    name,
    tier: item.tier || '未知',
    tags: {
      effect,
      sinAffinity,
    },
    price: item.price !== undefined ? item.price : null,
  });
}

console.log(`   ID: ${reused} 复用, ${generated} 新生成`);
console.log(`   总计: ${result.length} 条`);

// ── 写回 ──
fs.writeFileSync(path.join(dataDir, 'relics.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(`✅ 已写入 data/relics.json`);

fs.writeFileSync(path.join(crawlDir, 'relics.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(`✅ 已写入 数据爬取/relics.json`);

// ── 统计对比 ──
console.log('\n📊 罪孽属性分布:');
const sinCount = {};
for (const item of result) {
  for (const s of (item.tags.sinAffinity || [])) {
    sinCount[s] = (sinCount[s] || 0) + 1;
  }
}
for (const [sin, count] of Object.entries(sinCount).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${sin}: ${count}`);
}
const totalWithSin = result.filter(r => r.tags.sinAffinity && r.tags.sinAffinity.length > 0).length;
console.log(`   有罪孽属性: ${totalWithSin}/${result.length}`);

console.log('\n✅ 转换完成！');
