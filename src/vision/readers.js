// 结构化读数：数格子、看标签。坐标全部是归一化的，以 2560x1600 为基准。
// 三个读数都不做 OCR、不读数字，只依赖几何 + 亮度/颜色。

const SHOP_COL_X = [0.4550, 0.5765, 0.6980, 0.8195];
const SHOP_BOX_W = 0.062;
const SHOP_ROW_Y = [0.3120, 0.3120 + 0.1924];
const SHOP_LABEL_DY = 0.014; // 红字压在图标框上沿
const SHOP_LABEL_H = 0.028;
const SHOP_PAD_X = 0.020;

function clampRect(x0, y0, x1, y1, w, h) {
  return [
    Math.max(0, Math.min(w, x0)),
    Math.max(0, Math.min(h, y0)),
    Math.max(0, Math.min(w, x1)),
    Math.max(0, Math.min(h, y1)),
  ];
}

/** 商店单个格子的状态：正常 / 已购买 / 经费不足 / 未知 */
function readShopCell(gray, width, height, col, row) {
  const bx = SHOP_COL_X[col];
  const by = SHOP_ROW_Y[row];
  const [x0, y0, x1, y1] = clampRect(
    Math.round((bx - SHOP_PAD_X) * width),
    Math.round((by + SHOP_LABEL_DY) * height),
    Math.round((bx + SHOP_BOX_W + SHOP_PAD_X) * width),
    Math.round((by + SHOP_LABEL_DY + SHOP_LABEL_H) * height),
    width,
    height
  );
  let red = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = gray[y * width + x];
      // gray 是单通道；红字判定需要颜色，这里用「明显高于局部底色」近似，
      // 真正的颜色判定在 colorReadShopCell 里做。
      if (v > 130) {
        red++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (red < 200 || maxX < minX) return { state: 'normal', ink: red, span: 0 };
  const span = (maxX - minX + 1) / width;
  return { state: span > 0.044 ? 'unaffordable' : 'purchased', ink: red, span };
}

/** 带颜色版本：rgba 逐像素判红字，比灰度阈值可靠 */
function readShopCellRGBA(rgba, width, height, col, row) {
  const bx = SHOP_COL_X[col];
  const by = SHOP_ROW_Y[row];
  const [x0, y0, x1, y1] = clampRect(
    Math.round((bx - SHOP_PAD_X) * width),
    Math.round((by + SHOP_LABEL_DY) * height),
    Math.round((bx + SHOP_BOX_W + SHOP_PAD_X) * width),
    Math.round((by + SHOP_LABEL_DY + SHOP_LABEL_H) * height),
    width,
    height
  );
  let n = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      if (r > 130 && r - g > 55 && r - b > 55) {
        n++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (n < 200 || maxX < minX) return { state: 'normal', ink: n, span: 0 };
  const span = (maxX - minX + 1) / width;
  return { state: span > 0.044 ? 'unaffordable' : 'purchased', ink: n, span };
}

/** 商店可见的两整行（8 格）的状态 */
function readShopGrid(rgba, width, height) {
  const cells = [];
  for (let row = 0; row < SHOP_ROW_Y.length; row++) {
    for (let col = 0; col < SHOP_COL_X.length; col++) {
      cells.push(readShopCellRGBA(rgba, width, height, col, row));
    }
  }
  return cells;
}

/** 事件选项数：数选项框的上下边框线，框数 = 线数 / 2 */
function countEventOptions(gray, width, height) {
  const x0 = Math.round(0.54 * width);
  const x1 = Math.round(0.9 * width);
  const y0 = Math.round(0.24 * height);
  const y1 = Math.round(0.82 * height);
  const need = (x1 - x0) * 0.55;
  const lines = [];
  let start = -1;
  let prev = -Infinity;
  for (let y = y0; y < y1; y++) {
    let bright = 0;
    for (let x = x0; x < x1; x++) if (gray[y * width + x] > 120) bright++;
    if (bright > need) {
      if (start < 0) start = y;
      else if (y - prev > 3) {
        lines.push([start, prev]);
        start = y;
      }
      prev = y;
    }
  }
  if (start >= 0) lines.push([start, prev]);
  return { count: Math.floor(lines.length / 2), lines };
}

/** 卡包数：按列切亮区，亮区就是卡包 */
function countCardpacks(gray, width, height) {
  const y0 = Math.round(0.22 * height);
  const y1 = Math.round(0.4 * height);
  const profile = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = y0; y < y1; y++) sum += gray[y * width + x];
    profile[x] = sum / (y1 - y0);
  }
  const sorted = Array.from(profile).sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const thr = (p5 + p95) / 2;
  const minRun = width * 0.05;
  const runs = [];
  let start = -1;
  for (let x = 0; x < width; x++) {
    if (profile[x] > thr) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      if (x - start > minRun) runs.push([start / width, x / width]);
      start = -1;
    }
  }
  if (start >= 0 && width - start > minRun) runs.push([start / width, 1]);
  return { count: runs.length, runs };
}

/**
 * 商店类型：普通 / 特殊。
 *
 * 只认左面板那块标题牌匾（「商店」灰白 vs 「特殊商店」红字），
 * 不碰商品格子 —— 格子会滚动、数量会变、已购会挪到末尾，全部不读。
 */
const SHOP_TITLE = { x0: 0.135, x1: 0.275, y0: 0.170, y1: 0.222 };

function readShopType(rgba, width, height) {
  const x0 = Math.round(SHOP_TITLE.x0 * width);
  const x1 = Math.round(SHOP_TITLE.x1 * width);
  const y0 = Math.round(SHOP_TITLE.y0 * height);
  const y1 = Math.round(SHOP_TITLE.y1 * height);
  let red = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * width + x) * 4;
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      total++;
      if (r > 120 && r - g > 50 && r - b > 50) red++;
    }
  }
  const ratio = total ? red / total : 0;
  return { type: ratio >= 0.05 ? 'special' : 'normal', redPixels: red, redRatio: ratio };
}

module.exports = {
  SHOP_COL_X,
  SHOP_ROW_Y,
  readShopCell,
  readShopCellRGBA,
  readShopGrid,
  readShopType,
  countEventOptions,
  countCardpacks,
};
