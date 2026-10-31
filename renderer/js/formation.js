/**
 * formation.js — 编队排序：上6下6 + 证件照
 * - 12罪人按默认顺序固定分为上下两排（各6人）
 * - 点击未编号罪人 → 分配下一个序号 (1→12)
 * - 点击已编号罪人 → 取消，后方序号自动前移
 * - 证件照：resources/images/refs/sinners/证件照ver3-NN.png
 */

const SINNERS = [
  '李箱', '浮士德', '堂吉诃德', '良秀', '默尔索', '鸿璐',
  '希斯克利夫', '以实玛利', '罗佳', '辛克莱', '奥提斯', '格里高尔'
];

// Top row = first 6, bottom row = last 6
const TOP_SINNERS = SINNERS.slice(0, 6);
const BOTTOM_SINNERS = SINNERS.slice(6, 12);

// Portrait image base path (relative to renderer/formation.html)
const PORTRAIT_BASE = '../resources/images/refs/sinners/证件照ver3-';

function getPortraitSrc(sinnerIndex) {
  const num = String(sinnerIndex + 1).padStart(2, '0');
  return encodeURI(PORTRAIT_BASE + num + '.png');
}

let formation = []; // array of sinner names in order (length = number assigned)

const elTop = document.getElementById('fm-slots-top');
const elBottom = document.getElementById('fm-slots-bottom');
const elStatus = document.getElementById('fm-status');
const elSave = document.getElementById('fm-save');
const elReset = document.getElementById('fm-reset');
const elClose = document.getElementById('fm-close');

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const result = await window.api.invoke('formation:get');
    if (result && result.formation && result.formation.length > 0) {
      formation = result.formation.filter(s => SINNERS.includes(s));
    }
  } catch (e) { /* use empty */ }
  render();
});

function isAssigned(sinner) { return formation.includes(sinner); }
function positionOf(sinner) { return formation.indexOf(sinner) + 1; }

function createSinnerCard(sinner, index) {
  const card = document.createElement('div');
  const assigned = isAssigned(sinner);
  const pos = positionOf(sinner);

  card.className = 'fm-sinner' + (assigned ? ' selected' : '');
  card.title = assigned ? `${sinner} — 第${pos}位（点击取消）` : `${sinner}（点击编号）`;

  // Portrait
  const wrap = document.createElement('div');
  wrap.className = 'fm-portrait-wrap';

  const img = document.createElement('img');
  img.src = getPortraitSrc(index);
  img.alt = sinner;
  img.draggable = false;
  // Fallback on image load error
  img.onerror = () => {
    img.style.display = 'none';
    wrap.style.background = '#2a2a3a';
    const fallback = document.createElement('span');
    fallback.textContent = '?';
    fallback.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;color:#555;';
    wrap.appendChild(fallback);
  };
  wrap.appendChild(img);

  // Golden number overlay (only visible when assigned)
  if (assigned) {
    const overlay = document.createElement('div');
    overlay.className = 'fm-pos-overlay';
    overlay.textContent = pos;
    wrap.appendChild(overlay);
  }

  card.appendChild(wrap);

  // Click handler
  card.addEventListener('click', () => {
    if (assigned) {
      // Remove and shift later numbers forward
      formation = formation.filter(s => s !== sinner);
    } else {
      // Assign next available number
      formation.push(sinner);
    }
    render();
  });

  return card;
}

function render() {
  elTop.innerHTML = '';
  elBottom.innerHTML = '';

  TOP_SINNERS.forEach((sinner, i) => {
    elTop.appendChild(createSinnerCard(sinner, i));
  });

  BOTTOM_SINNERS.forEach((sinner, i) => {
    elBottom.appendChild(createSinnerCard(sinner, i + 6));
  });

  elSave.disabled = formation.length === 0;
}

elSave.addEventListener('click', async () => {
  if (formation.length === 0) {
    elStatus.textContent = '请至少编入1名罪人';
    return;
  }
  try {
    await window.api.invoke('formation:set', formation);
    elStatus.textContent = '✓ 已保存 (' + formation.length + '人)';
    setTimeout(() => { elStatus.textContent = ''; }, 2000);
  } catch (e) {
    elStatus.textContent = '✗ 保存失败';
  }
});

elReset.addEventListener('click', () => {
  formation = [];
  render();
  elStatus.textContent = '↺ 已清空';
  setTimeout(() => { elStatus.textContent = ''; }, 1500);
});

elClose.addEventListener('click', async () => {
  try { await window.api.invoke('formation:close-window'); }
  catch { window.close(); }
});
