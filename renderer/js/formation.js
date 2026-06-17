/**
 * formation.js — 编队排序：点击选号
 * - 点击未编号罪人 → 分配下一个序号
 * - 点击已编号罪人 → 取消，后方序号自动前移
 * - 至少需要1人
 */

const SINNERS = [
  '李箱', '浮士德', '堂吉诃德', '良秀', '默尔索', '鸿璐',
  '希斯克利夫', '以实玛利', '罗佳', '辛克莱', '奥提斯', '格里高尔'
];

let formation = []; // array of sinner names in order (length = number assigned)

const elAll = document.getElementById('fm-slots-all');
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

function render() {
  elAll.innerHTML = '';

  SINNERS.forEach(sinner => {
    const card = document.createElement('div');
    const assigned = isAssigned(sinner);
    const pos = positionOf(sinner);

    card.className = 'fm-sinner' + (assigned ? ' selected' : '');
    card.innerHTML = assigned
      ? `<span class="fm-pos">${pos}</span><span class="fm-name">${sinner}</span>`
      : `<span class="fm-pos empty">-</span><span class="fm-name dim">${sinner}</span>`;

    card.addEventListener('click', () => {
      if (assigned) {
        // Remove and shift
        formation = formation.filter(s => s !== sinner);
      } else {
        // Assign next number
        formation.push(sinner);
      }
      render();
    });

    elAll.appendChild(card);
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
