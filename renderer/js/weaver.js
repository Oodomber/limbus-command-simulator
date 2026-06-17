/**
 * weaver.js — 编织器：展示每条指令的生成参数与决策链
 */

const elLog = document.getElementById('wv-log');
const elClear = document.getElementById('wv-clear');
const elPause = document.getElementById('wv-pause');
const elClose = document.getElementById('wv-close');

let paused = false;
let lastPhase = null;

document.addEventListener('DOMContentLoaded', () => {
  try {
    if (!window.api || !window.api.onWeaverEvent) {
      elLog.innerHTML = '<div style="color:#c44;padding:10px;">❌ API 不可用</div>';
      return;
    }
    window.api.onWeaverEvent((data) => { if (!paused) addEntry(data); });
    addEntry({
      phase: 'init', phaseLabel: '编织器就绪', text: '等待指令…',
      timestamp: Date.now(),
      debugTrace: [{ step: '系统', detail: '监听 weaver:event' }],
    });
  } catch (e) {
    elLog.innerHTML = '<div style="color:#c44;padding:10px;">❌ ' + esc(String(e)) + '</div>';
  }
});

function addEntry(data) {
  const time = new Date(data.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
  const meta = data.meta || {};
  const isFirst = !!data.debugTrace;

  // ── Separator between phases ──
  if (isFirst && lastPhase && lastPhase !== data.phase) {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px dashed #3a3a5a;margin:6px 0;';
    elLog.appendChild(sep);
  }
  lastPhase = data.phase;

  const entry = document.createElement('div');
  entry.className = 'wv-entry';

  // ── Params line: build dynamically ──
  const params = [];
  if (data.infoCompleteness !== undefined && data.infoCompleteness !== null)
    params.push(`IC=${data.infoCompleteness.toFixed(2)}`);
  if (data.rationality !== undefined && data.rationality !== null) {
    const cls = data.isRational ? 'green' : (data.rationality < 0.25 ? 'red' : '');
    params.push(`R=<span class="${cls}">${data.rationality.toFixed(2)}</span>`);
  }
  if (data.currentFloor)
    params.push(`第${data.currentFloor}层`);

  // Floor for cardpack
  const phaseLabel = data.phaseLabel || data.phase;
  const floorInfo = data.phase === 'cardpack' ? ` (第${data.currentFloor || '?'}层)` : '';

  entry.innerHTML = `
    <div class="wv-header-line">
      <span class="wv-time">${time}</span>
      <span class="wv-phase">[${phaseLabel}${floorInfo}]</span>
      ${params.length > 0 ? '<span class="wv-params">' + params.join(' ') + '</span>' : ''}
    </div>
    <div class="wv-text">▸ ${esc(data.text)}</div>
    ${renderMeta(meta, data)}
    ${isFirst && data.debugTrace ? renderTrace(data.debugTrace) : ''}
  `;

  // Show core mechanics on FIRST instruction of deploy_identity batch
  if (isFirst && data.phase === 'deploy_identity' && data.coreMechanics && data.coreMechanics.length > 0) {
    const sep = document.createElement('div');
    const count = data.coreMechanics.length;
    const text = count >= 5 ? `★ 核心效果(≥5): ${data.coreMechanics.join(', ')}`
      : `★ 核心效果(最高频): ${data.coreMechanics.join(', ')}`;
    sep.className = 'wv-core';
    sep.innerHTML = text;
    entry.querySelector('.wv-header-line').after(sep);
  }

  elLog.appendChild(entry);
  elLog.scrollTop = elLog.scrollHeight;
  while (elLog.children.length > 250) elLog.removeChild(elLog.firstChild);
}

function renderMeta(meta, data) {
  const bits = [];
  if (meta.sinner) bits.push(`罪人:${meta.sinner}`);
  if (meta.position) bits.push(`位置:${meta.position}`);
  if (meta.category) bits.push(`类型:${meta.category.replace('combat_','')}`);
  if (meta.shopAction) bits.push(`操作:${meta.shopAction.replace('shop_','')}`);
  if (meta.optionLabel) bits.push(`选项:${meta.optionLabel}`);
  if (meta.optionCount) bits.push(`(${meta.optionCount}选${meta.optionNum})`);
  if (meta.cardCount) bits.push(`${meta.cardCount}张卡`);
  if (meta.targets) bits.push(`目标:${meta.targets.join(',')}`);
  if (data.coreMechanics) bits.push(`核心效果:${data.coreMechanics.join(',')}`);
  if (meta.isReroll) bits.push('刷新');
  if (meta.isHardMode !== undefined) bits.push(meta.isHardMode ? '困难' : '普通');
  return bits.length > 0 ? `<div class="wv-meta">${bits.join(' | ')}</div>` : '';
}

function renderTrace(trace) {
  if (!trace || trace.length === 0) return '';
  return '<div class="wv-trace-block">' +
    trace.map(t => `<div class="wv-trace">↳ <b>${esc(t.step)}</b>: ${esc(t.detail)}</div>`).join('') +
    '</div>';
}

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

elClear.addEventListener('click', () => { elLog.innerHTML = ''; lastPhase = null; });
elPause.addEventListener('click', () => {
  paused = !paused; elPause.classList.toggle('paused', paused);
  elPause.textContent = paused ? '▶' : '⏯';
});
elClose.addEventListener('click', async () => {
  try { await window.api.invoke('weaver:close'); } catch { window.close(); }
});
