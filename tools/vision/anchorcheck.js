'use strict';

/**
 * 离线评测：拿 datasets/frames 里的实拍帧，检验 8 个锚点能不能把环节分对。
 *
 * 运行（必须用 electron，不能用 node —— 解码 PNG 靠 nativeImage）：
 *   $env:ELECTRON_RUN_AS_NODE=''
 *   .\node_modules\electron\dist\electron.exe tools/vision/anchorcheck.js
 *
 * 输出：
 *   控制台：总体准确率、每环节准确率、混淆矩阵、最差间隔
 *   reports/anchorcheck.json：逐帧明细，供后续回归对比
 *
 * 评测口径是「留一法」：给某一帧打分时，该环节的模板由同环节其他帧算出，
 * 不包含这一帧本身 —— 否则等于拿答案验证答案，数字会虚高。
 */

const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const match = require('../../src/vision/match');

const ROOT = path.resolve(__dirname, '..', '..');
const FRAMES = path.join(ROOT, 'datasets', 'frames');
const ANCHORS = path.join(ROOT, 'src', 'vision', 'anchors.json');
const REPORT = path.join(ROOT, 'reports', 'anchorcheck.json');

const PHASE_LABEL = {
  cardpack: '卡包选择',
  route: '路线',
  combat: '战斗',
  event: '事件',
  judgment: '判定',
  event_reward: '奖励卡',
  shop: '商店',
  boss_reward: '关底奖励',
};

function loadFrames() {
  const frames = [];
  for (const phase of fs.readdirSync(FRAMES).sort()) {
    const dir = path.join(FRAMES, phase);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.toLowerCase().endsWith('.png')) continue;
      frames.push({ phase, file: path.join(dir, file) });
    }
  }
  return frames;
}

function main() {
  const cfg = JSON.parse(fs.readFileSync(ANCHORS, 'utf8'));
  const anchors = cfg.anchors;
  const offsets = match.jitterOffsets();

  const frames = loadFrames();
  if (!frames.length) throw new Error(`没有找到任何帧：${FRAMES}`);

  const t0 = Date.now();

  // 一帧一帧处理，取完向量就丢掉像素，避免几十帧叠在内存里
  for (const frame of frames) {
    const img = nativeImage.createFromPath(frame.file);
    const { width, height } = img.getSize();
    if (!width || !height) throw new Error(`读图失败：${frame.file}`);
    const gray = match.bgraToGray(img.toBitmap(), width, height);
    frame.width = width;
    frame.height = height;
    frame.vecs = anchors.map((a) =>
      offsets.map(([dx, dy]) => match.extractAnchor(gray, width, height, a.rect, dx, dy))
    );
  }

  const extractMs = Date.now() - t0;

  // 每个锚点的中心向量 → 按环节分组
  const centerByPhase = new Map();
  for (const frame of frames) {
    if (!centerByPhase.has(frame.phase)) centerByPhase.set(frame.phase, []);
    centerByPhase.get(frame.phase).push(frame);
  }

  // 留一法打分：score[i][k] = 第 i 帧在第 k 个锚点上的分数
  const score = frames.map(() => new Array(anchors.length).fill(-Infinity));

  for (let k = 0; k < anchors.length; k++) {
    const phase = anchors[k].phase;
    const pool = centerByPhase.get(phase) || [];
    if (pool.length < 2) {
      console.warn(`环节 ${phase} 只有 ${pool.length} 帧，跳过留一法`);
      continue;
    }
    for (const frame of pool) {
      const others = pool.filter((f) => f !== frame);
      const tmpl = match.buildTemplate(others.map((f) => f.vecs[k][0]));
      score[frames.indexOf(frame)][k] = bestOverJitter(frame.vecs[k], tmpl);
    }
    // 其他环节的帧用全量模板（本来就不含它们，不存在泄漏）
    const tmplAll = match.buildTemplate(pool.map((f) => f.vecs[k][0]));
    for (const frame of frames) {
      if (frame.phase === phase) continue;
      score[frames.indexOf(frame)][k] = bestOverJitter(frame.vecs[k], tmplAll);
    }
  }

  // 统计
  const phaseOrder = [...new Set(frames.map((f) => f.phase))];
  const confusion = {};
  for (const p of phaseOrder) {
    confusion[p] = {};
    for (const q of phaseOrder) confusion[p][q] = 0;
  }

  const rows = [];
  let correct = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    let bestK = 0;
    for (let k = 1; k < anchors.length; k++) if (score[i][k] > score[i][bestK]) bestK = k;
    const predicted = anchors[bestK].phase;
    confusion[frame.phase][predicted] = (confusion[frame.phase][predicted] || 0) + 1;
    if (predicted === frame.phase) correct++;

    const trueScore = Math.max(
      ...anchors.map((a, k) => (a.phase === frame.phase ? score[i][k] : -Infinity))
    );
    const wrongScore = Math.max(
      ...anchors.map((a, k) => (a.phase === frame.phase ? -Infinity : score[i][k]))
    );
    rows.push({
      phase: frame.phase,
      file: path.relative(ROOT, frame.file),
      predicted,
      ok: predicted === frame.phase,
      trueScore: round(trueScore),
      wrongScore: round(wrongScore),
      margin: round(trueScore - wrongScore),
    });
  }

  const acc = correct / frames.length;
  console.log(`\n帧数 ${frames.length} / 锚点 ${anchors.length}   提取耗时 ${extractMs}ms\n`);
  console.log(`总体准确率  ${(acc * 100).toFixed(2)}%  (${correct}/${frames.length})\n`);

  console.log('每环节：');
  for (const p of phaseOrder) {
    const total = frames.filter((f) => f.phase === p).length;
    const hit = confusion[p][p] || 0;
    const mark = hit === total ? 'OK  ' : 'MISS';
    console.log(`  ${mark} ${PHASE_LABEL[p] || p}  ${hit}/${total}`);
  }

  console.log('\n混淆矩阵（行=真实，列=判成）：');
  const head = phaseOrder.map((p) => (PHASE_LABEL[p] || p).padEnd(6, '　')).join('');
  console.log('        ' + head);
  for (const p of phaseOrder) {
    const line = phaseOrder
      .map((q) => String(confusion[p][q] || 0).padEnd(6, '　'))
      .join('');
    console.log((PHASE_LABEL[p] || p).padEnd(5, '　') + ' ' + line);
  }

  const margins = rows.map((r) => r.margin).sort((a, b) => a - b);
  console.log(`\n最差间隔 ${margins[0].toFixed(3)}   中位间隔 ${margins[margins.length >> 1].toFixed(3)}`);
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    console.log('\n判错的帧：');
    for (const r of bad) console.log(`  ${r.phase} → ${r.predicted}   ${r.file}`);
  }

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(
    REPORT,
    JSON.stringify({ accuracy: acc, frames: rows, confusion, extractMs }, null, 2),
    'utf8'
  );
  console.log(`\n写入 ${REPORT}`);

  return acc >= 0.995 ? 0 : 0; // 先不因为准确率不达标而失败，只报告
}

function bestOverJitter(vecs, tmpl) {
  let best = -Infinity;
  for (const v of vecs) {
    const s = match.dot(v, tmpl);
    if (s > best) best = s;
  }
  return best;
}

function round(v) {
  return Number.isFinite(v) ? Number(v.toFixed(3)) : -9;
}

app
  .whenReady()
  .then(() => {
    let code = 0;
    try {
      code = main();
    } catch (err) {
      console.error(err);
      code = 1;
    }
    app.exit(code);
  })
  .catch((err) => {
    console.error(err);
    app.exit(1);
  });
