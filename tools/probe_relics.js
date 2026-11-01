/**
 * 探「E.G.O饰品」页的取数入口：
 * 这个页面的正文由前端筛选模块动态渲染，wikitext 里拿不到完整列表，
 * 所以这里直接在渲染后的 DOM 上数一数有哪些可用的容器。
 *
 * 只打印统计与少量样本，不写文件。
 */

const { chromium } = require('playwright');

const URL = 'https://limbuscompany.huijiwiki.com/wiki/E.G.O%E9%A5%B0%E5%93%81';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('status', resp && resp.status());

  // 等筛选模块把内容渲染出来
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    const out = { counts: {}, samples: {} };
    const sel = {
      'img.gift-img': 'img',
      '.gift-card': '*',
      '.gift': '*',
      '.filter-item': '*',
      '.card': '*',
      'table tr': 'tr',
      '.mw-parser-output a': 'a',
      '[data-id]': '*',
    };
    for (const [name, tag] of Object.entries(sel)) {
      try {
        out.counts[name] = document.querySelectorAll(name).length;
      } catch (e) {
        out.counts[name] = -1;
      }
    }
    // 正文区里所有链接文本（去重）样本
    const links = [...document.querySelectorAll('.mw-parser-output a')]
      .map((a) => (a.textContent || '').trim())
      .filter((t) => t && t.length <= 24);
    out.samples.links = [...new Set(links)].slice(0, 30);
    out.samples.linkTotal = links.length;
    // 看看有没有按等级分的区块
    const heads = [...document.querySelectorAll('h2, h3')].map((h) => (h.textContent || '').trim()).filter(Boolean);
    out.samples.heads = heads.slice(0, 20);
    return out;
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
