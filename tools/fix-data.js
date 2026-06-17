/**
 * fix-data.js — One-shot data repair script
 * Fixes crawled JSON data and copies to bundled data/ directory.
 * Run once: node tools/fix-data.js
 */

const fs = require('fs');
const path = require('path');

const SINNER_TO_EN = {
  '李箱': 'yi_sang',
  '浮士德': 'faust',
  '堂吉诃德': 'don_quixote',
  '良秀': 'ryoshu',
  '默尔索': 'meursault',
  '鸿璐': 'hong_lu',
  '希斯克利夫': 'heathcliff',
  '以实玛利': 'ishmael',
  '罗佳': 'rodion',
  '辛克莱': 'sinclair',
  '奥提斯': 'outis',
  '格里高尔': 'gregor',
};

function slugify(name) {
  // Convert Chinese/English name to a safe slug
  return name
    .replace(/[()（）]/g, '')
    .replace(/[：:]/g, '_')
    .replace(/[^a-zA-Z0-9一-鿿]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function pinyinSlug(name) {
  // Simple character-by-character mapping for common Limbus identity name chars
  const charMap = {
    '李': 'yi', '箱': 'sang', '浮': 'fu', '士': 'shi', '德': 'de',
    '堂': 'tang', '吉': 'ji', '诃': 'he', '良': 'liang', '秀': 'xiu',
    '默': 'mo', '尔': 'er', '索': 'suo', '鸿': 'hong', '璐': 'lu',
    '希': 'xi', '斯': 'si', '克': 'ke', '利': 'li', '夫': 'fu',
    '以': 'yi', '实': 'shi', '玛': 'ma', '罗': 'luo', '佳': 'jia',
    '辛': 'xin', '克': 'ke', '莱': 'lai', '奥': 'ao', '提': 'ti',
    '格': 'ge', '里': 'li', '高': 'gao',
    '罪': 'zui', '人': 'ren', '剑': 'jian', '契': 'qi', '组': 'zu',
    '七': 'qi', '协': 'xie', '会': 'hui', '南': 'nan', '部': 'bu',
    '臼': 'jiu', '齿': 'chi', '事': 'shi', '务': 'wu', '所': 'suo',
    '脑': 'nao', '叶': 'ye', '公': 'gong', '司': 'si',
    '庄': 'zhuang', '严': 'yan', '哀': 'ai', '悼': 'dao',
    '终': 'zhong', '末': 'mo', '火': 'huo', '柴': 'chai', '光': 'guang',
    '伤': 'shang', '疤': 'ba', '灰': 'hui',
    '指': 'zhi', '挥': 'hui', '者': 'zhe',
    '收': 'shou', '尾': 'wei',
    '十': 'shi', '字': 'zi', 'F': 'f', 'M': 'm',
    '狂': 'kuang', '气': 'qi', '闘': 'dou', '牛': 'niu', '犬': 'quan',
    '血': 'xue', '魔': 'mo', '流': 'liu',
    'W': 'w', '公': 'gong', '司': 'si',
    'G': 'g', '工': 'gong', '兵': 'bing', '厨': 'chu',
    '黑': 'hei', '云': 'yun', '若': 'ruo', 'N': 'n', '索': 'suo',
    '伞': 'san', '狐': 'hu',
    '卫': 'wei', '环': 'huan', 'Z': 'z', '锁': 'suo',
    'R': 'r', 'H': 'h', 'B': 'b', 'E': 'e', 'O': 'o', 'S': 's',
    'T': 't', 'P': 'p', 'L': 'l', 'C': 'c', 'K': 'k', 'D': 'd',
    '乌': 'wu', '瞰': 'kan',
    '往': 'wang', '昔': 'xi',
    '通': 'tong', '向': 'xiang', '四': 'si', '面': 'mian', '八': 'ba', '方': 'fang',
  };

  let result = '';
  for (const char of name) {
    if (charMap[char]) {
      result += charMap[char];
    } else if (/[a-zA-Z0-9]/.test(char)) {
      result += char.toLowerCase();
    } else {
      // For unknown Chinese chars, use Unicode codepoint as hex
      result += 'x' + char.codePointAt(0).toString(16);
    }
  }
  return result;
}

function generateIdentityId(identity) {
  const enSinner = SINNER_TO_EN[identity.sinner] || 'unknown';
  let nameSlug = pinyinSlug(identity.name);
  // Remove trailing underscores
  nameSlug = nameSlug.replace(/^_|_$/g, '');
  return `${enSinner}_${nameSlug}`;
}

function fixIdentities(rawPath, outPath) {
  console.log(`Reading: ${rawPath}`);
  let text = fs.readFileSync(rawPath, 'utf8');

  // Fix 1: Line 25 — unquoted 体弱 in [体弱]
  text = text.replace('[体弱]', '["体弱"]');

  // Fix 2: Trailing comma before closing bracket on line 44-45
  // Pattern: "麻痹",\n      ] -> "麻痹"\n      ]
  text = text.replace('"麻痹",\n      ]', '"麻痹"\n      ]');

  // General fix for any other trailing commas before ]
  text = text.replace(/,(\s*\n\s*)\]/g, '$1]');

  // Fix any other unquoted Chinese text in arrays
  // Simple pattern: [someChinese] where it's not already quoted and not JSON-safe
  text = text.replace(/\[([^\]]*[一-鿿][^\]]*)\]/g, (match) => {
    // Skip if already has quotes
    if (match.includes('"')) return match;
    // This is an array with at least one Chinese char and no quotes
    const inner = match.slice(1, -1).trim();
    if (!inner) return '[]';
    return `["${inner}"]`;
  });

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error('JSON parse error after fixes:', e.message);
    // Last resort: try to identify the problem position
    const pos = parseInt(e.message.match(/position (\d+)/)?.[1]);
    if (pos) {
      const context = text.substring(Math.max(0, pos - 50), pos + 50);
      console.error(`  Context around position ${pos}: ...${context}...`);
    }
    throw e;
  }

  // Add id field to each record
  for (const item of data) {
    if (!item.id) {
      item.id = generateIdentityId(item);
    }
    // Ensure all tag arrays exist
    if (!item.tags) item.tags = {};
    if (!Array.isArray(item.tags.faction)) item.tags.faction = [];
    if (!Array.isArray(item.tags.effect)) item.tags.effect = [];
    if (!Array.isArray(item.tags.damageType)) item.tags.damageType = [];
    if (!Array.isArray(item.tags.sinAffinity)) item.tags.sinAffinity = [];
    if (!Array.isArray(item.tags.special)) {
      item.tags.special = item.tags.special ? [item.tags.special] : [];
    }
  }

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  -> Fixed: ${outPath} (${data.length} records)`);
}

function fixRelics(rawPath, outPath) {
  console.log(`Reading: ${rawPath}`);
  const data = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  for (const item of data) {
    if (item.price === undefined) {
      item.price = null;
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  -> Fixed: ${outPath} (${data.length} records)`);
}

function copyValid(sourcePath, destPath, label) {
  console.log(`Reading: ${sourcePath}`);
  const data = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  fs.writeFileSync(destPath, JSON.stringify(data, null, 2), 'utf8');
  const count = Array.isArray(data) ? data.length : Object.keys(data).length;
  console.log(`  -> Copied: ${destPath} (${count} records)`);
}

// ── Main ──
const crawlDir = path.join(__dirname, '..', '..', '数据爬取');
const dataDir = path.join(__dirname, '..', 'data');

console.log('=== Fixing crawled data for 谨遵指令 ===\n');

fs.mkdirSync(dataDir, { recursive: true });

fixIdentities(path.join(crawlDir, 'identities.json'), path.join(dataDir, 'identities.json'));
copyValid(path.join(crawlDir, 'egos.json'), path.join(dataDir, 'egos.json'), 'egos');
fixRelics(path.join(crawlDir, 'relics.json'), path.join(dataDir, 'relics.json'));
copyValid(path.join(crawlDir, 'starlight.json'), path.join(dataDir, 'starlight.json'), 'starlight');
copyValid(path.join(crawlDir, 'cardpacks.json'), path.join(dataDir, 'cardpacks.json'), 'cardpacks');

console.log('\n✓ All data files prepared. Ready for "npm start".');
