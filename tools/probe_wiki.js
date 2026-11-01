/**
 * probe_wiki.js — 只读探针：确认辉机 wiki 现在还能不能抓、页面结构有没有变
 *
 * 用法: node tools/probe_wiki.js
 * 不做任何写入，只打印能不能拿到内容 + 几个关键计数。
 */
const { chromium } = require('playwright');

const BASE = 'https://limbuscompany.huijiwiki.com';
const PAGES = [
  { name: '饰品列表', url: BASE + '/wiki/E.G.O%E9%A5%B0%E5%93%81' },
  { name: '事件列表', url: BASE + '/wiki/%E4%BA%8B%E4%BB%B6' },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1000 },
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();

  for (const p of PAGES) {
    try {
      const resp = await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);
      const info = await page.evaluate(() => {
        const t = document.title || '';
        const txt = document.body ? document.body.innerText : '';
        return {
          title: t,
          textLen: txt.length,
          head: txt.slice(0, 160).replace(/\s+/g, ' '),
          imgs: document.querySelectorAll('img').length,
          links: document.querySelectorAll('a').length,
          // 分页控件：wiki 常见 .pagination / .pager
          pager: document.querySelectorAll('.pagination, .pager, [class*="pagination"], [class*="pager"]').length,
        };
      });
      console.log(`[${p.name}] status=${resp ? resp.status() : '?'} title=${info.title}`);
      console.log(`  textLen=${info.textLen} imgs=${info.imgs} links=${info.links} pagerNodes=${info.pager}`);
      console.log(`  head=${info.head}`);
    } catch (e) {
      console.log(`[${p.name}] 失败: ${e.message.split('\n')[0]}`);
    }
  }

  await browser.close();
})();
