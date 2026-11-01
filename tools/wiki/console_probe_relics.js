/* ============================================================
   灰机 wiki「E.G.O饰品」页 —— 结构探针
   在你的浏览器里打开饰品页，按 F12 打开控制台，整段粘贴这个文件的内容，回车。
   它只读 DOM、不改页面，最后会打印一段 JSON。把 JSON 贴回来给我。

   为什么要你跑：wiki 现在对自动化访问返回 403 安全验证，
   我这边（Playwright）拿不到渲染后的内容，只能借用你的浏览器会话。
   ============================================================ */
(() => {
  const report = {
    title: document.title,
    url: location.href,
    counts: {},
    samples: {},
    guesses: [],
  };

  // 1. 常见容器选择器，数一数谁有内容
  const candidates = [
    '.mw-parser-output a',
    '.mw-parser-output img',
    '.mw-parser-output table tr',
    '.gift-card',
    '.gift',
    '.filter-item',
    '.card',
    '[data-id]',
    '[class*="gift"]',
    '[class*="item"]',
    '[class*="card"]',
    'li',
  ];
  for (const sel of candidates) {
    try {
      report.counts[sel] = document.querySelectorAll(sel).length;
    } catch (e) {
      report.counts[sel] = -1;
    }
  }

  // 2. 页面标题区块
  report.samples.heads = [...document.querySelectorAll('h1,h2,h3')]
    .map((h) => (h.textContent || '').trim())
    .filter(Boolean)
    .slice(0, 25);

  // 3. 正文里最像「一堆条目」的那个容器的直接子元素
  const roots = [
    '.mw-parser-output',
    '.mw-parser-output > div',
    'main',
    '#mw-content-text',
  ];
  for (const sel of roots) {
    const root = document.querySelector(sel);
    if (!root) continue;
    const kids = [...root.children];
    const biggest = kids
      .map((el) => ({ el, n: el.children.length }))
      .sort((a, b) => b.n - a.n)[0];
    if (biggest && biggest.n > 20) {
      report.guesses.push({
        root: sel,
        childCount: biggest.n,
        childClass: biggest.el.className,
        firstChildHTML: biggest.el.innerHTML.slice(0, 600),
      });
    }
  }

  // 4. 找带「等级 / I~V」字样的重复结构，饰品卡片通常有
  const levelWords = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'I', 'II', 'III', 'IV', 'V'];
  report.samples.levelHits = [];
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim();
    if (t.length <= 3 && levelWords.includes(t) && el.children.length === 0) {
      report.samples.levelHits.push(el.className || el.tagName);
      if (report.samples.levelHits.length >= 15) break;
    }
  }

  console.log(JSON.stringify(report, null, 2));
  console.log('把上面这段 JSON 复制给我。');
})();
