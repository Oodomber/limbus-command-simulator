/* ============================================================
   灰机 wiki「E.G.O饰品」页 —— 结构探针 v2（针对表格）
   第一轮结果：这页正文是一张 570 行的表格（`.mw-parser-output table tr` = 570），
   但独立文字里找不到等级罗马数字，所以需要再看表格内部结构。

   用法：在饰品页 F12 → Console，整段粘贴，回车，把打印的 JSON 贴回来。
   ============================================================ */
(() => {
  const out = { tables: [], rowSamples: [], classFreq: {}, giftSamples: [] };

  // 1. 所有表格按行数排序，列出前 3 张的概况
  const tables = [...document.querySelectorAll('table')]
    .map((t, i) => ({ i, rows: t.querySelectorAll('tr').length, cls: t.className || '' }))
    .sort((a, b) => b.rows - a.rows)
    .slice(0, 3);
  out.tables = tables;

  const main = tables.length ? document.querySelectorAll('table')[tables[0].i] : null;
  if (main) {
    // 2. 单元格 class 频次（判断有没有统一的卡片结构）
    const freq = {};
    for (const td of main.querySelectorAll('td,th')) {
      const c = (td.className || td.tagName).trim() || td.tagName;
      freq[c] = (freq[c] || 0) + 1;
    }
    out.classFreq = Object.fromEntries(
      Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12)
    );

    // 3. 前 3 个「带图的行」的 HTML（截断，够看结构）
    const rows = [...main.querySelectorAll('tr')].filter((r) => r.querySelector('img'));
    out.rowsWithImg = rows.length;
    out.rowSamples = rows.slice(0, 3).map((r) => r.outerHTML.replace(/\s+/g, ' ').slice(0, 1200));

    // 4. 行内文字，看看一条记录长什么样
    out.rowTexts = rows.slice(0, 6).map((r) => (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160));
  }

  // 5. 带 gift 字样的元素长什么样
  const gifts = [...document.querySelectorAll('[class*="gift"]')].slice(0, 5);
  out.giftSamples = gifts.map((el) => ({
    cls: el.className,
    tag: el.tagName,
    text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    imgs: el.querySelectorAll('img').length,
  }));

  console.log(JSON.stringify(out, null, 2));
  console.log('把上面这段 JSON 复制给我。');
})();
