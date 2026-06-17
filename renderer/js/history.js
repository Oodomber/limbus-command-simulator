/**
 * history.js — History page renderer logic.
 */

const PHASE_NAMES = {
  deploy_identity: '编队(人格)',
  deploy_ego: '编队(EGO)',
  starlight: '星光',
  starting_relic: '开局饰品',
  cardpack: '卡包',
  route: '路线',
  combat: '战斗',
  event: '事件',
  shop: '商店',
  hidden_boss: '隐藏BOSS',
};

const RESULT_NAMES = {
  completed: '✓ 完成',
  failed: '✗ 失败',
};

async function loadHistory() {
  const listEl = document.getElementById('history-list');
  const history = await window.electronAPI.getInstructionHistory();

  if (!history || history.length === 0) {
    listEl.innerHTML = '<p class="empty">暂无指令历史记录</p>';
    return;
  }

  listEl.innerHTML = history.map(item => {
    const resultClass = item.result === 'completed' ? 'completed' : 'failed';
    const resultText = RESULT_NAMES[item.result] || item.result;
    const phaseName = PHASE_NAMES[item.phase] || item.phase;
    const time = new Date(item.timestamp).toLocaleString('zh-CN');

    return `
      <div class="history-item ${resultClass}">
        <div class="time">${time} <span class="phase">[${phaseName}]</span></div>
        <div class="text">${escapeHtml(item.text)}</div>
        <div class="result">${resultText}</div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Load history on page ready
document.addEventListener('DOMContentLoaded', loadHistory);
