/**
 * convert-full.js — 将爬取的原始饰品+事件数据转换为标准 relics.json 格式
 *
 * 用法: 由 scrape-full.js 调用，或单独: node tools/convert-full.js
 */

const fs = require('fs');
const path = require('path');

// ── 拼音映射（与 Python crawler_utils._simple_pinyin 同步） ──
const CHAR_MAP = {
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
  "侍":"shi","从":"cong",
  "冻":"dong","结":"jie","泪":"lei",
  "破":"po","片":"pian",
  "荆":"jing","棘":"ji",
  "骨":"gu","灰":"hui","瓶":"ping",
  "残":"can","影":"ying",
  "电":"dian","流":"liu",
  "回":"hui","忆":"yi",
  "白":"bai","夜":"ye",
  "幸":"xing","运":"yun","币":"bi",
  "决":"jue","斗":"dou",
  "战":"zhan","斧":"fu",
  "龙":"long","息":"xi",
  "永":"yong","恒":"heng",
  "第":"di","四":"si","魔":"mo","法":"fa",
  "老":"lao","旧":"jiu","日":"ri","历":"li",
  "忠":"zhong","诚":"cheng",
  "触":"chu","手":"shou",
  "剥":"bo","皮":"pi",
  "圣":"sheng","杯":"bei",
  "王":"wang","冠":"guan",
  "月":"yue","亮":"liang",
  "石":"shi","头":"tou",
  "太":"tai","阳":"yang",
  "世":"shi","界":"jie",
  "眼":"yan","球":"qiu",
  "深":"shen","渊":"yuan",
  "翅":"chi","膀":"bang",
  "脑":"nao","叶":"ye",
  "心":"xin","脏":"zang",
  "玫":"mei","瑰":"gui",
  "螺":"luo","旋":"xuan",
  "蜡":"la","烛":"zhu",
  "刀":"dao","锋":"feng",
  "傀":"kui","儡":"lei",
  "针":"zhen","线":"xian",
  "锁":"suo","链":"lian",
  "铃":"ling","铛":"dang",
  "戒":"jie","指":"zhi",
  "项":"xiang","圈":"quan",
  "面":"mian","具":"ju",
  "斗":"dou","篷":"peng",
  "靴":"xue","子":"zi",
  "手":"shou","套":"tao",
  "腰":"yao","带":"dai",
  "头":"tou","盔":"kui",
  "披":"pi","风":"feng",
  "项":"xiang","饰":"shi",
  "符":"fu","文":"wen",
  "药":"yao","水":"shui",
  "卷":"juan","轴":"zhou",
  "水":"shui","晶":"jing",
  "宝":"bao","石":"shi",
  "护":"hu","符":"fu",
  "徽":"hui","章":"zhang",
  "旗":"qi","帜":"zhi",
  "号":"hao","角":"jiao",
  "时":"shi","计":"ji",
  "罗":"luo","盘":"pan",
  "地":"di","图":"tu",
  "钥":"yao","匙":"chi",
  "天":"tian","平":"ping",
  "沙":"sha","漏":"lou",
  "怀":"huai","表":"biao",
  "音":"yin","叉":"cha",
  "乐":"yue","谱":"pu",
  "画":"hua","笔":"bi",
  "调":"diao","色":"se",
  "颜":"yan","料":"liao",
  "食":"shi","物":"wu",
  "饮":"yin","品":"pin",
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
    } else if (ch === ' ' || ch === '-' || ch === '–' || ch === '·') {
      result.push('_');
    } else if (ch.codePointAt(0) > 127) {
      result.push('c' + ch.codePointAt(0).toString(16));
    }
  }
  return result.join('').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function generateRelicId(name) {
  return simplePinyin(name);
}

/**
 * 转换爬取数据为标准relics.json格式
 * @param {Array} accessories - 爬取的饰品原始数据
 * @param {Array} events - 爬取的事件数据
 * @returns {Array} 标准格式的relics数组
 */
function convertToRelics(accessories, events) {
  if (!Array.isArray(accessories)) return [];

  // 建立事件URL→事件数据映射
  const eventMap = {};
  if (Array.isArray(events)) {
    for (const ev of events) {
      eventMap[ev.url] = ev;
    }
  }

  return accessories.map(a => {
    // ID: 复用旧ID或生成新ID
    const id = generateRelicId(a.name);

    // Tags: 保持旧格式兼容
    const tags = {
      effect: [a.effect || '泛用'],
      sinAffinity: a.sinAffinity ? [a.sinAffinity] : [],
    };

    // Source
    const source = a.source || { type: 'none' };

    // Enhancement: 清理描述中的HTML标签
    const enhancement = {
      maxLevel: a.enhancement ? a.enhancement.maxLevel : 0,
      levels: (a.enhancement && a.enhancement.levels)
        ? a.enhancement.levels.map(l => ({
            level: l.level,
            label: l.label,
            description: l.description,
            tags: l.tags || [],
          }))
        : [{ level: 0, label: '初始', description: '', tags: [] }],
    };

    return {
      id,
      name: a.name,
      tier: a.tier || '未知',
      image: a.image || null,
      tags,
      price: a.price !== undefined ? a.price : null,
      acquisition: a.acquisition || null,
      source: {
        type: source.type,
        name: source.name || null,
        url: source.url || null,
      },
      enhancement,
    };
  });
}

// ── CLI: 独立运行 ──
if (require.main === module) {
  const dataDir = path.join(__dirname, '..', 'data');
  const rawPath = path.join(dataDir, 'accessories_raw.json');
  const eventsPath = path.join(dataDir, 'events_raw.json');
  const outPath = path.join(dataDir, 'relics.json');
  const eventsOutPath = path.join(dataDir, 'events.json');

  if (!fs.existsSync(rawPath)) {
    console.error('❌ accessories_raw.json 不存在，请先运行 scrape-full.js');
    process.exit(1);
  }

  const accessoriesRaw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  // 兼容两种格式：直接数组 或 { accessories: [...] } wrapper
  const accessories = Array.isArray(accessoriesRaw) ? accessoriesRaw : (accessoriesRaw.accessories || []);
  const eventsRaw = fs.existsSync(eventsPath) ? JSON.parse(fs.readFileSync(eventsPath, 'utf8')) : [];
  // 兼容两种格式：直接数组 或 { scrapedAt, total, events: [...] } wrapper
  const events = Array.isArray(eventsRaw) ? eventsRaw : (eventsRaw.events || []);

  const relics = convertToRelics(accessories, events);
  fs.writeFileSync(outPath, JSON.stringify(relics, null, 2), 'utf8');
  console.log(`✅ relics.json: ${relics.length} 条 → ${outPath}`);

  if (events.length > 0) {
    // 写入纯净数组到 events.json
    fs.writeFileSync(eventsOutPath, JSON.stringify(events, null, 2), 'utf8');
    console.log(`✅ events.json: ${events.length} 个 → ${eventsOutPath}`);
  }

  // 统计
  console.log('\n📊 统计:');
  const st = { tier: {}, sin: {}, effect: {}, sourceEvent: 0, sourceNone: 0, enhance0: 0, enhance1: 0, enhance2: 0 };
  for (const r of relics) {
    st.tier[r.tier] = (st.tier[r.tier] || 0) + 1;
    for (const s of r.tags.sinAffinity) st.sin[s] = (st.sin[s] || 0) + 1;
    for (const e of r.tags.effect) st.effect[e] = (st.effect[e] || 0) + 1;
    if (r.source.type === 'event') st.sourceEvent++; else st.sourceNone++;
    if (r.enhancement.maxLevel === 0) st.enhance0++;
    else if (r.enhancement.maxLevel === 1) st.enhance1++;
    else st.enhance2++;
  }
  console.log('  等级:', Object.entries(st.tier).sort().map(([k,v])=>`${k}:${v}`).join(', '));
  console.log('  罪孽:', Object.entries(st.sin).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(', '));
  console.log('  来源: 事件=' + st.sourceEvent + ', 无=' + st.sourceNone);
  console.log('  强化: 0级=' + st.enhance0 + ', 1级=' + st.enhance1 + ', 2级=' + st.enhance2);
}

module.exports = { convertToRelics, generateRelicId };
