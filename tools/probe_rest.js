/**
 * probe_rest.js — 摸清「饰品 / 事件 / 卡包」这三类在 wiki 上的取数入口
 *
 * 用法: node tools/probe_rest.js
 * 只读，只打印。
 */
const { chromium } = require('playwright');

const BASE = 'https://limbuscompany.huijiwiki.com';

const CARGO_TRIES = ['Gift', 'Relic', 'EgoGift', 'Event', 'Cardpack', 'ThemePack', 'Pack'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/wiki/E.G.O%E9%A5%B0%E5%93%81', { waitUntil: 'domcontentloaded', timeout: 45000 });

  const api = async (q) => page.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'include' });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200) }; }
  }, BASE + '/api.php?' + q);

  console.log('=== Cargo 表试探 ===');
  for (const t of CARGO_TRIES) {
    const j = await api('action=cargoquery&tables=' + encodeURIComponent(t) + '&fields=_pageName&limit=2&format=json');
    if (j && j.cargoquery) {
      console.log(`  ${t}: OK，${JSON.stringify(j.cargoquery).slice(0, 160)}`);
    } else {
      console.log(`  ${t}: ${JSON.stringify(j).slice(0, 110)}`);
    }
  }

  console.log('\n=== 标题里带关键词的页面 ===');
  for (const kw of ['探索事件', '卡包']) {
    const j = await api('action=query&list=search&srsearch=' + encodeURIComponent('intitle:' + kw) + '&srlimit=6&format=json');
    const hits = (j?.query?.search || []).map((x) => x.title);
    console.log(`  ${kw}: ${hits.join(' / ') || '无'}`);
  }

  console.log('\n=== 探索事件 页面结构 ===');
  const j2 = await api('action=parse&page=' + encodeURIComponent('探索事件') + '&prop=wikitext&format=json&formatversion=2');
  const wt = j2?.parse?.wikitext;
  if (wt) {
    console.log(`  wikitext ${wt.length} 字符`);
    console.log('  头 300:', wt.replace(/\s+/g, ' ').slice(0, 300));
    const tpl = [...wt.matchAll(/\{\{\s*([^|}]+)/g)].map((m) => m[1].trim());
    const uniq = [...new Set(tpl)];
    console.log('  用到的模板:', uniq.slice(0, 12).join(', '));
  } else {
    console.log('  取不到:', JSON.stringify(j2).slice(0, 200));
  }

  await browser.close();
})();
