/**
 * probe_cat.js — 摸清四类数据在 wiki 上怎么取：分类成员？还是列表页表格？
 *
 * 用法: node tools/probe_cat.js
 */
const { chromium } = require('playwright');

const BASE = 'https://limbuscompany.huijiwiki.com';

const CATS = ['人格', 'E.G.O饰品', '主题卡包', '事件', 'E.G.O', '罪人'];
const PAGES = ['人格', 'E.G.O饰品', '主题卡包'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/wiki/E.G.O%E9%A5%B0%E5%93%81', { waitUntil: 'domcontentloaded', timeout: 45000 });

  const api = async (path) => page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; }
  }, BASE + path);

  console.log('=== 分类成员 ===');
  for (const c of CATS) {
    const j = await api('/api.php?action=query&list=categorymembers&cmtitle=' +
      encodeURIComponent('Category:' + c) + '&cmlimit=500&format=json');
    const members = j?.query?.categorymembers;
    if (members) {
      console.log(`  ${c}: ${members.length} 个成员，例: ${members.slice(0, 3).map(m => m.title).join(' / ')}`);
    } else {
      console.log(`  ${c}: 无（${JSON.stringify(j).slice(0, 120)}）`);
    }
  }

  console.log('\n=== 列表页 wikitext 规模 ===');
  for (const p of PAGES) {
    const j = await api('/api.php?action=parse&page=' + encodeURIComponent(p) +
      '&prop=wikitext&format=json&formatversion=2');
    const wt = j?.parse?.wikitext;
    if (wt) {
      console.log(`  ${p}: wikitext ${wt.length} 字符`);
      console.log('    头 260:', wt.replace(/\s+/g, ' ').slice(0, 260));
    } else {
      console.log(`  ${p}: 无（${JSON.stringify(j).slice(0, 160)}）`);
    }
  }

  await browser.close();
})();
