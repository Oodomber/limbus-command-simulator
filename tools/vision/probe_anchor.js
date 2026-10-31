// 用参考帧当模板给一组帧打分（开发期工具）
// 用法：electron tools/vision/probe_anchor.js <子目录> <phase> <参考帧文件名>
//   electron tools/vision/probe_anchor.js combat combat_battle 20261030-224043-181.png
//   electron tools/vision/probe_anchor.js combat combat 20261030-222455-766.png

const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const M = require('../../src/vision/match');

const ROOT = path.resolve(__dirname, '..', '..');
const FRAMES = path.join(ROOT, 'datasets', 'frames');
const ANCHORS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'vision', 'anchors.json'), 'utf8')).anchors;

function grayOf(file) {
  const img = nativeImage.createFromPath(file);
  const { width, height } = img.getSize();
  return { g: M.bgraToGray(img.toBitmap(), width, height), w: width, h: height };
}

function rectOf(a, w, h) {
  const [x, y, rw, rh] = a.rect;
  return [Math.round(x * w), Math.round(y * h), Math.round(rw * w), Math.round(rh * h)];
}

function run() {
  const [sub, phase, refName] = process.argv.slice(2);
  const anchor = ANCHORS.find((a) => a.phase === phase);
  if (!anchor) {
    console.log('没找到锚点 ' + phase + '，可选：' + ANCHORS.map((a) => a.phase).join(' '));
    return;
  }
  const dir = path.join(FRAMES, sub);
  const refFile = path.join(dir, refName);
  if (!fs.existsSync(refFile)) {
    console.log('参考帧不存在：' + refFile);
    return;
  }
  const ref = grayOf(refFile);
  const tpl = M.buildTemplate([M.extractAnchor(ref.g, ref.w, ref.h, anchor.rect)]);
  console.log('锚点 ' + phase + ' = ' + anchor.name + '  模板帧 ' + refName + '  rect ' + anchor.rect.join(','));

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
  const rows = [];
  for (const f of files) {
    const c = grayOf(path.join(dir, f));
    const r = M.scoreAnchor(c.g, c.w, c.h, anchor.rect, tpl);
    const s = typeof r === 'number' ? r : r.score;
    rows.push([s, f]);
  }
  rows.sort((a, b) => b[0] - a[0]);
  for (const [s, f] of rows) console.log('  ' + s.toFixed(3) + '  ' + f);
}

app.whenReady().then(() => {
  try {
    run();
  } catch (e) {
    console.log('ERROR ' + e.message);
  }
  app.exit(0);
});
