/**
 * probe_api.js — 探查灰机 wiki 的 MediaWiki / Cargo API 能不能直接用
 *
 * 用法: node tools/probe_api.js
 *
 * 普通 HTTP 请求被 403 挡，但 Playwright 里的 fetch 带着浏览器的 cookie/UA，
 * 通常能打通。能打通的话，抓数据就不该再去解析 DOM —— 直接要 JSON。
 */
const { chromium } = require('playwright');

const BASE = 'https://limbuscompany.huijiwiki.com';

const QUERIES = [
  {
    name: 'siteinfo',
    api: '/api.php?action=query&meta=siteinfo&siprop=general%7Cstatistics&format=json',
  },
  {
    name: '搜索「事件」页面',
    api: '/api.php?action=query&list=search&srsearch=' + encodeURIComponent('事件') + '&srlimit=8&format=json',
  },
  {
    name: '搜索「主题卡包」页面',
    api: '/api.php?action=query&list=search&srsearch=' + encodeURIComponent('主题卡包') + '&srlimit=8&format=json',
  },
  {
    name: '搜索「人格」页面',
    api: '/api.php?action=query&list=search&srsearch=' + encodeURIComponent('人格') + '&srlimit=8&format=json',
  },
  {
    name: 'Cargo 表清单（试探）',
    api: '/api.php?action=cargoquery&tables=_pageData&fields=_pageName&limit=1&format=json',
  },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1400, height: 900 },
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();

  // 先正常打开一次站点，把 cookie 拿到
  try {
    await page.goto(BASE + '/wiki/E.G.O%E9%A5%B0%E5%93%81', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    console.log('[热身] 站点已打开:', await page.title());
  } catch (e) {
    console.log('[热身] 失败:', e.message.split('\n')[0]);
  }

  for (const q of QUERIES) {
    const out = await page.evaluate(async (url) => {
      try {
        const r = await fetch(url, { credentials: 'include' });
        const txt = await r.text();
        return { status: r.status, len: txt.length, body: txt.slice(0, 700) };
      } catch (e) {
        return { status: 0, len: 0, body: 'ERR ' + e.message };
      }
    }, BASE + q.api);

    console.log(`\n[${q.name}] status=${out.status} len=${out.len}`);
    // 只抽关键字段，避免整段 HTML 刷屏
    try {
      const j = JSON.parse(out.body + (out.len > 700 ? '' : ''));
      console.log('  JSON keys:', Object.keys(j).join(','));
    } catch {
      console.log('  body:', out.body.replace(/\s+/g, ' ').slice(0, 400));
    }
  }

  await browser.close();
})();
