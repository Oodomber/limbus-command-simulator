// 回放验证：按时间顺序把 73 帧喂给状态机，看它能不能稳定吐出正确的环节
// 跑法：$env:ELECTRON_RUN_AS_NODE=''; electron tools/vision/replay.js
const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');
const { VisionStateMachine, PHASES } = require('../../src/vision/stateMachine');

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
  return normalize(sampleBox(gray, width, height, x0, y0, x1, y1, CANON_W, outH));
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function medianVec(vecs) {
  const len = vecs[0].length;
  const out = new Float32Array(len);
  const col = new Float32Array(vecs.length);
  for (let i = 0; i < len; i++) {
    for (let j = 0; j < vecs.length; j++) col[j] = vecs[j][i];
    col.sort();
    out[i] = col[Math.floor(col.length / 2)];
  }
  return normalize(out);
}

function main() {
  const manifest = fs
    .readFileSync(path.join(ROOT, 'datasets/manifest.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .sort((a, b) => a.ts.localeCompare(b.ts));

  // 第一遍：逐帧抽取所有锚点向量（拿完就丢像素）
  const frames = [];
  for (const m of manifest) {
    const abs = path.join(ROOT, 'datasets', m.file);
    if (!fs.existsSync(abs)) continue;
    const fr = grayFromFile(abs);
    if (!fr) continue;
    const vecs = {};
    for (const a of CORE) vecs[a.phase] = extract(fr.gray, fr.width, fr.height, a.rect);
    frames.push({ file: path.basename(abs), truth: m.phase, ts: m.ts, vecs });
  }

  // 第二遍：留一法打分 + 状态机
  const sm = new VisionStateMachine();
  const outliers = [];
  let correct = 0;
  let decided = 0;
  const timeline = [];

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const scores = {};
    for (const a of CORE) {
      const others = frames.filter((x, j) => j !== i && x.truth === a.phase).map((x) => x.vecs[a.phase]);
      if (others.length === 0) {
        scores[a.phase] = 0;
        continue;
      }
      scores[a.phase] = dot(f.vecs[a.phase], medianVec(others));
    }
    if (process.env.REPLAY_DEBUG && i < 6) {
      process.stdout.write(
        `#${i} ${f.truth}  ` +
          CORE.map((a) => `${a.phase}:${scores[a.phase].toFixed(2)}`).join(' ') +
          '\n'
      );
    }
    // 实拍是「每页只留 1 帧」的采样，彼此不相邻，迟滞永远攒不满。
    // REPLAY_DWELL=N 把每帧当作连续出现 N 次来喂（模拟运行时 250ms 一帧的停留）。
    const dwell = Math.max(1, Number(process.env.REPLAY_DWELL) || 1);
    let res = null;
    for (let rep = 0; rep < dwell; rep++) res = sm.observe(scores);
    if (res.phase !== null) {
      decided++;
      if (res.phase === f.truth) correct++;
      else outliers.push(`${f.file}  真值 ${f.truth}  判定 ${res.phase}  (${res.reason})`);
    }
    timeline.push(`${f.ts.slice(11, 19)} ${f.truth.padEnd(13)} -> ${String(res.phase).padEnd(13)} ${res.changed ? '★切换' : ''}`);
  }

  const out = [];
  out.push(`帧数 ${frames.length}  状态机判定 ${decided}  正确 ${correct}  准确率 ${((correct / decided) * 100).toFixed(2)}%`);
  out.push(`切换次数 ${sm.history.length}  被拒的非法转移 ${sm.rejected.length}`);
  if (sm.rejected.length) {
    out.push('被拒的非法转移：');
    for (const r of sm.rejected.slice(0, 20)) out.push(`  ${r.from} -> ${r.to}  ${r.score.toFixed(3)}`);
  }
  if (outliers.length) {
    out.push('判错的帧：');
    for (const o of outliers.slice(0, 30)) out.push('  ' + o);
  }
  out.push('');
  out.push('时间线：');
  for (const t of timeline) out.push('  ' + t);

  const text = out.join('\n');
  process.stdout.write(text + '\n');
  fs.writeFileSync(path.join(ROOT, 'reports', 'replay.txt'), text, 'utf8');
  app.exit(0);
}

app.whenReady().then(main);
