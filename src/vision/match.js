'use strict';

/**
 * 锚点匹配的纯函数实现：不依赖任何第三方库，主进程 / UtilityProcess / 渲染进程都能直接用。
 *
 * 约定：所有图像都是「灰度 + Float32Array 一维数组 + 自己带宽高」，
 * 免得把 ImageData / Buffer / TypedArray 的差异渗进匹配逻辑里。
 */

const CANON_W = 128; // 所有锚点小块统一缩放到这个宽度再比对，避免分辨率差异
const JITTER = 2; // 取块时在正负这么多像素内微调，吸收取整误差
const JITTER_STEP = 2;

/** 抖动偏移列表，离线评测和在线匹配必须用同一份，否则分数对不上 */
function jitterOffsets() {
  const out = [];
  for (let dy = -JITTER; dy <= JITTER; dy += JITTER_STEP) {
    for (let dx = -JITTER; dx <= JITTER; dx += JITTER_STEP) out.push([dx, dy]);
  }
  return out;
}

/** BGRA 缓冲区（Electron nativeImage.toBitmap 的格式）转灰度 */
function bgraToGray(bgra, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.114 * bgra[p] + 0.587 * bgra[p + 1] + 0.299 * bgra[p + 2];
  }
  return out;
}

/** RGBA 缓冲区（canvas getImageData 的格式）转灰度 */
function rgbaToGray(rgba, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return out;
}

/** 裁一块出来，越界部分按边缘像素延拓，保证任何坐标都能拿到定长数组 */
function cropGray(gray, width, height, x, y, w, h) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    let sy = y + j;
    if (sy < 0) sy = 0;
    else if (sy >= height) sy = height - 1;
    const row = sy * width;
    for (let i = 0; i < w; i++) {
      let sx = x + i;
      if (sx < 0) sx = 0;
      else if (sx >= width) sx = width - 1;
      out[j * w + i] = gray[row + sx];
    }
  }
  return out;
}

/** 双线性缩放 */
function resizeGray(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Float32Array(dw * dh);
  const rx = dw > 1 ? (sw - 1) / (dw - 1) : 0;
  const ry = dh > 1 ? (sh - 1) / (dh - 1) : 0;
  for (let j = 0; j < dh; j++) {
    const fy = j * ry;
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const wy = fy - y0;
    for (let i = 0; i < dw; i++) {
      const fx = i * rx;
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const wx = fx - x0;
      const a = src[y0 * sw + x0] * (1 - wx) + src[y0 * sw + x1] * wx;
      const b = src[y1 * sw + x0] * (1 - wx) + src[y1 * sw + x1] * wx;
      out[j * dw + i] = a * (1 - wy) + b * wy;
    }
  }
  return out;
}

/** 去均值并归一化到单位长度；全平的块返回零向量（相似度恒为 0，不会误命中） */
function normalizeVec(v) {
  const n = v.length;
  const out = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += v[i];
  mean /= n;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const d = v[i] - mean;
    out[i] = d;
    norm += d * d;
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return out;
  for (let i = 0; i < n; i++) out[i] /= norm;
  return out;
}

/** 两个已归一化向量的相关度 */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** 锚点矩形（归一化）换算成像素尺寸，宽固定 CANON_W，高按宽高比 */
function canonSize(rect) {
  const [, , w, h] = rect;
  const cw = CANON_W;
  const ch = Math.max(8, Math.round((CANON_W * h) / w));
  return [cw, ch];
}

/** 从一帧里取出某个锚点的规范化向量 */
function extractAnchor(gray, width, height, rect, dx = 0, dy = 0) {
  const [nx, ny, nw, nh] = rect;
  const px = Math.round(nx * width) + dx;
  const py = Math.round(ny * height) + dy;
  const pw = Math.max(2, Math.round(nw * width));
  const ph = Math.max(2, Math.round(nh * height));
  const [cw, ch] = canonSize(rect);
  const patch = cropGray(gray, width, height, px, py, pw, ph);
  return normalizeVec(resizeGray(patch, pw, ph, cw, ch));
}

/** 用多帧求模板：各帧向量先求均值再归一化 */
function buildTemplate(vecs) {
  const n = vecs[0].length;
  const sum = new Float32Array(n);
  for (const v of vecs) for (let i = 0; i < n; i++) sum[i] += v[i];
  for (let i = 0; i < n; i++) sum[i] /= vecs.length;
  return normalizeVec(sum);
}

/** 在一帧里给某个锚点打分；带小范围抖动取最好位置 */
function scoreAnchor(gray, width, height, rect, template) {
  let best = -Infinity;
  let bestDx = 0;
  let bestDy = 0;
  for (let dy = -JITTER; dy <= JITTER; dy += JITTER_STEP) {
    for (let dx = -JITTER; dx <= JITTER; dx += JITTER_STEP) {
      const v = extractAnchor(gray, width, height, rect, dx, dy);
      const s = dot(v, template);
      if (s > best) {
        best = s;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }
  return { score: best, dx: bestDx, dy: bestDy };
}

module.exports = {
  CANON_W,
  jitterOffsets,
  bgraToGray,
  rgbaToGray,
  cropGray,
  resizeGray,
  normalizeVec,
  dot,
  extractAnchor,
  buildTemplate,
  scoreAnchor,
};
