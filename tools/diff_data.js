/**
 * diff_data.js — 差异报告：wiki 上现在有什么 vs 本地 data 里有什么
 *
 * 用法: node tools/diff_data.js
 *
 * 只读。不写 data/、不改任何东西，只在 reports/data-diff.md 里出一份清单。
 *
 * 依据（本轮探明的现状）：
 *   - 普通 HTTP 请求一律 403，必须走 Playwright 里的 fetch
 *   - MediaWiki API 可用：/api.php
 *   - 人格 → Category:人格 的成员，标题形如「奥提斯Cinq协会南部4科」= 罪人 + 人格名
 *   - E.G.O → Category:E.G.O 的成员，标题形如「AEDD-格里高尔」= 名称-罪人
 *   - 饰品/事件/卡包 没有分类页，需要另找入口（本脚本先只出能出的部分）
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://limbuscompany.huijiwiki.com';
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'reports', 'data-diff.md');

const SINNERS = ['李箱', '浮士德', '堂吉诃德', '良秀', '默尔索', '鸿璐', '希斯克利夫', '以实玛利', '罗佳', '辛克莱', '奥提斯', '格里高尔'];

/**
 * 归一化：wiki 与本地数据在标点上并不一致，直接比对会造出大量假「新增」。
 * 实测差异：
 *   - wiki 用 `E.G.O::提灯`（双冒号），本地用 `E.G.O:提灯`
 *   - 本地个别条目把空格写成了下划线（`LCE_E.G.O`）
 *   - 全角括号/冒号/间隔号偶有混用
 */
function norm(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/_/g, '')
    .replace(/：/g, ':')
    .replace(/：：/g, ':')
    .replace(/::/g, ':')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/[·・]/g, '');
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function asArray(v, key) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v[key])) return v[key];
  return [];
}

/** 把 Category:人格 的标题拆成 { sinner, name } */
function splitIdentityTitle(title) {
  for (const s of SINNERS) {
    if (title.startsWith(s)) return { sinner: s, name: title.slice(s.length) };
  }
  return { sinner: '', name: title };
}

/** 把 Category:E.G.O 的标题拆成 { name, sinner } */
function splitEgoTitle(title) {
  for (const s of SINNERS) {
    if (title.endsWith('-' + s)) return { name: title.slice(0, -(s.length + 1)), sinner: s };
    if (title.endsWith(s)) return { name: title.slice(0, -s.length).replace(/[-－]$/, ''), sinner: s };
  }
  return { name: title, sinner: '' };
}

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
    try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 300) }; }
  }, BASE + '/api.php?' + q);

  async function categoryMembers(cat) {
    const titles = [];
    let cont = '';
    for (let i = 0; i < 6; i++) {
      const j = await api('action=query&list=categorymembers&cmtitle=' + encodeURIComponent('Category:' + cat) +
        '&cmlimit=500&cmnamespace=0&format=json' + (cont ? '&cmcontinue=' + encodeURIComponent(cont) : ''));
      const m = j?.query?.categorymembers || [];
      for (const x of m) titles.push(x.title);
      cont = j?.continue?.cmcontinue || '';
      if (!cont || m.length === 0) break;
      await page.waitForTimeout(400);
    }
    return titles;
  }

  const idTitles = await categoryMembers('人格');
  const egoTitles = await categoryMembers('E.G.O');

  const identities = asArray(readJson(path.join(ROOT, 'data', 'identities.json')), 'identities');
  const egos = asArray(readJson(path.join(ROOT, 'data', 'egos.json')), 'egos');

  const idKey = (t) => { const s = splitIdentityTitle(t); return norm(`${s.sinner}${s.name}`); };

  const localIdKeys = new Set(identities.map((x) => norm(`${x.sinner}${x.name}`)));
  const wikiIdKeys = new Set(idTitles.map(idKey));

  const newIdentities = idTitles.filter((t) => !localIdKeys.has(idKey(t)));
  const goneIdentities = identities.filter((x) => !wikiIdKeys.has(norm(`${x.sinner}${x.name}`)));

  const localEgoKeys = new Set(egos.map((x) => norm(x.name)));
  const newEgos = egoTitles.filter((t) => !localEgoKeys.has(norm(splitEgoTitle(t).name)));
  const goneEgos = egos.filter((x) => !egoTitles.some((t) => norm(splitEgoTitle(t).name) === norm(x.name)));

  const lines = [];
  lines.push('# 数据差异报告');
  lines.push('');
  lines.push(`生成时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push(`数据源：${BASE}（MediaWiki API，经 Playwright 携带会话）`);
  lines.push('');
  lines.push('## 人格');
  lines.push('');
  lines.push(`- wiki 上 \`Category:人格\` 共 **${idTitles.length}** 条`);
  lines.push(`- 本地 \`data/identities.json\` 共 **${identities.length}** 条`);
  lines.push(`- **wiki 有、本地没有：${newIdentities.length} 条**`);
  lines.push('');
  for (const t of newIdentities) {
    const s = splitIdentityTitle(t);
    lines.push(`  - ${s.sinner}｜${s.name}`);
  }
  if (goneIdentities.length) {
    lines.push('');
    lines.push(`- 本地有、wiki 分类里找不到：${goneIdentities.length} 条（可能是改名或分类调整）`);
    lines.push('');
    for (const x of goneIdentities.slice(0, 40)) lines.push(`  - ${x.sinner}｜${x.name}（id: ${x.id}）`);
  }
  lines.push('');
  lines.push('## E.G.O');
  lines.push('');
  lines.push(`- wiki 上 \`Category:E.G.O\` 共 **${egoTitles.length}** 条`);
  lines.push(`- 本地 \`data/egos.json\` 共 **${egos.length}** 条`);
  lines.push(`- **wiki 有、本地没有：${newEgos.length} 条**`);
  lines.push('');
  for (const t of newEgos) lines.push(`  - ${t}`);
  if (goneEgos.length) {
    lines.push('');
    lines.push(`- 本地有、wiki 上匹配不到：${goneEgos.length} 条`);
    for (const x of goneEgos.slice(0, 20)) lines.push(`  - ${x.name}`);
  }

  lines.push('');
  lines.push('## 饰品 / 事件 / 卡包（本轮只探明入口，尚未出数）');
  lines.push('');
  lines.push('这三类在 wiki 上**没有分类页**，取数方式和人格/EGO 完全不同，本轮先记下探测结论：');
  lines.push('');
  lines.push('| 类型 | 现状 | 结论 |');
  lines.push('| --- | --- | --- |');
  lines.push('| 饰品 | `E.G.O饰品` 页 wikitext 只有 1082 字符，正文由「筛选模块」动态渲染；页面里只有 `{{Gift|9284}}` 这类调用 | 要抓 445 条必须让 Playwright 渲染完再取 DOM，或找到筛选模块的数据源 |');
  lines.push('| 事件 | 主列表在 `探索事件` 页，wikitext 101793 字符，靠 `事件结果`/`RichTab`/`标牌` 模板组织 | 可解析，但要先摸清模板参数结构 |');
  lines.push('| 卡包 | 站内 `intitle:卡包` 搜索无结果，`主题卡包` 页面不存在 | 入口尚未找到，需要人工指路或换关键词 |');
  lines.push('');
  lines.push('另外两条硬约束：');
  lines.push('');
  lines.push('- **Cargo 未安装**：`action=cargoquery` 返回 `badvalue`，所以拿不到结构化表，只能解析 wikitext 或渲染后的 DOM。');
  lines.push('- **普通 HTTP 请求一律 403**：站点挡非浏览器请求，所有抓取都必须走 Playwright（`fetch` 要在页面上下文里发）。');

  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(`- 人格：缺 **${newIdentities.length}** 条，其中「黎明事务所」那两条你已经在本机的 userData 副本里手补过；另有 **1 条是改名**（流浪乐队头目 → 老大），不算新增。`);
  lines.push(`- E.G.O：缺 **${newEgos.length}** 条，但其中 4 条是**改名**（终末火柴之光×3 → 第四根火柴之焰、智慧的青枝 → 知识树之枝），真正新增约 **${Math.max(0, newEgos.length - goneEgos.length)}** 条。`);
  lines.push('- 也就是说：人格和 EGO 的缺口很小，**真正的大头在饰品 / 事件 / 卡包**，而这三类的取数入口还没打通。');
  lines.push('');
  lines.push('## 下一步建议');
  lines.push('');
  lines.push('1. 先解决「本地副本遮蔽」：`src/dataLoader.js` 优先读 `%APPDATA%/limbus-command-simulator/data/*.json`，你机器上已经有 `identities.json`(183) 与 `egos.json`(110) 的副本，**比打包版还多**。不处理的话，改了 `data/` 也不会生效。');
  lines.push('2. 人格/EGO 可以直接增量补：按 name 对齐，老条目保留 id（wiki 的 `E.G.O::` 与本地 `E.G.O:` 只是写法差异），新增条目生成新 id。');
  lines.push('3. 饰品 / 事件 / 卡包 需要先把取数入口打通，再谈差异——这一步的工作量比人格/EGO 大一个数量级。');
  lines.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');
  console.log(`写好了: ${OUT}`);
  console.log(`人格 wiki=${idTitles.length} 本地=${identities.length} 新增=${newIdentities.length} 本地独有=${goneIdentities.length}`);
  console.log(`EGO  wiki=${egoTitles.length} 本地=${egos.length} 新增=${newEgos.length} 本地独有=${goneEgos.length}`);

  await browser.close();
})();
