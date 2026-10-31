// 运行时视觉管线：一帧灰度图 → 每环节得分 → 状态机判定
// 模板由 tools/vision/build_templates.js 从实拍帧生成，运行时只做抽取和点积。
const fs = require('fs');
const path = require('path');
const { VisionStateMachine, PHASES } = require('./stateMachine');

const CANON_W = 128;

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

/** 从整帧里抠出一块并归一化，尺寸由模板决定 */
function extractVec(gray, width, height, rect, outW, outH) {
  const [rx, ry, rw, rh] = rect;
  return normalize(
    sampleBox(gray, width, height, rx * width, ry * height, (rx + rw) * width, (ry + rh) * height, outW, outH)
  );
}

function decodeTemplate(entry) {
  const raw = Buffer.from(entry.data, 'base64');
  const q = new Int8Array(raw.buffer, raw.byteOffset, raw.length);
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) out[i] = q[i] * entry.scale;
  return out;
}

class VisionPipeline {
  constructor(opts = {}) {
    const file = opts.templatesPath || path.join(__dirname, 'templates.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    this.templates = {};
    for (const phase of Object.keys(data.phases)) {
      const e = data.phases[phase];
      this.templates[phase] = {
        rect: e.rect,
        w: e.w,
        h: e.h,
        vec: decodeTemplate(e),
      };
    }
    this.phases = Object.keys(this.templates);
    this.presence = {};
    for (const key of Object.keys(data.presence || {})) {
      const e = data.presence[key];
      this.presence[key] = { rect: e.rect, w: e.w, h: e.h, scan: e.scan || null, vec: decodeTemplate(e) };
    }
    this.sm = opts.stateMachine || new VisionStateMachine(opts);
    this.lastScores = null;
    this.framesSeen = 0;
  }

  /** 只打分，不推进状态 */
  score(gray, width, height) {
    const scores = {};
    for (const phase of this.phases) {
      const t = this.templates[phase];
      const v = extractVec(gray, width, height, t.rect, t.w, t.h);
      let s = 0;
      const n = Math.min(v.length, t.vec.length);
      for (let i = 0; i < n; i++) s += v[i] * t.vec[i];
      scores[phase] = s;
    }
    this.lastScores = scores;
    return scores;
  }

  /** 存在性打分：这个标志在不在（商店上下三角这种）
   *  带 scan 的（如「追加的苦难」标签，卡片数不同时横向位置会变）沿 x 横扫取最高分。 */
  scorePresence(gray, width, height, key) {
    const t = this.presence[key];
    if (!t) return null;
    const dot = (rect) => {
      const v = extractVec(gray, width, height, rect, t.w, t.h);
      let s = 0;
      const n = Math.min(v.length, t.vec.length);
      for (let i = 0; i < n; i++) s += v[i] * t.vec[i];
      return s;
    };
    if (!t.scan) return dot(t.rect);
    const [x0, x1, step] = t.scan;
    const steps = Math.max(1, Math.round((x1 - x0) / step));
    let best = -2;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + i * ((x1 - x0) / steps);
      const s = dot([x, t.rect[1], t.rect[2], t.rect[3]]);
      if (s > best) best = s;
    }
    return best;
  }

  /** 打分 + 推进状态机 */
  classify(gray, width, height) {
    const scores = this.score(gray, width, height);
    this.framesSeen++;
    const res = this.sm.observe(scores);
    return { ...res, scores };
  }

  reset(phase = null) {
    this.sm.reset(phase);
    this.framesSeen = 0;
    return this;
  }

  get phase() {
    return this.sm.phase;
  }
}

module.exports = { VisionPipeline, PHASES, extractVec, sampleBox, normalize };
