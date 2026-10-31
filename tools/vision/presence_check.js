// 验证 presence 锚点（含 scan 横扫）在全部实拍帧上的取值分布
// 跑法：$env:ELECTRON_RUN_AS_NODE=''; & ".\node_modules\electron\dist\electron.exe" tools/vision/presence_check.js
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const { VisionPipeline } = require('../../src/vision/visionPipeline');

const ROOT = path.join(__dirname, '..', '..');
const FRAMES = path.join(ROOT, 'datasets', 'frames');
const KEYS = ['shop_arrow_up', 'shop_arrow_down', 'boss_reward_hardship'];

function toGray(bitmap, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    // nativeImage.toBitmap() 是 BGRA
    g[i] = 0.114 * bitmap[p] + 0.587 * bitmap[p + 1] + 0.299 * bitmap[p + 2];
  }
  return g;
}

app.whenReady().then(() => {
  const pipe = new VisionPipeline();
  const rows = [];
  for (const phase of fs.readdirSync(FRAMES).sort()) {
    const dir = path.join(FRAMES, phase);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.toLowerCase().endsWith('.png')).sort()) {
      const img = nativeImage.createFromPath(path.join(dir, f));
      if (img.isEmpty()) continue;
      const { width, height } = img.getSize();
      const gray = toGray(img.toBitmap(), width, height);
      const r = { phase, file: f };
      for (const k of KEYS) r[k] = pipe.scorePresence(gray, width, height, k);
      rows.push(r);
    }
  }
  const out = [];
  out.push(`帧数 ${rows.length}`);
  out.push('');
  for (const k of KEYS) {
    out.push(`== ${k} ==`);
    const byPhase = {};
    for (const r of rows) {
      (byPhase[r.phase] = byPhase[r.phase] || []).push(r[k]);
    }
    for (const phase of Object.keys(byPhase).sort()) {
      const v = byPhase[phase];
      const lo = Math.min(...v);
      const hi = Math.max(...v);
      out.push(`  ${phase.padEnd(14)} 最低 ${lo.toFixed(3)}  最高 ${hi.toFixed(3)}  (n=${v.length})`);
    }
    out.push('');
  }
  const name = 'boss_reward_hardship';
  out.push(`== ${name} 逐帧 ==`);
  for (const r of rows) out.push(`  ${r.phase.padEnd(14)} ${r.file}  ${r[name].toFixed(3)}`);
  process.stdout.write(out.join('\n') + '\n');
  app.exit(0);
});
