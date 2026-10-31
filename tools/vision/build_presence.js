// 生成「存在性锚点」模板：商店上下三角这种「有/没有」的标志。
// 每个 presence 锚点只从一个确认「有」的帧里取模板（取多帧中位数会把它糊掉）。
// 跑法：$env:ELECTRON_RUN_AS_NODE=''; electron tools/vision/build_presence.js
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const ROOT = path.resolve(__dirname, '../..');
const FRAMES = path.join(ROOT, 'datasets', 'frames');
const TEMPLATES = path.join(ROOT, 'src/vision/templates.json');
const ANCHORS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/vision/anchors.json'), 'utf8'));
const CANON_W = 128;

// 每个 presence 锚点指定一个「确实存在」的样帧
const SOURCE = {
  shop_arrow_up: 'shop/20261030-232546-441.png',
  shop_arrow_down: 'shop/20261030-232546-441.png',
  boss_reward_hardship: 'boss_reward/20261030-153658-408.png',
};

function grayFromFile(file) {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();
  const n = width * height;
  const gray = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    gray[i] = 0.114 * bmp[p] + 0.587 * bmp[p + 1] + 0.299 * bmp[p + 2];
  }
  return { gray, width, height };
}

function sampleBox(gray, width, height, x0, y0, x1, y1, outW, outH) {
  const out = new Float32Array(outW * outH);
  const sx = (x1 - x0) / outW;
  const sy = (y1 - y0) / outH;
  for (let oy = 0; oy < outH; oy++) {
    const y = Math.min(height - 1, Math.max(0, Math.round(y0 + (oy + 0.5) * sy - 0.5)));
    for (let ox = 0; ox < outW; ox++) {
      const x = Math.min(width - 1, Math.max(0, Math.round(x0 + (ox + 0.5) * sx - 0.5)));
      out[oy * outW + ox] = gray[y * width + x];
    }
  }
  return out;
}

function normalize(v) {
  let mean = 0;
  for (let i = 0; i < v.length; i++) mean += v[i];
  mean /= v.length;
  const out = new Float32Array(v.length);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const d = v[i] - mean;
    out[i] = d;
    sum += d * d;
  }
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) out[i] /= norm;
  return out;
}

function main() {
  const data = JSON.parse(fs.readFileSync(TEMPLATES, 'utf8'));
  data.presence = data.presence || {};
  const report = [];

  for (const a of ANCHORS.anchors) {
    if (a.kind !== 'presence') continue;
    const rel = SOURCE[a.phase];
    if (!rel) {
      report.push(`${a.phase}: 没指定样帧，跳过`);
      continue;
    }
    const rels = Array.isArray(rel) ? rel : [rel];
    const [rx, ry, rw, rh] = a.rect;
    let first = null;
    const samples = [];
    for (const one of rels) {
      const fr = grayFromFile(path.join(FRAMES, one));
      if (!fr) {
        report.push(`${a.phase}: 样帧读取失败 ${one}`);
        continue;
      }
      if (!first) first = fr;
      const x0 = rx * fr.width;
      const y0 = ry * fr.height;
      const x1 = (rx + rw) * fr.width;
      const y1 = (ry + rh) * fr.height;
      const outH = Math.max(1, Math.round((CANON_W * (y1 - y0)) / (x1 - x0)));
      samples.push({ vec: sampleBox(fr.gray, fr.width, fr.height, x0, y0, x1, y1, CANON_W, outH), outH });
    }
    if (!first || samples.length === 0) continue;

    // 多帧时逐像素取中位数：变化的数字被抹掉，恒定的边框/分隔线留下
    const outH = samples[0].outH;
    const merged = new Float32Array(CANON_W * outH);
    if (samples.length === 1) {
      merged.set(samples[0].vec);
    } else {
      const col = new Float32Array(samples.length);
      for (let i = 0; i < merged.length; i++) {
        for (let k = 0; k < samples.length; k++) col[k] = samples[k].vec[i];
        col.sort();
        const m = col.length;
        merged[i] = m % 2 ? col[(m - 1) / 2] : (col[m / 2 - 1] + col[m / 2]) / 2;
      }
    }
    const vec = normalize(merged);

    let maxAbs = 0;
    for (let i = 0; i < vec.length; i++) maxAbs = Math.max(maxAbs, Math.abs(vec[i]));
    const scale = maxAbs / 127 || 1;
    const q = new Int8Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      q[i] = Math.max(-127, Math.min(127, Math.round(vec[i] / scale)));
    }
    data.presence[a.phase] = {
      name: a.name,
      rect: a.rect,
      w: CANON_W,
      h: outH,
      scale,
      source: rels,
      data: Buffer.from(q.buffer).toString('base64'),
    };
    if (a.scan) data.presence[a.phase].scan = a.scan;
    report.push(`${a.phase}: 样帧 ${rels.length} 张（中位数） → ${CANON_W}x${outH}`);
  }

  fs.writeFileSync(TEMPLATES, JSON.stringify(data), 'utf8');
  report.push(`写入 ${TEMPLATES}  ${Math.round(fs.statSync(TEMPLATES).size / 1024)}KB`);
  process.stdout.write(report.join('\n') + '\n');
  app.exit(0);
}

app.whenReady().then(main);
