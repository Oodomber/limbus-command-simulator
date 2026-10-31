// 拿实拍帧验证 src/vision/readers.js —— 与 Python 原型逐帧对齐
// 跑法：$env:ELECTRON_RUN_AS_NODE=''; electron tools/vision/readers_check.js
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const readers = require('../../src/vision/readers');

const ROOT = path.resolve(__dirname, '../..');
const FRAMES = path.join(ROOT, 'datasets', 'frames');

// Python 原型跑出来的结果，作为对账基准
const EXPECT_CARDPACK = {
  '20261030-151834-617.png': 5,
  '20261030-151855-423.png': 5,
  '20261030-153710-159.png': 4,
  '20261030-153720-759.png': 3,
  '20261030-154624-074.png': 5,
  '20261030-155404-519.png': 5,
  '20261030-224834-306.png': 5,
};
const EXPECT_EVENT = {
  '20261030-152624-542.png': 2,
  '20261030-153958-602.png': 3,
  '20261030-154234-593.png': 3,
  '20261030-154459-793.png': 2,
  '20261030-154659-977.png': 2,
  '20261030-154942-767.png': 2,
  '20261030-155007-421.png': 2,
};

function loadFrame(file) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  const size = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  const n = size.width * size.height;
  const gray = new Float32Array(n);
  const rgba = new Uint8Array(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const b = bmp[p];
    const g = bmp[p + 1];
    const r = bmp[p + 2];
    gray[i] = 0.114 * b + 0.587 * g + 0.299 * r;
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { gray, rgba, width: size.width, height: size.height };
}

function listPng(dir) {
  const p = path.join(FRAMES, dir);
  if (!fs.existsSync(p)) return [];
  return fs
    .readdirSync(p)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort();
}

function checkCardpacks() {
  let pass = 0;
  let total = 0;
  const rows = [];
  for (const f of listPng('cardpack')) {
    const fr = loadFrame(path.join(FRAMES, 'cardpack', f));
    if (!fr) continue;
    const r = readers.countCardpacks(fr.gray, fr.width, fr.height);
    const want = EXPECT_CARDPACK[f];
    total++;
    const ok = want === undefined ? null : r.count === want;
    if (ok) pass++;
    rows.push(
      `  ${f}  得到 ${r.count}` + (want === undefined ? '  （无基准）' : ok ? '  ✓' : `  ✗ 期望 ${want}`)
    );
  }
  return { name: '卡包数', pass, total: rows.filter((r) => !r.includes('无基准')).length, rows };
}

function checkEventOptions() {
  let pass = 0;
  let total = 0;
  const rows = [];
  for (const f of listPng('event')) {
    const fr = loadFrame(path.join(FRAMES, 'event', f));
    if (!fr) continue;
    const r = readers.countEventOptions(fr.gray, fr.width, fr.height);
    const want = EXPECT_EVENT[f];
    total++;
    const ok = want === undefined ? null : r.count === want;
    if (ok) pass++;
    rows.push(
      `  ${f}  得到 ${r.count}` + (want === undefined ? '  （无基准）' : ok ? '  ✓' : `  ✗ 期望 ${want}`)
    );
  }
  return { name: '事件选项数', pass, total: rows.filter((r) => !r.includes('无基准')).length, rows };
}

function checkShop() {
  const rows = [];
  for (const f of listPng('shop')) {
    const fr = loadFrame(path.join(FRAMES, 'shop', f));
    if (!fr) continue;
    const cells = readers.readShopGrid(fr.rgba, fr.width, fr.height);
    const s = cells.map((c) => (c.state === 'normal' ? '·' : c.state === 'purchased' ? '购' : '不')).join('');
    rows.push(`  ${f}  ${s.slice(0, 4)} | ${s.slice(4, 8)}   ink/span: ${cells.map((c) => `${c.ink}/${c.span.toFixed(3)}`).join(' ')}`);
  }
  return { name: '商店格子', pass: 0, total: 0, rows };
}

app.whenReady().then(() => {
  const out = [];
  for (const r of [checkCardpacks(), checkEventOptions(), checkShop()]) {
    out.push(`== ${r.name} ==`);
    for (const line of r.rows) out.push(line);
    if (r.total > 0) out.push(`  小计 ${r.pass}/${r.total}`);
    out.push('');
  }
  const text = out.join('\n');
  process.stdout.write(text + '\n');
  fs.writeFileSync(path.join(ROOT, 'reports', 'readers_check.txt'), text, 'utf8');
  app.exit(0);
});
