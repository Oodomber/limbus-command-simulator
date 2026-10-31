// 从实拍帧生成生产用锚点模板（每环节一个中位数模板）
// 跑法：$env:ELECTRON_RUN_AS_NODE=''; electron tools/vision/build_templates.js
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const ROOT = path.resolve(__dirname, '../..');
const FRAMES = path.join(ROOT, 'datasets', 'frames');
const ANCHORS = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/vision/anchors.json'), 'utf8'));
const CANON_W = 128;
const CORE = ANCHORS.anchors.filter((a) => a.kind !== 'presence');

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

function extract(gray, width, height, rect) {
  const [rx, ry, rw, rh] = rect;
  const x0 = rx * width;
  const y0 = ry * height;
  const x1 = (rx + rw) * width;
  const y1 = (ry + rh) * height;
  const outH = Math.max(1, Math.round((CANON_W * (y1 - y0)) / (x1 - x0)));
  return { vec: normalize(sampleBox(gray, width, height, x0, y0, x1, y1, CANON_W, outH)), h: outH };
}

function main() {
  const out = { version: 1, canonW: CANON_W, builtAt: new Date().toISOString(), phases: {} };
  const report = [];

  for (const a of CORE) {
    const dir = path.join(FRAMES, a.phase);
    if (!fs.existsSync(dir)) {
      report.push(`${a.phase}: 跳过（没有帧目录）`);
      continue;
    }
    const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort();
    const vecs = [];
    let outH = 0;
    for (const f of files) {
      const fr = grayFromFile(path.join(dir, f));
      if (!fr) continue;
      const e = extract(fr.gray, fr.width, fr.height, a.rect);
      vecs.push(e.vec);
      outH = e.h;
    }
    if (vecs.length === 0) {
      report.push(`${a.phase}: 跳过（没有可用帧）`);
      continue;
    }
    const med = new Float32Array(vecs[0].length);
    const col = new Float32Array(vecs.length);
    for (let i = 0; i < med.length; i++) {
      for (let j = 0; j < vecs.length; j++) col[j] = vecs[j][i];
      col.sort();
      med[i] = col[Math.floor(col.length / 2)];
    }
    const normed = normalize(med);
    // 量化成 Int8（-127..127），base64 存储，体积比 JSON 数组小一个数量级
    const q = new Int8Array(normed.length);
    // 量化系数 = 最大绝对值的倒数，运行时乘回来
    let maxAbs = 0;
    for (let i = 0; i < normed.length; i++) maxAbs = Math.max(maxAbs, Math.abs(normed[i]));
    const scale = maxAbs / 127 || 1;
    for (let i = 0; i < normed.length; i++) {
      q[i] = Math.max(-127, Math.min(127, Math.round(normed[i] / scale)));
    }
    out.phases[a.phase] = {
      name: a.name,
      rect: a.rect,
      w: CANON_W,
      h: outH,
      scale,
      data: Buffer.from(q.buffer).toString('base64'),
    };
    report.push(`${a.phase}: ${vecs.length} 帧 → 模板 ${CANON_W}x${outH}`);
  }

  const dst = path.join(ROOT, 'src/vision/templates.json');
  fs.writeFileSync(dst, JSON.stringify(out), 'utf8');
  report.push(`写入 ${dst}  ${Math.round(fs.statSync(dst).size / 1024)}KB`);
  process.stdout.write(report.join('\n') + '\n');
  app.exit(0);
}

app.whenReady().then(main);
