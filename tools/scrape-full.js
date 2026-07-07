/**
 * scrape-full.js — E.G.O饰品完整爬虫 + 事件页爬取
 *
 * 用法: node tools/scrape-full.js
 *
 * 阶段1: 从饰品列表页爬取全部445件饰品（含图片/来源/强化描述/tag）
 * 阶段2: 对每个有来源事件的饰品，爬取事件页选项（含罪人判定）
 * 输出: data/accessories_raw.json + data/events_raw.json
 * 最终: 转换为 data/relics.json + data/events.json
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ── 配置 ──
const BASE = 'https://limbuscompany.huijiwiki.com';
const RELICS_URL = BASE + '/wiki/E.G.O%E9%A5%B0%E5%93%81';
const TOTAL_PAGES = 45;
const PAGE_DELAY = 2500;  // 翻页后等待 ms
const EVENT_DELAY = 1500;  // 事件页间等待 ms

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_ACCESSORIES = path.join(DATA_DIR, 'accessories_raw.json');
const OUT_EVENTS = path.join(DATA_DIR, 'events_raw.json');
const OUT_RELICS = path.join(DATA_DIR, 'relics.json');
const OUT_EVENTS_FINAL = path.join(DATA_DIR, 'events.json');

// ── 等级映射 ──
const TIER_MAP = {
  'MainUI_PersonalityList_4_18': 'I',
  'MainUI_PersonalityList_4_17': 'II',
  'MainUI_PersonalityList_4_16': 'III',
  'MainUI_PersonalityList_4_37': 'IV',
  'MainUI_PersonalityList_4_40': 'V',
};

// 强化等级图标映射
const ENHANCE_ICONS = {
  'MainUI_MirrorDungeon3_2_16': 0,  // 初始
  'MainUI_MirrorDungeon3_3_13': 1,  // 一级强化
  'MainUI_MirrorDungeon3_3_14': 2,  // 二级强化
};

// ── 罪孽属性标准色 ──
const SIN_COLORS = [
  { name: '暴怒', r: 160, g: 57,  b: 43  },
  { name: '色欲', r: 187, g: 82,  b: 31  },
  { name: '怠惰', r: 228, g: 136, b: 1   },
  { name: '暴食', r: 97,  g: 130, b: 43  },
  { name: '忧郁', r: 48,  g: 100, b: 113 },
  { name: '傲慢', r: 24,  g: 81,  b: 136 },
  { name: '嫉妒', r: 125, g: 78,  b: 148 },
];

function parseSin(styleAttr) {
  if (!styleAttr) return null;
  const hex = styleAttr.match(/#([0-9a-fA-F]{3,6})/);
  let r, g, b;
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    r = parseInt(h.slice(0,2), 16);
    g = parseInt(h.slice(2,4), 16);
    b = parseInt(h.slice(4,6), 16);
  } else {
    const m = styleAttr.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
    if (!m) return null;
    r = +m[1]; g = +m[2]; b = +m[3];
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return null;
  const s = (max - min) / max;
  if (s < 0.1) return null;
  let best = null, bestDist = Infinity;
  for (const sc of SIN_COLORS) {
    const dr = r - sc.r, dg = g - sc.g, db = b - sc.b;
    const dist = dr*dr + dg*dg + db*db;
    if (dist < bestDist) { bestDist = dist; best = sc; }
  }
  return best ? best.name : null;
}

// ── 工具 ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ══════════════════════════════════════════════════
//  阶段1: 提取单个饰品
// ══════════════════════════════════════════════════

/**
 * 从单个 table.wikitable DOM 元素提取饰品完整信息
 * @param {import('playwright').ElementHandle} tableEl
 * @returns {object|null}
 */
async function extractAccessory(tableEl) {
  try {
    // ── 名称 + 罪孽属性 ──
    const labelEl = await tableEl.$('span.label');
    if (!labelEl) return null;
    const name = (await labelEl.textContent()).trim();
    if (!name) return null;

    const labelStyle = (await labelEl.getAttribute('style')) || '';
    const sinAffinity = parseSin(labelStyle);

    // ── 等级 (从等级图片) ──
    let tier = null;
    const tierImg = await tableEl.$('img[src*="MainUI_PersonalityList"]');
    if (tierImg) {
      const src = (await tierImg.getAttribute('src')) || '';
      for (const [k, v] of Object.entries(TIER_MAP)) {
        if (src.includes(k)) { tier = v; break; }
      }
    }

    // ── 图片 (饰品图，取第一个60px的图或data-file-width最大的) ──
    let image = null;
    const allImgs = await tableEl.$$('img');
    for (const img of allImgs) {
      const src = (await img.getAttribute('src')) || '';
      const alt = (await img.getAttribute('alt')) || '';
      // 饰品图片通常在链接中，src含"饰品-"或"uploads"
      if (src.includes('饰品') && !src.includes('MainUI') && !src.includes('饰品边框')) {
        // 取原始尺寸URL（去掉thumb）
        image = src.replace(/\/thumb\//, '/').replace(/\/\d+px-[^/]+$/, '');
        break;
      }
    }
    // fallback: 找src含"饰品-"的
    if (!image) {
      for (const img of allImgs) {
        const src = (await img.getAttribute('src')) || '';
        if (src.includes('饰品-') && !src.includes('MainUI')) {
          image = src;
          break;
        }
      }
    }

    // ── 来源 (事件链接) ──
    let source = { type: 'none' };
    // 查找 name/title 标签中的链接
    const links = await tableEl.$$('a[title]');
    for (const link of links) {
      const title = (await link.getAttribute('title')) || '';
      const href = (await link.getAttribute('href')) || '';
      // 跳过自身图片链接、等级图片
      if (title.startsWith('事件-') && !title.includes('link={{{event}}}')) {
        source = {
          type: 'event',
          name: title,
          url: href,
        };
        break;
      }
    }

    // ── 效果标签 + 价格 ──
    const tagTd = await tableEl.$('td[style*="width:900px"]');
    let effect = '泛用';
    let price = null;
    if (tagTd) {
      const text = (await tagTd.textContent()) || '';
      // 效果: [镜像迷宫][烧伤]
      const m = text.match(/\[镜像迷宫\]\[([^\]]+)\]/);
      if (m) effect = m[1].trim();
      else {
        const m2 = text.match(/\[镜像迷宫\]/);
        if (m2) effect = '泛用';
      }
      // 价格
      const pm = text.match(/：(\d+)/);
      if (pm) price = parseInt(pm[1]);
    }

    // ── 强化等级 + 描述 ──
    const enhancement = { maxLevel: 0, levels: [] };

    // 检查是否有nav-tabs（强化等级tabs）
    const navLis = await tableEl.$$('ul.nav-tabs li');
    const tabPanes = await tableEl.$$('div.tab-pane');

    if (navLis.length > 0 && tabPanes.length > 0) {
      enhancement.maxLevel = tabPanes.length - 1;

      for (let i = 0; i < tabPanes.length; i++) {
        const pane = tabPanes[i];
        const html = await pane.innerHTML();
        const text = (await pane.textContent()).trim();

        // 提取内嵌tag（从huiji-tt或带颜色的链接中）
        const tags = [];
        const ttSpans = await pane.$$('span.huiji-tt');
        for (const span of ttSpans) {
          const params = (await span.getAttribute('data-params')) || '';
          if (params) tags.push(params.trim());
        }
        // 也可以从 <a> 的 title 提取
        const tagLinks = await pane.$$('a[title]');
        for (const a of tagLinks) {
          const title = (await a.getAttribute('title')) || '';
          const href = (await a.getAttribute('href')) || '';
          // 跳过图片链接
          if (title && !title.endsWith('.png') && href.includes('/wiki/')) {
            // 只添加不在已有列表中的
            if (!tags.includes(title)) tags.push(title);
          }
        }

        enhancement.levels.push({
          level: i,
          label: i === 0 ? '初始' : (i === 1 ? '一级强化' : '二级强化'),
          description: text,
          tags: [...new Set(tags)],
        });
      }
    } else {
      // 无强化tabs — 单条描述
      // 描述在第二个td中
      const tds = await tableEl.$$('td');
      let descText = '';
      for (const td of tds) {
        const align = (await td.getAttribute('align')) || '';
        const style = (await td.getAttribute('style')) || '';
        if (align === 'left' || style.includes('width:auto')) {
          descText = (await td.textContent()).trim();
          break;
        }
      }

      const tags = [];
      const tagLinks = await tableEl.$$('span.huiji-tt');
      for (const span of tagLinks) {
        const params = (await span.getAttribute('data-params')) || '';
        if (params) tags.push(params.trim());
      }

      enhancement.levels.push({
        level: 0,
        label: '初始',
        description: descText,
        tags: [...new Set(tags)],
      });
    }

    return {
      name,
      tier: tier || '未知',
      image,
      sinAffinity,
      effect,
      price,
      source,
      enhancement,
    };
  } catch (e) {
    console.warn('  ⚠ 提取失败:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════
//  阶段1: 翻页 + 提取全部饰品
// ══════════════════════════════════════════════════

async function scrapeAccessories(page) {
  console.log('🌐 导航到饰品页面...');
  await page.goto(RELICS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000); // 等异步卡片加载

  const all = [];
  const seen = new Set();

  for (let p = 1; p <= TOTAL_PAGES; p++) {
    if (p > 1) {
      // 点击翻页
      const ok = await navigateToPage(page, p);
      if (!ok) {
        console.error(`❌ 第${p}页翻页失败！已提取 ${all.length} 条。`);
        break;
      }
      await sleep(PAGE_DELAY);
    }

    // 提取当前页
    const tables = await page.$$('table.wikitable');
    let added = 0;
    for (const table of tables) {
      const data = await extractAccessory(table);
      if (data && !seen.has(data.name)) {
        seen.add(data.name);
        all.push(data);
        added++;
      }
    }

    const bar = '█'.repeat(Math.round(p / TOTAL_PAGES * 25)).padEnd(25, '░');
    console.log(`[${bar}] ${String(p).padStart(2)}/${TOTAL_PAGES} +${added} (${all.length})`);
  }

  return all;
}

/**
 * 点击翻页到目标页
 */
async function navigateToPage(page, targetPage) {
  for (let safety = 0; safety < 100; safety++) {
    const btns = await page.$$('.gs-paginator-page');
    if (btns.length === 0) return false;

    // 检查当前激活页
    let activePage = null;
    for (const btn of btns) {
      const cls = (await btn.getAttribute('class')) || '';
      if (cls.includes('active')) {
        activePage = parseInt((await btn.textContent()).trim());
        break;
      }
    }
    if (activePage === targetPage) return true;

    // 找目标按钮
    let targetBtn = null;
    for (const btn of btns) {
      const num = parseInt((await btn.textContent()).trim());
      if (num === targetPage) {
        const cls = (await btn.getAttribute('class')) || '';
        const disabled = await btn.getAttribute('disabled');
        if (!cls.includes('active') && !disabled) {
          targetBtn = btn;
          break;
        }
      }
    }

    if (targetBtn) {
      // 点击并等待内容变化
      const prevNames = new Set();
      const labels = await page.$$('span.label');
      for (const l of labels) prevNames.add((await l.textContent()).trim());

      await targetBtn.click();

      // 等新内容
      for (let i = 0; i < 40; i++) {
        await sleep(200);
        const curLabels = await page.$$('span.label');
        const curNames = new Set();
        for (const l of curLabels) curNames.add((await l.textContent()).trim());
        const newOnes = [...curNames].filter(n => !prevNames.has(n));
        if (newOnes.length > 0) return true;
      }
      return false;
    }

    // 目标不可见，推进窗口
    const visiblePages = [];
    for (const btn of btns) {
      visiblePages.push(parseInt((await btn.textContent()).trim()));
    }
    if (!visiblePages.length) return false;

    if (targetPage > Math.max(...visiblePages)) {
      // 点最右边的可见页推进
      const maxPage = Math.max(...visiblePages);
      let fwdBtn = null;
      for (const btn of btns) {
        if (parseInt((await btn.textContent()).trim()) === maxPage) {
          const cls = (await btn.getAttribute('class')) || '';
          if (!cls.includes('active')) { fwdBtn = btn; break; }
        }
      }
      if (!fwdBtn) return false;
      const prevNames = new Set();
      const labels = await page.$$('span.label');
      for (const l of labels) prevNames.add((await l.textContent()).trim());
      await fwdBtn.click();
      for (let i = 0; i < 40; i++) {
        await sleep(200);
        const curLabels = await page.$$('span.label');
        const curNames = new Set();
        for (const l of curLabels) curNames.add((await l.textContent()).trim());
        const newOnes = [...curNames].filter(n => !prevNames.has(n));
        if (newOnes.length > 0) break;
      }
      await sleep(500);
    } else if (targetPage < Math.min(...visiblePages)) {
      const minPage = Math.min(...visiblePages);
      let backBtn = null;
      for (const btn of btns) {
        if (parseInt((await btn.textContent()).trim()) === minPage) {
          const cls = (await btn.getAttribute('class')) || '';
          if (!cls.includes('active')) { backBtn = btn; break; }
        }
      }
      if (!backBtn) return false;
      const prevNames = new Set();
      const labels = await page.$$('span.label');
      for (const l of labels) prevNames.add((await l.textContent()).trim());
      await backBtn.click();
      for (let i = 0; i < 40; i++) {
        await sleep(200);
        const curLabels = await page.$$('span.label');
        const curNames = new Set();
        for (const l of curLabels) curNames.add((await l.textContent()).trim());
        const newOnes = [...curNames].filter(n => !prevNames.has(n));
        if (newOnes.length > 0) break;
      }
      await sleep(500);
    } else {
      return false;
    }
  }
  return false;
}

// ══════════════════════════════════════════════════
//  阶段2: 爬取事件页
// ══════════════════════════════════════════════════

/**
 * 爬取单个事件页面的选项
 * @param {import('playwright').Page} page
 * @param {string} eventUrl - 例如 "/wiki/事件-巫毒娃娃"
 * @returns {object}
 */
async function scrapeEventPage(page, eventUrl) {
  const url = BASE + eventUrl;
  console.log(`  📄 ${eventUrl}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(2000);

    // 事件名称
    const titleEl = await page.$('#firstHeading');
    const eventName = titleEl ? (await titleEl.textContent()).trim() : eventUrl.split('/wiki/')[1];

    // 查找选项tabs (nav-pills)
    const optionTabs = await page.$$('ul.nav-pills li');
    const optionPanes = await page.$$('div.tab-content > div.tab-pane');

    const options = [];

    if (optionTabs.length > 0 && optionPanes.length > 0) {
      for (let i = 0; i < optionPanes.length; i++) {
        const pane = optionPanes[i];
        const labelEl = await pane.$('span.label');
        const label = labelEl ? (await labelEl.textContent()).trim() : `选项${i + 1}`;
        const descText = (await pane.textContent()).trim();

        // 检查是否有罪人判定
        let check = null;
        // 罪人判定通常有关键词如"技能组"、"包含"、"不包含"、"友方单位"
        const hasSinnerCheck = /技能组|友方单位|罪人|包含.*技能|体力| sanity|SP/i.test(descText);

        if (hasSinnerCheck) {
          // 尝试提取判定条件
          // 常见模式："技能组不包含X属性的友方单位失去Y点体力"
          //        "技能组内包含X属性攻击技能的友方单位恢复Y点体力"
          let condition = '';
          let pass = '';
          let fail = '';

          // 尝试匹配条件
          const condMatch = descText.match(/技能组[^。]*?(包含|不包含)[^。]*?的友方单位/);
          if (condMatch) {
            condition = condMatch[0].trim();
          }

          // 尝试匹配失败结果（通常在前半部分）
          const failMatch = descText.match(/失去(\d+)点体力/);
          const passMatch = descText.match(/恢复(\d+)点体力/);

          if (failMatch) fail = `失去${failMatch[1]}点体力`;
          if (passMatch) pass = `恢复${passMatch[1]}点体力`;

          // 也检测 sanity/SP
          const spFailMatch = descText.match(/失去(\d+)点理智值/);
          const spPassMatch = descText.match(/恢复(\d+)点理智值/);
          if (spFailMatch) fail = `失去${spFailMatch[1]}点理智值`;
          if (spPassMatch) pass = `恢复${spPassMatch[1]}点理智值`;

          if (condition || pass || fail) {
            check = {
              type: 'sinner',
              condition: condition || descText.substring(0, 100),
              pass: pass || '',
              fail: fail || '',
            };
          }
        }

        // 检查是否有饰品奖励
        let reward = null;
        const rewardLink = await pane.$('a.image img[alt*="饰品"]');
        if (rewardLink) {
          const alt = (await rewardLink.getAttribute('alt')) || '';
          reward = alt.replace('饰品-', '').replace('.png', '');
        }

        options.push({
          label,
          description: descText,
          check,
          reward,
        });
      }
    }

    return {
      id: 'event-' + eventUrl.split('/wiki/')[1].replace(/[^\w一-鿿]/g, '_'),
      name: eventName,
      url: eventUrl,
      options,
    };
  } catch (e) {
    console.warn(`  ⚠ 事件页爬取失败: ${e.message}`);
    return {
      id: 'event-' + eventUrl.split('/wiki/')[1].replace(/[^\w一-鿿]/g, '_'),
      name: eventUrl,
      url: eventUrl,
      options: [],
      error: e.message,
    };
  }
}

// ══════════════════════════════════════════════════
//  主流程
// ══════════════════════════════════════════════════

(async function main() {
  console.log('╔══════════════════════════════════╗');
  console.log('║  E.G.O 饰品完整爬虫 v6         ║');
  console.log('╚══════════════════════════════════╝\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    locale: 'zh-CN',
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    // ═══ 阶段1: 爬取饰品 ═══
    console.log('── 阶段1: 爬取饰品列表 ──\n');
    const accessories = await scrapeAccessories(page);

    // 保存
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(OUT_ACCESSORIES, JSON.stringify(accessories, null, 2), 'utf8');
    console.log(`\n✅ 阶段1完成: ${accessories.length} 条饰品 → ${OUT_ACCESSORIES}`);

    // 统计
    const stats = { tier: {}, sin: {}, effect: {}, source: { event: 0, none: 0 }, enhanceLevel: { 0: 0, 1: 0, 2: 0 } };
    for (const a of accessories) {
      stats.tier[a.tier] = (stats.tier[a.tier] || 0) + 1;
      if (a.sinAffinity) stats.sin[a.sinAffinity] = (stats.sin[a.sinAffinity] || 0) + 1;
      stats.effect[a.effect] = (stats.effect[a.effect] || 0) + 1;
      if (a.source && a.source.type === 'event') stats.source.event++;
      else stats.source.none++;
      stats.enhanceLevel[a.enhancement.maxLevel] = (stats.enhanceLevel[a.enhancement.maxLevel] || 0) + 1;
    }
    console.log('\n📊 统计:');
    console.log('  等级:', Object.entries(stats.tier).sort().map(([k,v]) => `${k}:${v}`).join(', '));
    console.log('  罪孽:', Object.entries(stats.sin).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k}:${v}`).join(', '));
    console.log('  效果:', Object.entries(stats.effect).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v]) => `${k}:${v}`).join(', '));
    console.log('  来源: 事件=' + stats.source.event + ', 无=' + stats.source.none);
    console.log('  强化: maxLevel=0:' + stats.enhanceLevel[0] + ', 1:' + stats.enhanceLevel[1] + ', 2:' + stats.enhanceLevel[2]);

    // ═══ 阶段2: 爬取事件 ═══
    console.log('\n── 阶段2: 爬取事件页 ──\n');

    // 收集所有唯一事件URL
    const eventUrls = new Set();
    for (const a of accessories) {
      if (a.source && a.source.type === 'event' && a.source.url) {
        eventUrls.add(a.source.url);
      }
    }
    console.log(`共 ${eventUrls.size} 个唯一事件\n`);

    const events = [];
    let ei = 0;
    for (const eventUrl of eventUrls) {
      ei++;
      process.stdout.write(`[${ei}/${eventUrls.size}] `);
      const eventData = await scrapeEventPage(page, eventUrl);
      events.push(eventData);
      await sleep(EVENT_DELAY);
    }

    fs.writeFileSync(OUT_EVENTS, JSON.stringify(events, null, 2), 'utf8');
    console.log(`\n✅ 阶段2完成: ${events.length} 个事件 → ${OUT_EVENTS}`);

    // ═══ 最终转换: 写入 relics.json ═══
    console.log('\n── 最终转换: 生成 relics.json ──');
    const { convertToRelics } = require('./convert-full');
    const relics = convertToRelics(accessories, events);
    fs.writeFileSync(OUT_RELICS, JSON.stringify(relics, null, 2), 'utf8');
    console.log(`✅ relics.json: ${relics.length} 条 → ${OUT_RELICS}`);

    fs.writeFileSync(OUT_EVENTS_FINAL, JSON.stringify(events, null, 2), 'utf8');
    console.log(`✅ events.json: ${events.length} 个 → ${OUT_EVENTS_FINAL}`);

  } catch (e) {
    console.error('\n❌ 爬取出错:', e.message);
    console.error(e.stack);
  } finally {
    await browser.close();
  }

  console.log('\n🎉 全部完成！');
})();
