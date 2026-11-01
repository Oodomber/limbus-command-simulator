/**
 * 解析从灰机 wiki「E.G.O饰品」页导出的 HTML，和本地 data/relics.json 做差异对比。
 *
 * 输入：浏览器控制台导出的 relics-table.html（那张 570 行的表）
 *      —— 也兼容整页 HTML（只要里面含 <table>）
 *
 * 输出：reports/relic-diff.md
 *
 * 用法：node tools/import_relic_table.js [html路径]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HTML = process.argv[2] || path.resolve(ROOT, '..', 'relics-table.html');
const LOCAL = path.join(ROOT, 'data', 'relics.json');
const OUT = path.join(ROOT, 'reports', 'relic-diff.md');

function decode(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    // 清掉 wiki 模板噪音：{{状态2|烧伤|4=负面}} -> 烧伤
    .replace(/\{\{状态2\|([^|}]+)[^}]*\}\}/g, '$1')
    .replace(/\{\{([^|}]+)\|[^}]*\}\}/g, '$1')
    .replace(/\{\{([^}]+)\}\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRows(html) {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const out = [];
  for (const r of rows) {
    const cells = [...r.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
    if (cells.length < 4) continue;
    const name = decode(cells[0]);
    if (!name || name === '名称') continue;
    out.push({
      name,
      effect: decode(cells[1]),
      pack: decode(cells[2]),
      where: decode(cells[3]),
    });
  }
  return out;
}

function bigrams(t) {
  const s = new Set();
  for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2));
  return s;
}

function sim(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

function main() {
  if (!fs.existsSync(HTML)) {
    console.error('找不到 HTML 文件：' + HTML);
    process.exit(1);
  }
  const html = fs.readFileSync(HTML, 'utf8');
  const rows = parseRows(html);
  const wikiNames = [...new Set(rows.map((r) => r.name))];
  const local = JSON.parse(fs.readFileSync(LOCAL, 'utf8'));
  const localNames = local.map((r) => r.name);
  const localSet = new Set(localNames);

  const wikiOnly = wikiNames.filter((n) => !localSet.has(n));
  const localOnly = localNames.filter((n) => !wikiNames.includes(n));

  const byName = new Map(rows.map((r) => [r.name, r]));
  const classified = wikiOnly.map((n) => {
    let best = null;
    let bs = 0;
    for (const l of localNames) {
      const v = sim(n, l);
      if (v > bs) {
        bs = v;
        best = l;
      }
    }
    return { name: n, row: byName.get(n), best, score: bs };
  });
  const renames = classified.filter((c) => c.score >= 0.5);
  const additions = classified.filter((c) => c.score < 0.5);

  // 这个软件是「镜牢」助手，只有能在镜像迷宫里出现的饰品才需要补。
  // 判定：出现地点含「镜像迷宫」，或出现地点就是某个主题卡包名。
  let packNames = new Set();
  try {
    const packs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cardpacks.json'), 'utf8'));
    packNames = new Set(packs.map((p) => p.name));
  } catch (e) {
    /* 没有卡包数据就只按「镜像迷宫」判定 */
  }
  const isDungeon = (r) => {
    const where = (r && r.where) || '';
    if (where.includes('镜像迷宫')) return true;
    for (const p of packNames) if (p && where.includes(p)) return true;
    return false;
  };
  const dungeonAdds = additions.filter((a) => isDungeon(a.row));
  const storyAdds = additions.filter((a) => !isDungeon(a.row));

  const L = [];
  L.push('# 饰品差异报告（wiki ↔ 本地）');
  L.push('');
  L.push(`- 数据源：\`${path.relative(ROOT, HTML)}\`（该页那张 570 行的表，只有 4 列：名称 / 未升级效果 / 特定卡包 / 出现地点）`);
  L.push(`- wiki 行数 **${rows.length}**，去重名称 **${wikiNames.length}**`);
  L.push(`- 本地 \`data/relics.json\` **${local.length}** 条`);
  L.push(`- 名称能对上 **${wikiNames.length - wikiOnly.length}** 条 / wiki 独有 **${wikiOnly.length}** / 本地独有 **${localOnly.length}**`);
  L.push('');
  L.push('> 注意：这张表**没有**图标、等级（I~V）、罪孽属性、价格、强化效果，');
  L.push('> 所以只能用来核「名称 + 未升级效果 + 出现章节」，补全条目还需要那页「E.G.O饰品筛选」区块的 HTML。');
  L.push('');

  L.push(`## 一、疑似改名（${renames.length} 条，字符相似度 ≥ 0.5）`);
  L.push('');
  L.push('| wiki 上的名字 | 本地最像的 | 相似度 | 本地 id |');
  L.push('| --- | --- | --- | --- |');
  for (const r of renames) {
    const loc = local.find((x) => x.name === r.best);
    L.push(`| ${r.name} | ${r.best} | ${r.score.toFixed(2)} | \`${loc ? loc.id : ''}\` |`);
  }
  L.push('');

  L.push(`## 二、wiki 有、本地没有（${additions.length} 条）`);
  L.push('');
  L.push(`其中**镜牢相关 ${dungeonAdds.length} 条**（真正要补的），剧情模式 ${storyAdds.length} 条（本软件用不上）。`);
  L.push('');
  L.push(`### 2.1 镜牢相关（要补）—— ${dungeonAdds.length} 条`);
  L.push('');
  if (dungeonAdds.length === 0) L.push('（无）');
  else {
    L.push('| 名称 | 出现地点 | 特定卡包 | 未升级效果 |');
    L.push('| --- | --- | --- | --- |');
    for (const a of dungeonAdds) {
      const r = a.row || {};
      L.push(`| ${a.name} | ${r.where || ''} | ${r.pack || ''} | ${(r.effect || '').slice(0, 70)} |`);
    }
  }
  L.push('');
  L.push(`### 2.2 剧情模式（本软件不需要）—— ${storyAdds.length} 条`);
  L.push('');
  L.push('<details><summary>展开查看</summary>');
  L.push('');
  L.push('| 名称 | 出现地点 |');
  L.push('| --- | --- |');
  for (const a of storyAdds) {
    const r = a.row || {};
    L.push(`| ${a.name} | ${r.where || ''} |`);
  }
  L.push('');
  L.push('</details>');
  L.push('');

  L.push(`## 三、本地有、wiki 上没有（${localOnly.length} 条）`);
  L.push('');
  if (localOnly.length === 0) L.push('（无）');
  else {
    L.push('| 名称 | id | 等级 |');
    L.push('| --- | --- | --- |');
    for (const n of localOnly) {
      const loc = local.find((x) => x.name === n);
      L.push(`| ${n} | \`${loc.id}\` | ${loc.tier || ''} |`);
    }
  }
  L.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join('\n'), 'utf8');

  console.log(`wiki 行 ${rows.length} / 去重 ${wikiNames.length} / 本地 ${local.length}`);
  console.log(`疑似改名 ${renames.length} / 新增 ${additions.length} / 本地独有 ${localOnly.length}`);
  console.log('已写出 ' + OUT);
}

main();
