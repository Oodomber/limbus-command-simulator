/* ============================================================
   灰机 wiki「E.G.O饰品」页 —— 把整张表格原样导出成文件
   （上一轮 JSON 在控制台里被刷屏截断了，这次直接下载文件，不用你复制粘贴）

   用法：
   1. 打开 https://limbuscompany.huijiwiki.com/wiki/E.G.O饰品
   2. F12 → Console，整段粘贴本文件内容，回车
   3. 浏览器会下载一个 relics-table.html，把它放到 D:\Projects\谨遵指令 目录下
   ============================================================ */
(() => {
  // 找行数最多的那张表
  const tables = [...document.querySelectorAll('table')];
  let best = null;
  let bestRows = 0;
  for (const t of tables) {
    const n = t.querySelectorAll('tr').length;
    if (n > bestRows) {
      bestRows = n;
      best = t;
    }
  }
  if (!best) {
    console.error('没找到表格，可能页面还没渲染完，等几秒再试');
    return;
  }

  const html =
    '<!doctype html><meta charset="utf-8"><title>relics-table</title>\n' +
    '<!-- rows: ' + bestRows + ' -->\n' +
    best.outerHTML;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'relics-table.html';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);

  console.log('已触发下载 relics-table.html，行数 =', bestRows, '，大小约', Math.round(html.length / 1024), 'KB');
  console.log('把文件放到 D:\\Projects\\谨遵指令 目录下，然后告诉我一声。');
})();
