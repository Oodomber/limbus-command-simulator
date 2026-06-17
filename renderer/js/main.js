/**
 * main.js — Main control panel renderer logic.
 */

// ── State ──
let runActive = false;
let identities = [];
let egos = [];
let ownedIdentities = new Set();
let ownedEgos = new Set();
let identityPools = [];
let egoPools = [];
let logoClickCount = 0;
let logoClickTimer = null;
let editingPool = null;       // Identity pool being edited
let editingEgoPool = null;    // EGO pool being edited
let runPhase = null;          // Current run phase
let isDungeonPhase = false;   // Whether in free-choice dungeon phase
let showCoreMechanic = false; // Dev toggle: show team core mechanism
let instructionPending = false; // Lock request button until current instruction done

// In-game sinner order (01-12)
const SINNER_ORDER = [
  '李箱', '浮士德', '堂吉诃德', '良秀', '默尔索', '鸿璐',
  '希斯克利夫', '以实玛利', '罗佳', '辛克莱', '奥提斯', '格里高尔'
];

// ── DOM refs ──
const btnStartRun = document.getElementById('btn-start-run');
const btnManualInstruct = document.getElementById('btn-manual-instruct');
const runStats = document.getElementById('run-stats');
const runActions = document.getElementById('run-actions');
const statBlessing = document.getElementById('stat-blessing');
const statKarma = document.getElementById('stat-karma');
const fingerLogo = document.getElementById('finger-logo');

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  await loadInitialData();
  setupNavigation();
  setupRunControls();
  setupShortcuts();
  setupDevEntry();
  setupSettings();
  setupAchievementListener();
  setupMainSound();
});

// ── Main window sound playback ──
function setupMainSound() {
  window.electronAPI.onPlaySound((name) => {
    const id = 'sfx-' + name.replace(/_/g, '-');
    const el = document.getElementById(id);
    if (el) { el.currentTime = 0; el.play().catch(() => {}); }
  });
}

// ── Data Loading ──
async function loadInitialData() {
  try {
    [identities, egos] = await Promise.all([
      window.electronAPI.loadData('identities'),
      window.electronAPI.loadData('egos'),
    ]);

    const config = await window.electronAPI.getConfig();
    ownedIdentities = new Set(config.ownedIdentities || []);
    ownedEgos = new Set(config.ownedEgos || []);
    identityPools = config.identityPools || [];
    egoPools = config.egoPools || [];
    showCoreMechanic = config.settings?.showCoreMechanic || false;

    // Render
    renderIdentityTable();
    renderEgoTable();
    renderPhaseCheckboxes(config.enabledPhases || []);
    renderPoolSelector();
    renderEgoPoolSelector();
    renderPoolList();
    renderEgoPoolList();
    updateCounts();
    updateGlobalStats(config);
    populateFilters();
    loadSettings(config);
  } catch (err) {
    console.error('Failed to load initial data:', err);
  }
}

// ── Navigation ──
function setupNavigation() {
  document.querySelectorAll('.nav-items li').forEach(li => {
    li.addEventListener('click', () => {
      document.querySelectorAll('.nav-items li').forEach(l => l.classList.remove('active'));
      li.classList.add('active');

      const tab = li.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById(`panel-${tab}`);
      if (panel) panel.classList.add('active');

      // Refresh panels on switch
      if (tab === 'achievements') renderAchievements();
    });
  });
}

// ── Identity Helpers ──
function getFilteredIdentities() {
  const sinner = document.getElementById('filter-sinner')?.value || 'all';
  const rarity = document.getElementById('filter-rarity')?.value || 'all';
  const effect = document.getElementById('filter-effect')?.value || 'all';

  let filtered = identities;
  if (sinner !== 'all') filtered = filtered.filter(i => i.sinner === sinner);
  if (rarity !== 'all') filtered = filtered.filter(i => i.rarity === rarity);
  if (effect !== 'all') filtered = filtered.filter(i => (i.tags?.effect || []).includes(effect));
  return filtered;
}

// ── Identity Table ──
function renderIdentityTable() {
  const tbody = document.getElementById('identity-tbody');
  const filtered = getFilteredIdentities();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">无匹配数据</td></tr>';
    return;
  }

  // Determine checkbox state based on mode
  const checkedSet = editingPool
    ? new Set(editingPool.items)  // Pool edit mode: show pool items
    : ownedIdentities;            // Normal mode: show owned

  tbody.innerHTML = filtered.map(i => {
    const checked = checkedSet.has(i.id);
    const tags = [
      ...(i.tags?.faction || []).slice(0, 1),
      ...(i.tags?.effect || []).slice(0, 2),
      ...(i.tags?.damageType || []).slice(0, 1),
    ];
    return `
      <tr>
        <td class="col-owned">
          <input type="checkbox" class="owned-checkbox" data-type="identity" data-id="${i.id}" ${checked ? 'checked' : ''}>
        </td>
        <td class="col-name" title="${i.id}">${escapeHtml(i.name)}</td>
        <td class="col-sinner">${escapeHtml(i.sinner)}</td>
        <td class="col-rarity">${escapeHtml(i.rarity)}</td>
        <td class="col-tags"><div class="tag-list">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></td>
      </tr>
    `;
  }).join('');

  // Bind checkbox toggles
  tbody.querySelectorAll('.owned-checkbox').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      if (editingPool) {
        // Pool edit mode: modify pool items
        if (e.target.checked) {
          editingPool.items.push(id);
        } else {
          editingPool.items = editingPool.items.filter(x => x !== id);
        }
        updatePoolEditBar();
      } else {
        // Normal mode: modify owned set
        if (e.target.checked) {
          ownedIdentities.add(id);
        } else {
          ownedIdentities.delete(id);
        }
        await window.electronAPI.setConfig('ownedIdentities', [...ownedIdentities]).catch(() => {});
        updateCounts();
      }
    });
  });
}

// ── EGO Helpers ──
function getFilteredEgos() {
  const sinner = document.getElementById('filter-ego-sinner')?.value || 'all';
  const level = document.getElementById('filter-ego-level')?.value || 'all';

  let filtered = egos;
  if (sinner !== 'all') filtered = filtered.filter(e => e.sinner === sinner);
  if (level !== 'all') filtered = filtered.filter(e => e.level === level);
  return filtered;
}

// ── EGO Table ──
function renderEgoTable() {
  const tbody = document.getElementById('ego-tbody');
  const filtered = getFilteredEgos();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading">无匹配数据</td></tr>';
    return;
  }

  const egoCheckedSet = editingEgoPool
    ? new Set(editingEgoPool.items)
    : ownedEgos;

  tbody.innerHTML = filtered.map(e => {
    const checked = egoCheckedSet.has(e.id);
    const dmgTypes = (e.tags?.damageType || []).slice(0, 3);
    const sinCost = e.sinCost ? Object.entries(e.sinCost).map(([k, v]) => `${k}×${v}`).join(' ') : '';
    return `
      <tr>
        <td class="col-owned">
          <input type="checkbox" class="owned-checkbox" data-type="ego" data-id="${e.id}" ${checked ? 'checked' : ''}>
        </td>
        <td class="col-name" title="${e.id}">${escapeHtml(e.name)}${e.isBaseEgo ? ' ⭐' : ''}</td>
        <td class="col-sinner">${escapeHtml(e.sinner)}</td>
        <td class="col-rarity">${escapeHtml(e.level)}</td>
        <td class="col-tags">
          <div class="tag-list">${dmgTypes.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
          ${sinCost ? `<small style="color:#888">${escapeHtml(sinCost)}</small>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.owned-checkbox').forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      if (editingEgoPool) {
        if (e.target.checked) {
          editingEgoPool.items.push(id);
        } else {
          editingEgoPool.items = editingEgoPool.items.filter(x => x !== id);
        }
        if (document.getElementById('ego-pool-edit-label')) {
          document.getElementById('ego-pool-edit-label').textContent = `编辑池: ${editingEgoPool.name} (${editingEgoPool.items.length}个)`;
        }
      } else {
        if (e.target.checked) {
          ownedEgos.add(id);
        } else {
          ownedEgos.delete(id);
        }
        await window.electronAPI.setConfig('ownedEgos', [...ownedEgos]).catch(() => {});
        updateCounts();
      }
    });
  });
}

// ── Filters ──
function populateFilters() {
  // Sort sinners by game order (01-12)
  const sinnerSet = new Set(identities.map(i => i.sinner));
  const sinners = SINNER_ORDER.filter(s => sinnerSet.has(s));

  const sinnerSelect = document.getElementById('filter-sinner');
  const egoSinnerSelect = document.getElementById('filter-ego-sinner');

  sinners.forEach((s, idx) => {
    const label = `${String(idx + 1).padStart(2, '0')}. ${s}`;
    sinnerSelect.innerHTML += `<option value="${escapeHtml(s)}">${label}</option>`;
    egoSinnerSelect.innerHTML += `<option value="${escapeHtml(s)}">${label}</option>`;
  });

  document.getElementById('filter-sinner').addEventListener('change', renderIdentityTable);
  document.getElementById('filter-rarity').addEventListener('change', renderIdentityTable);
  document.getElementById('filter-effect').addEventListener('change', renderIdentityTable);
  document.getElementById('filter-ego-sinner').addEventListener('change', renderEgoTable);
  document.getElementById('filter-ego-level').addEventListener('change', renderEgoTable);

  // Select all / none / invert buttons (operate on currently filtered list)
  document.getElementById('btn-identity-sel-all').addEventListener('click', async () => {
    const filtered = getFilteredIdentities();
    if (editingPool) {
      const existing = new Set(editingPool.items);
      filtered.forEach(i => existing.add(i.id));
      editingPool.items = [...existing];
      renderIdentityTable();
      updatePoolEditBar();
    } else {
      filtered.forEach(i => ownedIdentities.add(i.id));
      await window.electronAPI.setConfig('ownedIdentities', [...ownedIdentities]).catch(() => {});
      renderIdentityTable();
      updateCounts();
    }
  });
  document.getElementById('btn-identity-sel-none').addEventListener('click', async () => {
    const filtered = getFilteredIdentities();
    if (editingPool) {
      const fSet = new Set(filtered.map(i => i.id));
      editingPool.items = editingPool.items.filter(x => !fSet.has(x));
      renderIdentityTable();
      updatePoolEditBar();
    } else {
      filtered.forEach(i => ownedIdentities.delete(i.id));
      await window.electronAPI.setConfig('ownedIdentities', [...ownedIdentities]).catch(() => {});
      renderIdentityTable();
      updateCounts();
    }
  });
  document.getElementById('btn-identity-sel-invert').addEventListener('click', async () => {
    const filtered = getFilteredIdentities();
    if (editingPool) {
      const poolSet = new Set(editingPool.items);
      filtered.forEach(i => {
        if (poolSet.has(i.id)) editingPool.items = editingPool.items.filter(x => x !== i.id);
        else editingPool.items.push(i.id);
      });
      renderIdentityTable();
      updatePoolEditBar();
    } else {
      filtered.forEach(i => {
        if (ownedIdentities.has(i.id)) ownedIdentities.delete(i.id);
        else ownedIdentities.add(i.id);
      });
      await window.electronAPI.setConfig('ownedIdentities', [...ownedIdentities]).catch(() => {});
      renderIdentityTable();
      updateCounts();
    }
  });

  const doEgoSelAll = async () => {
    const filtered = getFilteredEgos();
    if (editingEgoPool) {
      const existing = new Set(editingEgoPool.items);
      filtered.forEach(e => existing.add(e.id));
      editingEgoPool.items = [...existing];
      renderEgoTable();
    } else {
      filtered.forEach(e => ownedEgos.add(e.id));
      await window.electronAPI.setConfig('ownedEgos', [...ownedEgos]).catch(() => {});
      renderEgoTable();
      updateCounts();
    }
  };
  const doEgoSelNone = async () => {
    const filtered = getFilteredEgos();
    if (editingEgoPool) {
      const fSet = new Set(filtered.map(e => e.id));
      editingEgoPool.items = editingEgoPool.items.filter(x => !fSet.has(x));
      renderEgoTable();
    } else {
      filtered.forEach(e => ownedEgos.delete(e.id));
      await window.electronAPI.setConfig('ownedEgos', [...ownedEgos]).catch(() => {});
      renderEgoTable();
      updateCounts();
    }
  };
  const doEgoSelInvert = async () => {
    const filtered = getFilteredEgos();
    if (editingEgoPool) {
      const s = new Set(editingEgoPool.items);
      filtered.forEach(e => { if (s.has(e.id)) editingEgoPool.items = editingEgoPool.items.filter(x => x !== e.id); else editingEgoPool.items.push(e.id); });
      renderEgoTable();
    } else {
      filtered.forEach(e => { if (ownedEgos.has(e.id)) ownedEgos.delete(e.id); else ownedEgos.add(e.id); });
      await window.electronAPI.setConfig('ownedEgos', [...ownedEgos]).catch(() => {}); renderEgoTable(); updateCounts();
    }
  };
  document.getElementById('btn-ego-sel-all').addEventListener('click', doEgoSelAll);
  document.getElementById('btn-ego-sel-none').addEventListener('click', doEgoSelNone);
  document.getElementById('btn-ego-sel-invert').addEventListener('click', doEgoSelInvert);

  // EGO pool buttons
  document.getElementById('btn-new-ego-pool')?.addEventListener('click', () => {
    if (editingEgoPool) { alert('请先保存或取消当前EGO池编辑'); return; }
    const checked = egos.filter(e => ownedEgos.has(e.id));
    if (checked.length === 0) { alert('请先在表格中勾选至少一个EGO'); return; }
    showPoolNameModal(async (name) => {
      if (!name) return;
      const pools = [...egoPools];
      if (pools.find(p => p.name === name)) { alert('该名称已存在'); return; }
      pools.push({ name, items: checked.map(e => e.id) });
      await window.electronAPI.setConfig('egoPools', pools);
      egoPools = pools;
      renderEgoPoolSelector();
      renderEgoPoolList();
      showToast('✅', `EGO池「${name}」已创建 (${checked.length}个)`);
    }, 'ego');
  });

  document.getElementById('btn-edit-ego-pool')?.addEventListener('click', () => {
    if (editingEgoPool) { cancelEgoPoolEdit(); return; }
    if (egoPools.length === 0) { alert('暂无EGO池，请先创建'); return; }
    showEgoPoolPickerModal();
  });

  document.getElementById('btn-ego-pool-save')?.addEventListener('click', saveEgoPoolEdit);
  document.getElementById('btn-ego-pool-cancel')?.addEventListener('click', cancelEgoPoolEdit);
}

function updateCounts() {
  document.getElementById('identity-count').textContent = `${ownedIdentities.size}/${identities.length}`;
  document.getElementById('ego-count').textContent = `${ownedEgos.size}/${egos.length}`;
}

function updateGlobalStats(config) {
  const stats = config?.globalStats || {};
  document.getElementById('global-blessing').textContent = stats.totalBlessing || 0;
  document.getElementById('global-karma').textContent = stats.totalKarma || 0;
}

async function refreshGlobalStats() {
  const config = await window.electronAPI.getConfig();
  updateGlobalStats(config);
}

// ── Phase Checkboxes ──
async function renderPhaseCheckboxes(enabledPhases) {
  const phases = [
    { id: 'deploy_identity', name: '编队（人格）', desc: '指引，无需确认' },
    { id: 'deploy_ego', name: '编队（EGO）', desc: '指引，无需确认' },
    { id: 'starlight', name: '星光选择', desc: '' },
    { id: 'starting_relic', name: '开局饰品', desc: '' },
    { id: 'cardpack', name: '卡包选择', desc: '' },
    { id: 'route', name: '路线选择', desc: '' },
    { id: 'combat', name: '战斗操作', desc: '' },
    { id: 'event', name: '事件', desc: '' },
    { id: 'event_reward', name: '奖励卡', desc: '遭遇战后奖励卡选择' },
    { id: 'judgment', name: '判定环节', desc: '随机选取罪人' },
    { id: 'shop', name: '商店', desc: '' },
    { id: 'hidden_boss', name: '隐藏BOSS', desc: '' },
    { id: 'boss_reward', name: '关底选择', desc: '普通3选1/困难4选2' },
  ];

  const container = document.getElementById('phase-checkboxes');
  container.innerHTML = phases.map(p => `
    <label class="phase-item">
      <input type="checkbox" data-phase="${p.id}" ${enabledPhases.includes(p.id) ? 'checked' : ''}>
      <span class="phase-name">${p.name}</span>
      ${p.desc ? `<span class="phase-desc">${p.desc}</span>` : ''}
    </label>
  `).join('');

  // Bind changes
  container.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', async () => {
      const enabled = [...container.querySelectorAll('input:checked')].map(i => i.dataset.phase);
      await window.electronAPI.setConfig('enabledPhases', enabled);
    });
  });
}

// ── Pool Selector ──
function renderPoolSelector() {
  const select = document.getElementById('active-pool');
  const currentVal = select.value;
  select.innerHTML = '<option value="">无</option>' +
    identityPools.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.items.length})</option>`).join('');
  if (currentVal && identityPools.some(p => p.name === currentVal)) {
    select.value = currentVal;
  }
  // Remove old listener by cloning
  const newSelect = select.cloneNode(true);
  select.parentNode.replaceChild(newSelect, select);
  newSelect.addEventListener('change', async (e) => {
    await window.electronAPI.setConfig('activePool', e.target.value || null);
  });
}

function renderPoolList() {
  const container = document.getElementById('pool-list');
  if (!container) return;
  if (identityPools.length === 0) {
    container.innerHTML = '<span style="color:#444;font-size:0.75em;padding-top:3px;">(暂无池)</span>';
    return;
  }
  container.innerHTML = identityPools.map(p => `
    <span class="pool-tag" data-pool="${escapeHtml(p.name)}"
          style="display:inline-flex;align-items:center;gap:3px;padding:3px 9px;
                 background:#1a1a3e;border:1px solid #2a2a4a;border-radius:12px;
                 cursor:pointer;font-size:0.78em;color:#bbb;transition:all 0.2s;white-space:nowrap;"
          onmouseenter="this.style.borderColor='#ffd700';this.style.background='#222250';"
          onmouseleave="this.style.borderColor='#2a2a4a';this.style.background='#1a1a3e';"
          title="点击加载此池的勾选 | ${p.items.length}人">
      ${escapeHtml(p.name)}
      <span style="color:#777;font-size:0.7em;background:#0f0f23;padding:1px 5px;border-radius:7px;">${p.items.length}</span>
    </span>
  `).join('');

  container.querySelectorAll('.pool-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const poolName = tag.dataset.pool;
      const pool = identityPools.find(p => p.name === poolName);
      if (!pool) return;
      // Cancel any ongoing edit first
      if (editingPool) cancelPoolEdit();
      // Direct load: replace checkboxes with pool items
      ownedIdentities = new Set(pool.items);
      window.electronAPI.setConfig('ownedIdentities', [...ownedIdentities]).catch(() => {});
      renderIdentityTable();
      updateCounts();
      document.getElementById('active-pool').value = poolName;
      showToast('✅', `已加载池「${poolName}」(${pool.items.length}人)`);
    });
  });
}

function startPoolEdit(pool) {
  editingPool = pool;
  document.getElementById('active-pool').value = pool.name;
  document.getElementById('pool-edit-bar').classList.remove('hidden');
  document.getElementById('pool-edit-label').textContent = `编辑池: ${pool.name} (${pool.items.length}个)`;
  document.getElementById('btn-new-pool').classList.add('hidden');
  document.getElementById('btn-edit-pool').classList.add('hidden');
  renderIdentityTable();
}

function cancelPoolEdit() {
  editingPool = null;
  document.getElementById('pool-edit-bar').classList.add('hidden');
  document.getElementById('btn-new-pool').classList.remove('hidden');
  document.getElementById('btn-edit-pool').classList.remove('hidden');
  document.getElementById('active-pool').value = '';
  renderIdentityTable();
}

async function savePoolEdit() {
  if (!editingPool) return;
  // Deduplicate
  editingPool.items = [...new Set(editingPool.items)];
  await window.electronAPI.setConfig('identityPools', identityPools).catch(() => {});
  renderPoolSelector();
  renderPoolList();
  showToast('✅', `池「${escapeHtml(editingPool.name)}」已保存 (${editingPool.items.length}个)`);
  cancelPoolEdit();
}

function updatePoolEditBar() {
  if (editingPool) {
    document.getElementById('pool-edit-label').textContent = `编辑池: ${editingPool.name} (${editingPool.items.length}个)`;
  }
}

// ── Run Controls ──
function setupRunControls() {
  btnStartRun.addEventListener('click', async () => {
    if (!runActive) {
      // Check phases enabled
      const config = await window.electronAPI.getConfig();
      const enabled = config.enabledPhases || [];
      if (enabled.length === 0) {
        alert('请先在"环节启用"中勾选至少一个环节。');
        return;
      }

      // Show pool selection modal before starting
      showRunStartModal();
    } else {
      if (confirm('确定要结束此次镜牢的指令指引吗？')) {
        const result = await window.electronAPI.endRun();
        if (result.success) {
          setRunActive(false);
        }
      }
    }
  });

  btnManualInstruct.addEventListener('click', requestManualInstruction);

  // Milestone buttons
  document.getElementById('btn-milestone-clear').addEventListener('click', async () => {
    await window.electronAPI.recordMilestone('clear');
    showToast('✅', '已记录：镜牢通关');
  });

  document.getElementById('btn-history').addEventListener('click', () => {
    window.electronAPI.openHistoryWindow();
  });

  // New pool button — creates from currently checked (owned) identities
  document.getElementById('btn-new-pool')?.addEventListener('click', () => {
    if (editingPool) {
      alert('请先保存或取消当前池编辑');
      return;
    }
    // Gather checked owned identities
    const checked = identities.filter(i => ownedIdentities.has(i.id));
    if (checked.length === 0) {
      alert('请先在表格中勾选至少一个人格');
      return;
    }
    showPoolNameModal(async (name) => {
      if (!name) return;
      const pools = await window.electronAPI.getConfig('identityPools') || [];
      if (pools.find(p => p.name === name)) {
        alert('该名称已存在');
        return;
      }
      pools.push({ name, items: checked.map(i => i.id) });
      await window.electronAPI.setConfig('identityPools', pools);
      identityPools = pools;
      renderPoolSelector();
      renderPoolList();
      showToast('✅', `池「${name}」已创建 (${checked.length}个人格)`);
    }, 'identity');
  });

  // Edit pool — shows pool list, clicking a pool loads it
  document.getElementById('btn-edit-pool')?.addEventListener('click', () => {
    if (editingPool) {
      cancelPoolEdit();
      return;
    }
    if (identityPools.length === 0) {
      alert('暂无池，请先创建');
      return;
    }
    // Show pool list modal
    showPoolPickerModal();
  });

  // Pool edit bar buttons
  document.getElementById('btn-pool-save')?.addEventListener('click', savePoolEdit);
  document.getElementById('btn-pool-cancel')?.addEventListener('click', cancelPoolEdit);
}

// Pool name input modal
function showPoolNameModal(callback, type) {
  type = type || 'identity';
  const existing = document.getElementById('pool-name-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pool-name-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:24px;min-width:320px;';
  const isEgo = type === 'ego';
  const checkedCount = isEgo
    ? egos.filter(e => ownedEgos.has(e.id)).length
    : identities.filter(i => ownedIdentities.has(i.id)).length;
  const unitName = isEgo ? 'EGO' : '人格';
  box.innerHTML = `
    <h3 style="color:#ffd700;margin:0 0 4px;">📝 新建${unitName}池</h3>
    <p style="color:#aaa;font-size:0.85em;margin:0 0 12px;">将使用当前已勾选的 <b style="color:#ffd700;">${checkedCount}</b> 个${unitName}来创建池</p>
    <input id="pool-name-input" type="text" placeholder="输入池名称"
      style="width:100%;padding:10px;background:#0f0f23;color:#e0e0e0;border:1px solid #3a3a5a;border-radius:6px;font-size:14px;margin-bottom:16px;" autofocus>
    <div style="display:flex;gap:8px;">
      <button id="pool-name-confirm" style="flex:1;padding:10px;background:#ffd700;color:#1a1a2e;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">创建</button>
      <button id="pool-name-cancel" style="flex:1;padding:10px;background:#333;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer;">取消</button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const input = document.getElementById('pool-name-input');
  // Robust focus: try multiple times
  setTimeout(() => { input.focus(); input.select(); }, 50);
  setTimeout(() => { input.focus(); input.select(); }, 150);

  document.getElementById('pool-name-confirm').addEventListener('click', () => {
    overlay.remove();
    callback(input.value.trim());
  });
  document.getElementById('pool-name-cancel').addEventListener('click', () => {
    overlay.remove();
    callback(null);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { overlay.remove(); callback(input.value.trim()); }
    if (e.key === 'Escape') { overlay.remove(); callback(null); }
  });
}

// Pool picker modal — shows list of existing pools with edit/delete
function showPoolPickerModal() {
  const existing = document.getElementById('pool-picker-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pool-picker-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:24px;max-width:450px;width:90%;';
  box.innerHTML = `
    <h3 style="color:#ffd700;margin:0 0 4px;">📋 管理人格池</h3>
    <p style="color:#888;font-size:0.8em;margin:0 0 12px;">点击池名加载其人格 | 使用右侧按钮编辑或删除</p>
    <div style="max-height:320px;overflow-y:auto;">
      ${identityPools.length === 0 ? '<p style="color:#666;text-align:center;padding:20px;">暂无池，请先新建</p>' :
        identityPools.map(p => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <div class="pool-pick-load" data-pool="${escapeHtml(p.name)}"
                 style="flex:1;display:flex;justify-content:space-between;align-items:center;
                        padding:10px 14px;background:#0f0f23;border-radius:6px;cursor:pointer;
                        border:1px solid transparent;"
                 onmouseenter="this.style.borderColor='#ffd700';this.style.background='#1a1a3e'"
                 onmouseleave="this.style.borderColor='transparent';this.style.background='#0f0f23'">
              <span style="color:#e0e0e0;font-weight:bold;">${escapeHtml(p.name)}</span>
              <span style="color:#888;font-size:0.8em;">${p.items.length}人</span>
            </div>
            <button class="pool-pick-edit" data-pool="${escapeHtml(p.name)}"
                    style="padding:8px 10px;background:#2a2a4a;color:#ffd700;border:1px solid #3a3a5a;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;"
                    onmouseenter="this.style.background='#3a3a5a'" onmouseleave="this.style.background='#2a2a4a'">✏️</button>
            <button class="pool-pick-delete" data-pool="${escapeHtml(p.name)}"
                    style="padding:8px 10px;background:#2a2a4a;color:#f44336;border:1px solid #3a3a5a;border-radius:4px;cursor:pointer;font-size:12px;white-space:nowrap;"
                    onmouseenter="this.style.background='#442222'" onmouseleave="this.style.background='#2a2a4a'">🗑</button>
          </div>
        `).join('')}
    </div>
    <button id="pool-picker-cancel" style="width:100%;margin-top:12px;padding:10px;background:#333;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer;">关闭</button>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Click pool name → load items directly (replace checkboxes)
  box.querySelectorAll('.pool-pick-load').forEach(item => {
    item.addEventListener('click', () => {
      const poolName = item.dataset.pool;
      const pool = identityPools.find(p => p.name === poolName);
      if (!pool) return;
      // Direct replace: set owned checkboxes to match pool items
      ownedIdentities = new Set(pool.items);
      window.electronAPI.setConfig('ownedIdentities', [...ownedIdentities]).catch(() => {});
      renderIdentityTable();
      updateCounts();
      document.getElementById('active-pool').value = poolName;
      overlay.remove();
      showToast('✅', `已加载池「${poolName}」(${pool.items.length}人)`);
    });
  });

  // Edit button → enter edit mode
  box.querySelectorAll('.pool-pick-edit').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const poolName = btn.dataset.pool;
      const pool = identityPools.find(p => p.name === poolName);
      overlay.remove();
      if (pool) startPoolEdit(pool);
    });
  });

  // Delete button → confirm and delete, stays in modal
  box.querySelectorAll('.pool-pick-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const poolName = btn.dataset.pool;
      if (!confirm(`确定要删除池「${poolName}」吗？此操作不可撤销。`)) return;
      identityPools = identityPools.filter(p => p.name !== poolName);
      window.electronAPI.setConfig('identityPools', identityPools).catch(() => {});
      renderPoolSelector();
      renderPoolList();
      if (editingPool && editingPool.name === poolName) cancelPoolEdit();
      // Refresh the pool picker list in-place
      const scrollTop = box.querySelector('div[style*="max-height"]').scrollTop;
      overlay.remove();
      showPoolPickerModal(); // Reopen with fresh list
      showToast('🗑', `池「${poolName}」已删除`);
    });
  });

  document.getElementById('pool-picker-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── EGO Pool Management (mirrors identity pool logic) ──
function renderEgoPoolSelector() {
  const select = document.getElementById('active-ego-pool');
  if (!select) return;
  const cv = select.value;
  select.innerHTML = '<option value="">无</option>' + egoPools.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.items.length})</option>`).join('');
  if (cv && egoPools.some(p => p.name === cv)) select.value = cv;
}

function renderEgoPoolList() {
  const container = document.getElementById('ego-pool-list');
  if (!container) return;
  if (egoPools.length === 0) { container.innerHTML = '<span style="color:#444;font-size:0.75em;padding-top:3px;">(暂无EGO池)</span>'; return; }
  container.innerHTML = egoPools.map(p => `
    <span data-pool="${escapeHtml(p.name)}" style="display:inline-flex;align-items:center;gap:3px;padding:3px 9px;background:#1a1a3e;border:1px solid #2a2a4a;border-radius:12px;cursor:pointer;font-size:0.78em;color:#bbb;transition:all 0.2s;white-space:nowrap;" onmouseenter="this.style.borderColor='#ffd700';this.style.background='#222250'" onmouseleave="this.style.borderColor='#2a2a4a';this.style.background='#1a1a3e'" title="点击加载此池 | ${p.items.length}个">
      ${escapeHtml(p.name)}<span style="color:#777;font-size:0.7em;background:#0f0f23;padding:1px 5px;border-radius:7px;">${p.items.length}</span>
    </span>`).join('');
  container.querySelectorAll('span[data-pool]').forEach(tag => {
    tag.addEventListener('click', () => {
      const pool = egoPools.find(p => p.name === tag.dataset.pool);
      if (!pool) return;
      if (editingEgoPool) cancelEgoPoolEdit();
      ownedEgos = new Set(pool.items);
      window.electronAPI.setConfig('ownedEgos', [...ownedEgos]).catch(() => {});
      renderEgoTable(); updateCounts();
      document.getElementById('active-ego-pool').value = pool.name;
      showToast('✅', `已加载EGO池「${pool.name}」(${pool.items.length}个)`);
    });
  });
}

function startEgoPoolEdit(pool) {
  editingEgoPool = pool;
  document.getElementById('active-ego-pool').value = pool.name;
  document.getElementById('ego-pool-edit-bar').classList.remove('hidden');
  document.getElementById('ego-pool-edit-label').textContent = `编辑EGO池: ${pool.name} (${pool.items.length}个)`;
  document.getElementById('btn-new-ego-pool').classList.add('hidden');
  document.getElementById('btn-edit-ego-pool').classList.add('hidden');
  renderEgoTable();
}
function cancelEgoPoolEdit() {
  editingEgoPool = null;
  document.getElementById('ego-pool-edit-bar').classList.add('hidden');
  document.getElementById('btn-new-ego-pool').classList.remove('hidden');
  document.getElementById('btn-edit-ego-pool').classList.remove('hidden');
  document.getElementById('active-ego-pool').value = '';
  renderEgoTable();
}
async function saveEgoPoolEdit() {
  if (!editingEgoPool) return;
  editingEgoPool.items = [...new Set(editingEgoPool.items)];
  await window.electronAPI.setConfig('egoPools', egoPools);
  renderEgoPoolSelector(); renderEgoPoolList();
  showToast('✅', `EGO池「${editingEgoPool.name}」已保存 (${editingEgoPool.items.length}个)`);
  cancelEgoPoolEdit();
}
function showEgoPoolPickerModal() {
  const existing = document.getElementById('ego-pool-picker-modal');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ego-pool-picker-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:24px;max-width:450px;width:90%;';
  box.innerHTML = `<h3 style="color:#ffd700;margin:0 0 4px;">📋 管理EGO池</h3><p style="color:#888;font-size:0.8em;margin:0 0 12px;">点击池名加载 | ✏️编辑 🗑删除</p>
    <div style="max-height:320px;overflow-y:auto;">${egoPools.length===0?'<p style="color:#666;text-align:center;padding:20px;">暂无EGO池</p>':egoPools.map(p=>`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div data-pool="${escapeHtml(p.name)}" style="flex:1;padding:10px 14px;background:#0f0f23;border-radius:6px;cursor:pointer;border:1px solid transparent;" onmouseenter="this.style.borderColor='#ffd700';this.style.background='#1a1a3e'" onmouseleave="this.style.borderColor='transparent';this.style.background='#0f0f23'"><span style="color:#e0e0e0;font-weight:bold;">${escapeHtml(p.name)}</span> <span style="color:#888;font-size:0.8em;float:right;">${p.items.length}个</span></div>
      <button data-edit="${escapeHtml(p.name)}" style="padding:8px 10px;background:#2a2a4a;color:#ffd700;border:1px solid #3a3a5a;border-radius:4px;cursor:pointer;font-size:12px;" onmouseenter="this.style.background='#3a3a5a'" onmouseleave="this.style.background='#2a2a4a'">✏️</button>
      <button data-delete="${escapeHtml(p.name)}" style="padding:8px 10px;background:#2a2a4a;color:#f44336;border:1px solid #3a3a5a;border-radius:4px;cursor:pointer;font-size:12px;" onmouseenter="this.style.background='#442222'" onmouseleave="this.style.background='#2a2a4a'">🗑</button>
    </div>`).join('')}</div>
    <button id="ego-pool-picker-close" style="width:100%;margin-top:12px;padding:10px;background:#333;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer;">关闭</button>`;
  overlay.appendChild(box); document.body.appendChild(overlay);
  box.querySelectorAll('div[data-pool]').forEach(el => { el.addEventListener('click', () => { const p=egoPools.find(x=>x.name===el.dataset.pool); if(p){ ownedEgos=new Set(p.items); window.electronAPI.setConfig('ownedEgos',[...ownedEgos]); renderEgoTable(); updateCounts(); document.getElementById('active-ego-pool').value=p.name; overlay.remove(); showToast('✅',`已加载EGO池「${p.name}」`); } }); });
  box.querySelectorAll('button[data-edit]').forEach(b => { b.addEventListener('click',(e)=>{ e.stopPropagation(); const p=egoPools.find(x=>x.name===b.dataset.edit); overlay.remove(); if(p) startEgoPoolEdit(p); }); });
  box.querySelectorAll('button[data-delete]').forEach(b => { b.addEventListener('click',(e)=>{ e.stopPropagation(); if(!confirm(`确定删除EGO池「${b.dataset.delete}」？`)) return; egoPools=egoPools.filter(x=>x.name!==b.dataset.delete); window.electronAPI.setConfig('egoPools',egoPools); renderEgoPoolSelector(); renderEgoPoolList(); if(editingEgoPool&&editingEgoPool.name===b.dataset.delete) cancelEgoPoolEdit(); overlay.remove(); showEgoPoolPickerModal(); showToast('🗑',`EGO池已删除`); }); });
  document.getElementById('ego-pool-picker-close').addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',(e)=>{if(e.target===overlay) overlay.remove();});
}

// ── Run Start Modal (select pools) ──
async function showRunStartModal() {
  const existing = document.getElementById('run-start-modal');
  if (existing) existing.remove();

  const config = await window.electronAPI.getConfig();
  const pools = config.identityPools || [];
  const egoPools = config.egoPools || [];

  // No pools at all — prompt to create one
  if (pools.length === 0) {
    alert('请先在人格管理页面创建至少一个人格池。\n\n步骤：\n1. 在人格表格中勾选你拥有的人格\n2. 点击"新建池"按钮创建池');
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'run-start-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:24px;max-width:500px;width:90%;';
  box.innerHTML = `
    <h3 style="color:#ffd700;margin:0 0 4px;">⚔️ 开始镜牢指引</h3>
    <p style="color:#888;font-size:0.85em;margin:0 0 16px;">选择本次使用的人格池（必选）和EGO池（可选）</p>

    <div style="margin-bottom:14px;">
      <label style="color:#ccc;font-weight:bold;display:block;margin-bottom:6px;">人格池: <span style="color:#f44336;">*</span></label>
      <select id="run-pool-select" style="width:100%;padding:8px;background:#0f0f23;color:#e0e0e0;border:1px solid #3a3a5a;border-radius:6px;font-size:14px;">
        <option value="">-- 请选择人格池 --</option>
        ${pools.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.items.length}人)</option>`).join('')}
      </select>
    </div>

    <div style="margin-bottom:16px;">
      <label style="color:#ccc;font-weight:bold;display:block;margin-bottom:6px;">EGO池:</label>
      <select id="run-ego-pool-select" style="width:100%;padding:8px;background:#0f0f23;color:#e0e0e0;border:1px solid #3a3a5a;border-radius:6px;font-size:14px;">
        <option value="">跳过（不指定EGO池）</option>
        ${egoPools.map(p => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.items.length}个)</option>`).join('')}
      </select>
    </div>

    <div style="display:flex;gap:8px;">
      <button id="run-start-confirm" style="flex:1;padding:12px;background:#ffd700;color:#1a1a2e;border:none;border-radius:6px;font-weight:bold;font-size:15px;cursor:pointer;">
        谨遵指令
      </button>
      <button id="run-start-cancel" style="padding:12px 20px;background:#333;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer;">
        取消
      </button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Enable/disable confirm button based on pool selection
  const poolSelect = document.getElementById('run-pool-select');
  const confirmBtn = document.getElementById('run-start-confirm');

  document.getElementById('run-start-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  confirmBtn.addEventListener('click', async () => {
    const poolName = poolSelect.value;
    const egoPoolName = document.getElementById('run-ego-pool-select').value;

    // Validate pool selection
    if (!poolName) {
      alert('请先选择一个人格池。');
      return;
    }
    const pool = pools.find(p => p.name === poolName);
    if (!pool || pool.items.length === 0) {
      alert('所选人格池中没有条目。请先在人格管理中向该池添加至少一个人格。');
      return;
    }

    overlay.remove();

    const result = await window.electronAPI.startRun(poolName, egoPoolName);
    if (result.success) {
      setRunActive(true);
    } else {
      alert(result.error || '启动失败');
    }
  });
}

function setRunActive(active) {
  runActive = active;
  if (active) {
    btnStartRun.textContent = '结束指引';
    btnStartRun.classList.add('running');
    runStats.classList.remove('hidden');
    runActions.classList.remove('hidden');
    btnManualInstruct.classList.remove('hidden');
    // Lock sidebar and tabs
    lockUIForRun();
    // Initialize phase
    updateRunPhase();
  } else {
    btnStartRun.textContent = '谨遵指令';
    btnStartRun.classList.remove('running');
    runStats.classList.add('hidden');
    runActions.classList.add('hidden');
    btnManualInstruct.classList.add('hidden');
    runPhase = null;
    isDungeonPhase = false;
    setInstructionPending(false);
    unlockUIForRun();
  }
}

// ── Run UI Lock ──
function lockUIForRun() {
  // Disable sidebar navigation
  document.querySelectorAll('.nav-items li').forEach(li => {
    li.style.pointerEvents = 'none';
    li.style.opacity = '0.4';
  });
  // Add lock overlay to main content
  let overlay = document.getElementById('run-lock-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'run-lock-overlay';
    overlay.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.3); z-index: 500; pointer-events: none;
      display: flex; align-items: center; justify-content: center;
    `;
    overlay.innerHTML = '<div style="color:#ffd700;font-size:1.4em;text-shadow:0 0 20px rgba(255,215,0,0.5);letter-spacing:4px;animation:pulse 2s infinite;">⚔️ 指引进行中 ⚔️</div>';
    document.getElementById('content').appendChild(overlay);
  }
  overlay.style.display = 'flex';
  // Make run-bar stay above overlay
  document.getElementById('run-bar').style.position = 'relative';
  document.getElementById('run-bar').style.zIndex = '501';
  // Disable filter controls etc inside tab panels
  document.querySelectorAll('.tab-panel input, .tab-panel select, .tab-panel button').forEach(el => {
    if (!el.closest('#run-bar')) {
      el.disabled = true;
    }
  });
}

function unlockUIForRun() {
  document.querySelectorAll('.nav-items li').forEach(li => {
    li.style.pointerEvents = '';
    li.style.opacity = '';
  });
  const overlay = document.getElementById('run-lock-overlay');
  if (overlay) overlay.style.display = 'none';
  document.getElementById('run-bar').style.position = '';
  document.getElementById('run-bar').style.zIndex = '';
  document.querySelectorAll('.tab-panel input, .tab-panel select, .tab-panel button').forEach(el => {
    el.disabled = false;
  });
}

async function updateRunPhase() {
  try {
    const phaseInfo = await window.electronAPI.getRunPhase();
    if (phaseInfo) {
      runPhase = phaseInfo.currentPhase;
      isDungeonPhase = phaseInfo.isDungeon;
    }
  } catch (e) {
    console.error('Failed to get run phase:', e);
  }
}

// ── Manual Instruction Request ──
const PHASE_LIST = [
  { id: 'deploy_identity', label: '编队（人格）', desc: '指引，无需确认' },
  { id: 'deploy_ego', label: '编队（EGO）', desc: '指引，无需确认' },
  { id: 'starlight', label: '星光选择', desc: '' },
  { id: 'starting_relic', label: '开局饰品', desc: '' },
  { id: 'cardpack', label: '卡包选择', desc: '' },
  { id: 'route', label: '路线选择', desc: '' },
  { id: 'combat', label: '战斗操作', desc: '每回合可请求' },
  { id: 'event', label: '事件', desc: '' },
  { id: 'event_reward', label: '奖励卡', desc: '遭遇战后奖励卡' },
  { id: 'judgment', label: '判定环节', desc: '随机选取罪人' },
  { id: 'shop', label: '商店', desc: '' },
  { id: 'hidden_boss', label: '隐藏BOSS', desc: '' },
  { id: 'boss_reward', label: '关底选择', desc: '普通3选1/困难4选2' },
];

function requestManualInstruction() {
  if (!runActive) {
    showToast('⚠️', '请先点击"谨遵指令"开始镜牢');
    return;
  }
  if (instructionPending) {
    showToast('⚠️', '请先在传呼机上完成当前指令');
    return;
  }

  // Show custom phase picker modal
  showPhasePicker();
}

function showPhasePicker() {
  // Remove existing picker if any
  const existing = document.getElementById('phase-picker-overlay');
  if (existing) existing.remove();

  // Determine which phases are available
  let availablePhases;
  if (!runPhase || runPhase === 'deploy_identity') {
    // Only deploy_identity at start
    availablePhases = [PHASE_LIST[0]]; // deploy_identity
  } else if (runPhase === 'starlight') {
    availablePhases = [PHASE_LIST[2]]; // starlight
  } else if (runPhase === 'starting_relic') {
    availablePhases = [PHASE_LIST[3]]; // starting_relic
  } else if (runPhase === 'dungeon' || isDungeonPhase) {
    // Dungeon: cardpack, route, combat, event, judgment, shop, hidden_boss
    availablePhases = PHASE_LIST.slice(4);
  } else {
    // Fallback: show based on phase
    const found = PHASE_LIST.find(p => p.id === runPhase);
    availablePhases = found ? [found] : [PHASE_LIST[0]];
  }

  const overlay = document.createElement('div');
  overlay.id = 'phase-picker-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 10000;
    display: flex; align-items: center; justify-content: center;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1a1a2e; border: 2px solid #ffd700; border-radius: 12px;
    padding: 24px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
  `;

  const phaseLabel = runPhase ? (PHASE_LIST.find(p => p.id === runPhase)?.label || runPhase) : '编队';
  const canSkip = runPhase === 'starting_relic';
  const isDungeon = runPhase === 'dungeon' || isDungeonPhase;

  modal.innerHTML = `
    <h3 style="color:#ffd700; margin:0 0 4px 0; font-size:1.2em;">📟 ${isDungeon ? '选择当前环节' : '当前环节'}</h3>
    <p style="color:#888;font-size:0.85em;margin:0 0 16px;">当前阶段: <b style="color:#ffd700;">${phaseLabel}</b>${isDungeon ? ' — 自由选择' : ''}</p>
    <div style="display:flex; flex-direction:column; gap:6px;" id="phase-picker-list">
      ${availablePhases.map((p, i) => `
        <button class="phase-pick-btn" data-phase="${p.id}"
          style="display:flex; justify-content:space-between; align-items:center;
                 width:100%; padding:10px 14px; background:#0f0f23; color:#e0e0e0;
                 border:1px solid #2a2a4a; border-radius:6px; cursor:pointer;
                 font-size:14px; text-align:left; transition:all 0.15s;"
          onmouseenter="this.style.background='#2a2a4a';this.style.borderColor='#ffd700'"
          onmouseleave="this.style.background='#0f0f23';this.style.borderColor='#2a2a4a'">
          <span>${p.label}</span>
          ${p.desc ? `<span style="color:#888;font-size:0.85em;">${p.desc}</span>` : ''}
        </button>
      `).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;">
      ${canSkip ? `
        <button id="phase-picker-skip"
          style="flex:1; padding:10px; background:#2a2a4a; color:#ffd700;
                 border:1px solid #ffd700; border-radius:6px; cursor:pointer; font-size:14px;">
          ⏭ 跳过此环节
        </button>
      ` : ''}
      <button id="phase-picker-cancel"
        style="flex:1; padding:10px; background:#333; color:#aaa;
               border:1px solid #444; border-radius:6px; cursor:pointer; font-size:14px;">
        取消
      </button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Click handlers
  modal.querySelectorAll('.phase-pick-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const phaseId = btn.dataset.phase;
      overlay.remove();
      await doGenerateInstruction(phaseId);
    });
  });

  // Skip button
  const skipBtn = document.getElementById('phase-picker-skip');
  if (skipBtn) {
    skipBtn.addEventListener('click', async () => {
      overlay.remove();
      try {
        const result = await window.electronAPI.skipPhase();
        if (result.success) {
          runPhase = result.currentPhase;
          isDungeonPhase = (runPhase === 'dungeon');
          showToast('⏭', '已跳过开局饰品环节');
        }
      } catch (e) {
        console.error('Skip phase error:', e);
      }
    });
  }

  document.getElementById('phase-picker-cancel').addEventListener('click', () => {
    overlay.remove();
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Keyboard shortcuts
  const keyHandler = (e) => {
    if (!document.getElementById('phase-picker-overlay')) {
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      if (skipBtn) {
        skipBtn.click();
        document.removeEventListener('keydown', keyHandler);
      }
      return;
    }
    // Number shortcuts for dungeon phase
    if (isDungeon) {
      const num = parseInt(e.key);
      if (num >= 1 && num <= availablePhases.length) {
        overlay.remove();
        document.removeEventListener('keydown', keyHandler);
        doGenerateInstruction(availablePhases[num - 1].id);
      }
    }
  };
  document.addEventListener('keydown', keyHandler);
}

async function doGenerateInstruction(phaseId) {
  try {
    const result = await window.electronAPI.generateInstruction(phaseId);
    if (result.success) {
      const phase = PHASE_LIST.find(p => p.id === phaseId);
      const count = Array.isArray(result.instructions) ? result.instructions.length : 1;
      showToast('📟', `已生成 ${count} 条${phase?.label || phaseId}指令`);
      // Lock button until instruction is processed
      setInstructionPending(true);
    } else {
      alert('指令生成失败: ' + (result.error || '未知错误'));
    }
  } catch (e) {
    console.error('generateInstruction error:', e);
    alert('指令生成出错: ' + e.message);
  }
}

function setInstructionPending(pending) {
  instructionPending = pending;
  if (pending) {
    btnManualInstruct.disabled = true;
    btnManualInstruct.style.opacity = '0.5';
    btnManualInstruct.style.cursor = 'not-allowed';
    btnManualInstruct.title = '请先在传呼机上完成当前指令';
  } else {
    btnManualInstruct.disabled = false;
    btnManualInstruct.style.opacity = '';
    btnManualInstruct.style.cursor = '';
    btnManualInstruct.title = '手动请求指令 (F9)';
  }
}

// ── Shortcuts ──
function setupShortcuts() {
  window.electronAPI.onShortcutF9(() => {
    requestManualInstruction();
  });

  window.electronAPI.onShortcutF11(() => {
    showToast('🗳️', '弹幕投票已否决');
  });

  // Run state updates from main process
  window.electronAPI.onRunStateChanged(({ active, blessing, karma, currentPhase }) => {
    if (!active && runActive) {
      setRunActive(false);
    }
    statBlessing.textContent = blessing;
    statKarma.textContent = karma;
    refreshGlobalStats(); // Keep global stats updated
    // Sync phase on initial state
    if (active && currentPhase) {
      runPhase = currentPhase;
      isDungeonPhase = (currentPhase === 'dungeon');
    }
  });

  // Phase change listener
  window.electronAPI.onPhaseChanged(async (data) => {
    runPhase = data.currentPhase;
    isDungeonPhase = data.isDungeon;
    // Unlock request button on phase change
    setInstructionPending(false);
    // If entering dungeon phase, show notification
    if (isDungeonPhase) {
      showToast('⚔️', '开局设置完成！现在可以自由请求指令');
    }
    // If deploy_identity just finished and dev toggle is on, show core mechanic
    if (runPhase === 'starlight' && showCoreMechanic) {
      await showTeamCoreMechanic();
    }
  });

  // New instruction notification
  window.electronAPI.onInstructionNew(({ phase, count, isGuidance }) => {
    // Already handled by the toast in requestManualInstruction
  });

  // Instruction processed (dungeon phase unlock)
  window.electronAPI.onInstructionProcessed(({ phase, remaining }) => {
    // Unlock button when dungeon instruction is done
    setInstructionPending(false);
    refreshGlobalStats();
  });
}

// ── Team Core Mechanic Display (dev-only) ──
async function showTeamCoreMechanic() {
  try {
    const result = await window.electronAPI.getTeamMechanic();
    if (result && result.mechanic && result.mechanic.length > 0) {
      const mechanic = result.mechanic.join(' + ');
      const toast = document.createElement('div');
      toast.className = 'achievement-toast';
      toast.style.cssText = 'background:#1a1a3e;border:1px solid #ffd700;padding:16px 20px;max-width:400px;';
      toast.innerHTML = `
        <strong style="color:#ffd700;">🔍 队伍核心机制</strong><br>
        <span style="font-size:1.1em;color:#fff;">${escapeHtml(mechanic)}</span>
        <br><small style="color:#888;">（开发者显示，可在开发者菜单关闭）</small>
      `;
      document.getElementById('toast-container').appendChild(toast);
      setTimeout(() => toast.remove(), 8000);
    } else {
      showToast('🔍', '当前队伍无核心机制');
    }
  } catch (e) {
    console.error('Failed to get team mechanic:', e);
  }
}

// ── Settings ──
async function loadSettings(config) {
  const settings = config.settings || {};

  document.getElementById('setting-game-mode').value = settings.currentGameMode || 'hard';
  document.getElementById('setting-opacity').value = (settings.overlayOpacity || 0.9) * 100;
  document.getElementById('setting-scale').value = (settings.overlayScale || 1.0) * 100;
  document.getElementById('setting-sound').checked = settings.soundEnabled !== false;
  document.getElementById('setting-notify').checked = settings.achievementNotify !== false;
  document.getElementById('setting-history-limit').value = settings.historyLimit || 200;

  document.getElementById('opacity-value').textContent = Math.round((settings.overlayOpacity || 0.9) * 100) + '%';
  document.getElementById('scale-value').textContent = Math.round((settings.overlayScale || 1.0) * 100) + '%';
}

function setupSettings() {
  document.getElementById('setting-game-mode').addEventListener('change', async (e) => {
    await window.electronAPI.setConfig('settings.currentGameMode', e.target.value);
  });

  document.getElementById('setting-opacity').addEventListener('input', async (e) => {
    const val = parseInt(e.target.value) / 100;
    document.getElementById('opacity-value').textContent = e.target.value + '%';
    await window.electronAPI.setConfig('settings.overlayOpacity', val);
  });

  document.getElementById('setting-scale').addEventListener('input', async (e) => {
    const val = parseInt(e.target.value) / 100;
    document.getElementById('scale-value').textContent = e.target.value + '%';
    await window.electronAPI.setConfig('settings.overlayScale', val);
  });

  document.getElementById('setting-sound').addEventListener('change', async (e) => {
    await window.electronAPI.setConfig('settings.soundEnabled', e.target.checked);
  });

  document.getElementById('setting-notify').addEventListener('change', async (e) => {
    await window.electronAPI.setConfig('settings.achievementNotify', e.target.checked);
  });

  document.getElementById('setting-history-limit').addEventListener('change', async (e) => {
    const val = parseInt(e.target.value) || 200;
    await window.electronAPI.setConfig('settings.historyLimit', Math.max(50, Math.min(1000, val)));
  });

  // Export/Import
  document.getElementById('btn-export-data').addEventListener('click', async () => {
    // Get all data
    const types = await window.electronAPI.listDataTypes();
    const exportData = {};
    for (const type of types) {
      exportData[type] = await window.electronAPI.loadData(type);
    }
    const config = await window.electronAPI.getConfig();
    exportData._config = config;

    // Download as JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `limbus_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('📦', '数据已导出');
  });

  document.getElementById('btn-import-data').addEventListener('click', async () => {
    if (!confirm('导入数据将覆盖当前用户数据，确定继续吗？\n建议先导出备份。')) return;

    // Create file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        let imported = 0;
        for (const [type, content] of Object.entries(data)) {
          if (type === '_config') continue; // skip config
          await window.electronAPI.saveData(type, content);
          imported++;
        }
        showToast('📥', `已导入 ${imported} 个数据文件`);
        // Reload
        await loadInitialData();
      } catch (e) {
        alert('导入失败: ' + e.message);
      }
    };
    input.click();
  });
}

// ── Achievements ──
async function renderAchievements() {
  const list = document.getElementById('achievement-list');
  const achievements = await window.electronAPI.getAllAchievements();

  if (!achievements || achievements.length === 0) {
    list.innerHTML = '<p class="loading">暂无成就定义</p>';
    return;
  }

  list.innerHTML = achievements.map(a => {
    const completed = a.completed;
    const progress = a.progress || 0;
    const target = a.condition?.count || (a.condition?.conditions ? '?' : 1);
    const icon = completed ? '🏆' : '🔒';

    return `
      <div class="achievement-card ${completed ? 'completed' : ''}">
        <div class="achievement-icon">${icon}</div>
        <div class="achievement-info">
          <div class="ach-name">${escapeHtml(a.name)}</div>
          <div class="ach-desc">${escapeHtml(a.description)}</div>
          ${a.unlockText ? `<div class="ach-desc" style="color:#ffd700;font-style:italic">"${escapeHtml(a.unlockText)}"</div>` : ''}
        </div>
        <div class="achievement-progress">
          ${completed ? '✅ 已完成' : `${progress}/${target}`}
        </div>
      </div>
    `;
  }).join('');
}

function setupAchievementListener() {
  window.electronAPI.onAchievementUnlocked(({ name, description, unlockText }) => {
    const notifyEnabled = document.getElementById('setting-notify')?.checked !== false;
    if (!notifyEnabled) return;

    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `
      <strong>🏆 成就解锁：${escapeHtml(name)}</strong><br>
      <span>${escapeHtml(description)}</span><br>
      <em style="color:#ffd700;font-size:0.85em">"${escapeHtml(unlockText || '')}"</em>
    `;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => toast.remove(), 5000);

    // Refresh achievement panel if visible
    const panel = document.getElementById('panel-achievements');
    if (panel && panel.classList.contains('active')) {
      renderAchievements();
    }
  });
}

// ── Dev Page Entry ──
function setupDevEntry() {
  fingerLogo.title = '食指 — 连点三次进入开发者页面';
  fingerLogo.style.cursor = 'pointer';

  fingerLogo.addEventListener('click', () => {
    logoClickCount++;
    console.log('[Dev] Logo click #' + logoClickCount);

    // Visual feedback
    const icon = fingerLogo.querySelector('.logo-icon');
    if (icon) {
      icon.style.color = '#fff';
      icon.style.textShadow = '0 0 10px #ffd700';
      setTimeout(() => {
        icon.style.color = '';
        icon.style.textShadow = '';
      }, 150);
    }

    if (logoClickCount >= 3) {
      console.log('[Dev] Triple-click detected, opening dev page');
      logoClickCount = 0;
      clearTimeout(logoClickTimer);
      showDevAuthModal();
    } else {
      clearTimeout(logoClickTimer);
      logoClickTimer = setTimeout(() => {
        logoClickCount = 0;
      }, 1200);
    }
  });
}

function showDevAuthModal() {
  const existing = document.getElementById('dev-auth-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'dev-auth-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:24px;min-width:320px;text-align:center;';
  box.innerHTML = `
    <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAA7EAAAOxAGVKw4bAAA57mlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS42LWMxMzggNzkuMTU5ODI0LCAyMDE2LzA5LzE0LTAxOjA5OjAxICAgICAgICAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIKICAgICAgICAgICAgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIgogICAgICAgICAgICB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIKICAgICAgICAgICAgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIKICAgICAgICAgICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iCiAgICAgICAgICAgIHhtbG5zOmV4aWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vZXhpZi8xLjAvIj4KICAgICAgICAgPHhtcDpDcmVhdG9yVG9vbD5BZG9iZSBQaG90b3Nob3AgQ0MgMjAxNyAoV2luZG93cyk8L3htcDpDcmVhdG9yVG9vbD4KICAgICAgICAgPHhtcDpDcmVhdGVEYXRlPjIwMjAtMDgtMDdUMjI6NTE6MDQrMDk6MDA8L3htcDpDcmVhdGVEYXRlPgogICAgICAgICA8eG1wOk1vZGlmeURhdGU+MjAyMC0wOC0wOFQxMzo0MToxMSswOTowMDwveG1wOk1vZGlmeURhdGU+CiAgICAgICAgIDx4bXA6TWV0YWRhdGFEYXRlPjIwMjAtMDgtMDhUMTM6NDE6MTErMDk6MDA8L3htcDpNZXRhZGF0YURhdGU+CiAgICAgICAgIDxkYzpmb3JtYXQ+aW1hZ2UvcG5nPC9kYzpmb3JtYXQ+CiAgICAgICAgIDxwaG90b3Nob3A6Q29sb3JNb2RlPjM8L3Bob3Rvc2hvcDpDb2xvck1vZGU+CiAgICAgICAgIDx4bXBNTTpJbnN0YW5jZUlEPnhtcC5paWQ6Zjc5ZGE4YmEtM2JhNC05YTRkLWIxMjgtNjM2YzZkN2NiNDk2PC94bXBNTTpJbnN0YW5jZUlEPgogICAgICAgICA8eG1wTU06RG9jdW1lbnRJRD5hZG9iZTpkb2NpZDpwaG90b3Nob3A6NDdkMDc0NzItZDkzMS0xMWVhLTlmMDEtOWU3YzBiNThmYjQ4PC94bXBNTTpEb2N1bWVudElEPgogICAgICAgICA8eG1wTU06T3JpZ2luYWxEb2N1bWVudElEPnhtcC5kaWQ6NjQ1OWRjODMtMGZlNS0yMjQ4LWFmM2EtMjE2ODJlNjY5NGQwPC94bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ+CiAgICAgICAgIDx4bXBNTTpIaXN0b3J5PgogICAgICAgICAgICA8cmRmOlNlcT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDphY3Rpb24+Y3JlYXRlZDwvc3RFdnQ6YWN0aW9uPgogICAgICAgICAgICAgICAgICA8c3RFdnQ6aW5zdGFuY2VJRD54bXAuaWlkOjY0NTlkYzgzLTBmZTUtMjI0OC1hZjNhLTIxNjgyZTY2OTRkMDwvc3RFdnQ6aW5zdGFuY2VJRD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OndoZW4+MjAyMC0wOC0wN1QyMjo1MTowNCswOTowMDwvc3RFdnQ6d2hlbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OnNvZnR3YXJlQWdlbnQ+QWRvYmUgUGhvdG9zaG9wIENDIDIwMTcgKFdpbmRvd3MpPC9zdEV2dDpzb2Z0d2FyZUFnZW50PgogICAgICAgICAgICAgICA8L3JkZjpsaT4KICAgICAgICAgICAgICAgPHJkZjpsaSByZGY6cGFyc2VUeXBlPSJSZXNvdXJjZSI+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDphY3Rpb24+c2F2ZWQ8L3N0RXZ0OmFjdGlvbj4KICAgICAgICAgICAgICAgICAgPHN0RXZ0Omluc3RhbmNlSUQ+eG1wLmlpZDpmNzlkYThiYS0zYmE0LTlhNGQtYjEyOC02MzZjNmQ3Y2I0OTY8L3N0RXZ0Omluc3RhbmNlSUQ+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDp3aGVuPjIwMjAtMDgtMDhUMTM6NDE6MTErMDk6MDA8L3N0RXZ0OndoZW4+CiAgICAgICAgICAgICAgICAgIDxzdEV2dDpzb2Z0d2FyZUFnZW50PkFkb2JlIFBob3Rvc2hvcCBDQyAyMDE3IChXaW5kb3dzKTwvc3RFdnQ6c29mdHdhcmVBZ2VudD4KICAgICAgICAgICAgICAgICAgPHN0RXZ0OmNoYW5nZWQ+Lzwvc3RFdnQ6Y2hhbmdlZD4KICAgICAgICAgICAgICAgPC9yZGY6bGk+CiAgICAgICAgICAgIDwvcmRmOlNlcT4KICAgICAgICAgPC94bXBNTTpIaXN0b3J5PgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICAgICA8dGlmZjpYUmVzb2x1dGlvbj45NjAwMDAvMTAwMDA8L3RpZmY6WFJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjk2MDAwMC8xMDAwMDwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6UmVzb2x1dGlvblVuaXQ+MjwvdGlmZjpSZXNvbHV0aW9uVW5pdD4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT42NTUzNTwvZXhpZjpDb2xvclNwYWNlPgogICAgICAgICA8ZXhpZjpQaXhlbFhEaW1lbnNpb24+MjU2PC9leGlmOlBpeGVsWERpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjI1NjwvZXhpZjpQaXhlbFlEaW1lbnNpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgIAo8P3hwYWNrZXQgZW5kPSJ3Ij8+BuX7fwAAACBjSFJNAAB6JQAAgIMAAPn/AACA6QAAdTAAAOpgAAA6mAAAF2+SX8VGAABsL0lEQVR42uyddZyV1fr2DyWS0kgJSAkioSDS3UgIKiHYAYqAjfSim0ERhg7pbtvHVjCPCbYoSz0WSunx9877h9d99sXtenYMMzCD64/7YzDM7L3nub7r7vWvlJSUf3nz5u2faf5D8ObNA8CbN28eAN68efMA8ObNmweAN2/ePAC8efPmAeDNmzcPAG/evHkAePPmzQPAmzdvHgDevHnzAPDmzZsHgDdv3jwAErd2xnhLQ7OByZKIZcb32GG02xblKvivRbkK/mtJrkIZzjwAPAAyjOgzOwzCACAQ8ADwAPCi/4fAwGXiCYSZB4AHwJks/Kxxfk3WeL42s4YIHgAeAP8k8WcNEXW2EMsaYmcEBFx5AQ8AD4B/gvBdYs+uLB4gnHE5Ag8AD4AzSfyJij6WZY03LMjsVYNY+YH0Mg8AD4C0Fr9L+DlgIuwcIRYLBNnOJAjE8gg8ADwAMoP4Xad+mNBzkp2t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" style="width:56px;height:56px;object-fit:contain;margin-bottom:8px;" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><div style="font-size:48px;margin-bottom:8px;display:none;">☝</div>
    <h3 style="color:#ffd700;margin:0 0 16px;">开发者验证</h3>
    <input id="dev-pwd-input" type="password" placeholder="请输入密码"
      style="width:100%;padding:10px;background:#0f0f23;color:#e0e0e0;border:1px solid #3a3a5a;border-radius:6px;font-size:14px;margin-bottom:12px;text-align:center;" autofocus>
    <div style="display:flex;gap:8px;">
      <button id="dev-auth-confirm" style="flex:1;padding:10px;background:#ffd700;color:#1a1a2e;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">验证</button>
      <button id="dev-auth-cancel" style="flex:1;padding:10px;background:#333;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer;">取消</button>
    </div>
    <p id="dev-auth-error" style="color:#f44336;font-size:0.85em;margin-top:8px;display:none;">密码错误</p>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const input = document.getElementById('dev-pwd-input');
  const confirm = document.getElementById('dev-auth-confirm');
  const cancel = document.getElementById('dev-auth-cancel');
  const error = document.getElementById('dev-auth-error');

  const doAuth = async () => {
    const ok = await window.electronAPI.devAuth(input.value);
    if (ok) {
      overlay.remove();
      showDevMenu();
    } else {
      error.style.display = 'block';
      input.value = '';
      input.focus();
    }
  };

  confirm.addEventListener('click', doAuth);
  cancel.addEventListener('click', () => overlay.remove());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doAuth();
    if (e.key === 'Escape') overlay.remove();
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function showDevMenu() {
  const existing = document.getElementById('dev-menu-modal');
  if (existing) { existing.remove(); return; }

  // Load current settings
  const config = await window.electronAPI.getConfig('settings') || {};
  const freeMin = config.freeInstructionIntervalMin ?? 60;
  const freeMax = config.freeInstructionIntervalMax ?? 180;
  const karmaThreshold = config.karmaScareThreshold ?? 100;

  const overlay = document.createElement('div');
  overlay.id = 'dev-menu-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:24px;min-width:360px;';
  box.innerHTML = `
    <h3 style="color:#ffd700;margin:0 0 16px;">🔧 开发者菜单</h3>
    <div style="display:flex;flex-direction:column;gap:8px;">
      <button class="dev-menu-btn" data-action="editor">✏️ 数据编辑器 (人格/EGO/饰品)</button>
      <button class="dev-menu-btn" data-action="weaver">🕸 编织器 (指令生成调试)</button>
      <button class="dev-menu-btn" data-action="export">📦 导出所有数据 (JSON)</button>
      <button class="dev-menu-btn" data-action="reload">🔄 重新加载数据</button>
      <button class="dev-menu-btn" data-action="stats">📊 查看数据统计</button>
      <label class="dev-menu-btn" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="dev-core-mechanic-toggle" ${showCoreMechanic ? 'checked' : ''} style="accent-color:#ffd700;width:16px;height:16px;">
        <span>🔍 显示队伍核心机制（编队完成后）</span>
      </label>
      <div style="color:#888;font-size:12px;padding:4px 0;border-top:1px solid #2a2a4a;margin-top:4px;">⚙ 调试参数</div>
      <div style="display:flex;gap:8px;align-items:center;padding:4px 8px;">
        <span style="color:#aaa;font-size:12px;white-space:nowrap;">自由指令间隔</span>
        <input id="dev-free-min" type="number" value="${freeMin}" style="width:50px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:12px;">
        <span style="color:#666;font-size:11px;">~</span>
        <input id="dev-free-max" type="number" value="${freeMax}" style="width:50px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:12px;">
        <span style="color:#666;font-size:11px;">秒</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;padding:4px 8px;">
        <span style="color:#aaa;font-size:12px;white-space:nowrap;">业恐吓阈值</span>
        <input id="dev-karma-threshold" type="number" value="${karmaThreshold}" style="width:60px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:2px 4px;font-size:12px;">
      </div>
      <button class="dev-menu-btn" data-action="close" style="background:#333;color:#aaa;">关闭</button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const btnStyle = 'width:100%;padding:12px 16px;background:#0f0f23;color:#e0e0e0;border:1px solid #2a2a4a;border-radius:6px;cursor:pointer;font-size:14px;text-align:left;transition:all 0.15s;';
  box.querySelectorAll('.dev-menu-btn').forEach(btn => {
    btn.style.cssText = btnStyle;
    btn.addEventListener('mouseenter', () => { btn.style.background = '#2a2a4a'; btn.style.borderColor = '#ffd700'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#0f0f23'; btn.style.borderColor = '#2a2a4a'; });
  });

  box.querySelector('[data-action="editor"]').addEventListener('click', () => { showDataEditor(); });
  box.querySelector('[data-action="weaver"]').addEventListener('click', async () => {
    await window.electronAPI.openWeaver();
    overlay.remove();
  });
  box.querySelector('[data-action="export"]').addEventListener('click', () => { document.getElementById('btn-export-data').click(); });
  box.querySelector('[data-action="reload"]').addEventListener('click', async () => { await loadInitialData(); showToast('🔄', '数据已重新加载'); });
  box.querySelector('[data-action="stats"]').addEventListener('click', () => { showDataStats(); });
  box.querySelector('[data-action="close"]').addEventListener('click', () => overlay.remove());
  // Core mechanic toggle
  const coreToggle = document.getElementById('dev-core-mechanic-toggle');
  if (coreToggle) {
    coreToggle.addEventListener('change', async (e) => {
      showCoreMechanic = e.target.checked;
      await window.electronAPI.setConfig('settings.showCoreMechanic', showCoreMechanic);
      showToast(showCoreMechanic ? '🔍' : '🚫', showCoreMechanic ? '核心机制显示已开启' : '核心机制显示已关闭');
    });
  }
  // Free instruction interval inputs
  const freeMinEl = document.getElementById('dev-free-min');
  const freeMaxEl = document.getElementById('dev-free-max');
  const karmaThreshEl = document.getElementById('dev-karma-threshold');
  if (freeMinEl) freeMinEl.addEventListener('change', async () => {
    await window.electronAPI.setConfig('settings.freeInstructionIntervalMin', parseInt(freeMinEl.value) || 60);
    showToast('⚙', `自由指令最小间隔 → ${freeMinEl.value}秒`);
  });
  if (freeMaxEl) freeMaxEl.addEventListener('change', async () => {
    await window.electronAPI.setConfig('settings.freeInstructionIntervalMax', parseInt(freeMaxEl.value) || 180);
    showToast('⚙', `自由指令最大间隔 → ${freeMaxEl.value}秒`);
  });
  if (karmaThreshEl) karmaThreshEl.addEventListener('change', async () => {
    await window.electronAPI.setConfig('settings.karmaScareThreshold', parseInt(karmaThreshEl.value) || 100);
    showToast('⚙', `业恐吓阈值 → ${karmaThreshEl.value}`);
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ── Data Editor ──
const COMMON_TAGS = {
  identity: { effect: ['烧伤','流血','震颤','破裂','沉沦','呼吸法','充能','迅捷','强壮','守护','易损','麻痹','丢弃','防御等级降低','恢复','攻击容量','无差别攻击'], damageType: ['斩击','突刺','打击'], sinAffinity: ['暴怒','色欲','怠惰','暴食','忧郁','傲慢','嫉妒'], faction: ['LCB罪人','LCB','边狱公司','收尾人','Seven协会','臼齿事务所','脑叶公司','剑契组','G公司','W公司','R公司','N公司','黑云会'] },
  ego: { effect: ['攻击容量','无差别攻击','恢复'], damageType: ['斩击','突刺','打击'], sinAffinity: ['暴怒','色欲','怠惰','暴食','忧郁','傲慢','嫉妒'], faction: [], special: ['可超频'] },
  relic: { effect: ['烧伤','流血','震颤','破裂','沉沦','呼吸','充能','打击','斩击','突刺','泛用'], sinAffinity: ['暴怒','色欲','怠惰','暴食','忧郁','傲慢','嫉妒'] },
};

let _currentEditType = null;
let _currentEditData = null;
let _currentEditFilter = '';

function showDataEditor() {
  const existing = document.getElementById('data-editor-modal');
  if (existing) existing.remove();

  const types = [
    { id: 'identities', label: '人格', count: identities.length },
    { id: 'egos', label: 'EGO', count: egos.length },
    { id: 'relics', label: '饰品', count: 0 },
    { id: 'starlight', label: '星光', count: 0 },
    { id: 'cardpacks', label: '卡包', count: 0 },
    { id: 'templates', label: '指令模板', count: 0 },
    { id: 'achievements', label: '成就', count: 0 },
  ];

  const overlay = document.createElement('div');
  overlay.id = 'data-editor-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99998;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:20px;width:95%;max-width:1100px;max-height:90vh;display:flex;flex-direction:column;';
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
      <h3 style="color:#ffd700;margin:0;">✏️ 数据编辑器</h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${types.map(t => `<button class="editor-type-btn" data-type="${t.id}" style="padding:6px 14px;background:#0f0f23;color:#aaa;border:1px solid #2a2a4a;border-radius:6px;cursor:pointer;font-size:12px;">${t.label}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="editor-filter" placeholder="搜索..." style="width:120px;padding:5px 8px;background:#0f0f23;color:#e0e0e0;border:1px solid #3a3a5a;border-radius:4px;font-size:12px;">
        <button id="editor-save" style="padding:6px 16px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:bold;font-size:12px;">💾 保存</button>
        <button id="editor-close" style="padding:6px 12px;background:#333;color:#aaa;border:1px solid #444;border-radius:4px;cursor:pointer;font-size:12px;">关闭</button>
      </div>
    </div>
    <div id="editor-type-hint" style="color:#666;font-size:0.85em;margin-bottom:8px;">请先选择要编辑的数据类型</div>
    <div id="editor-content" style="flex:1;overflow:auto;background:#0f0f23;border-radius:6px;padding:12px;min-height:300px;"></div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Type buttons
  box.querySelectorAll('.editor-type-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      box.querySelectorAll('.editor-type-btn').forEach(b => { b.style.background = '#0f0f23'; b.style.color = '#aaa'; b.style.borderColor = '#2a2a4a'; });
      btn.style.background = '#ffd700'; btn.style.color = '#1a1a2e'; btn.style.borderColor = '#ffd700';
      await loadEditorData(btn.dataset.type);
    });
  });

  // Filter input
  document.getElementById('editor-filter').addEventListener('input', (e) => {
    _currentEditFilter = e.target.value.toLowerCase();
    renderEditorRows();
  });

  document.getElementById('editor-save').addEventListener('click', saveEditorData);
  document.getElementById('editor-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

async function loadEditorData(type) {
  _currentEditType = type;
  _currentEditData = await window.electronAPI.loadData(type);
  document.getElementById('editor-type-hint').textContent = `当前编辑: ${type} (${Array.isArray(_currentEditData) ? _currentEditData.length : 'N/A'} 条)`;
  renderEditorRows();
}


function renderEditorRows() {
  const content = document.getElementById('editor-content');
  const data = _currentEditData;
  const type = _currentEditType;
  if (!data || !type) { content.innerHTML = '<p style="color:#666;">请选择数据类型</p>'; return; }
  if (!Array.isArray(data)) { content.innerHTML = '<p style="color:#aaa;">非数组数据</p>'; return; }
  if (data.length === 0) {
    content.innerHTML = '<p style="color:#666;padding:20px;text-align:center;">无数据，点击"➕ 新增"添加</p>';
    return;
  }
  let items = data;
  if (_currentEditFilter) { items = data.filter(item => JSON.stringify(item).toLowerCase().includes(_currentEditFilter)); }

  // Chip helpers
  const chipCfg = {
    effect:       { tags: ['烧伤','流血','震颤','破裂','沉沦','呼吸法','充能'] },
    damageType:   { tags: ['打击','斩击','突刺'] },
    sinAffinity:  { tags: ['暴怒','色欲','怠惰','暴食','忧郁','傲慢','嫉妒'] },
    coreMechanic: { tags: ['烧伤','流血','震颤','破裂','沉沦','呼吸法','充能'] },
    faction:      { tags: ['LCB罪人','LCB','边狱公司','收尾人','Seven协会','臼齿事务所','脑叶公司','剑契组','G公司','W公司','R公司','N公司','黑云会'] },
    special:      { tags: [] },
  };
  function _arr(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'string') return v.split(/[,，、\s]+/).filter(Boolean);
    return [];
  }
  function _chips(idx, field, cur) {
    var cfg = chipCfg[field];
    if (!cfg) return '';
    var arr = _arr(cur);
    var h = '<div style="display:flex;flex-wrap:wrap;gap:2px;margin-top:1px;">';
    arr.forEach(function(t) {
      h += '<span class="cs" data-idx="' + idx + '" data-field="' + field + '" data-tag="' + escapeHtml(t) + '" style="display:inline-flex;align-items:center;gap:1px;padding:1px 5px;background:#2a5a2a;color:#8fdf8f;border-radius:9px;font-size:10px;cursor:pointer;">' + escapeHtml(t) + ' ✕</span>';
    });
    cfg.tags.filter(function(s) { return !arr.includes(s); }).forEach(function(s) {
      h += '<span class="cg" data-idx="' + idx + '" data-field="' + field + '" data-tag="' + escapeHtml(s) + '" style="display:inline-flex;padding:1px 5px;background:#2a2a3a;color:#666;border-radius:9px;font-size:10px;cursor:pointer;">+' + escapeHtml(s) + '</span>';
    });
    h += '<input class="ci" data-idx="' + idx + '" data-field="' + field + '" placeholder="+" style="width:50px;padding:1px 3px;background:#0f0f23;color:#aaa;border:1px dashed #444;border-radius:9px;font-size:10px;">';
    h += '</div>';
    return h;
  }

  var html = '<div style="display:flex;gap:8px;margin-bottom:12px;"><button id="editor-add-item" style="padding:6px 16px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">➕ 新增</button><span style="color:#888;font-size:12px;padding-top:6px;">' + items.length + '/' + data.length + ' 条</span></div>';

  var R = ['一灯','二灯','三灯'];
  var L = ['ZAYIN','TETH','HE','WAW','ALEPH'];
  var T = ['I','II','III','IV','V','EX'];

  if (type === 'identities') {
    html += items.map(function(item) {
      var oi = data.indexOf(item);
      var t = item.tags || {};
      return '<div class="edit-card" style="margin-bottom:12px;padding:10px;background:#1a1a2e;border-radius:6px;border:1px solid #2a2a4a;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="color:#ffd700;font-weight:bold;font-size:12px;">#' + (oi+1) + ' ' + escapeHtml(item.name) + '</span>' +
          '<button data-delete="' + oi + '" style="padding:2px 8px;background:#662222;color:#f44336;border:1px solid #883333;border-radius:3px;cursor:pointer;font-size:10px;">🗑</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:6px;">' +
          '<div><span style="color:#888;font-size:10px;">id</span><input data-idx="' + oi + '" data-key="id" value="' + escapeHtml(item.id||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">name</span><input data-idx="' + oi + '" data-key="name" value="' + escapeHtml(item.name||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">sinner</span><input data-idx="' + oi + '" data-key="sinner" value="' + escapeHtml(item.sinner||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">rarity</span><select data-idx="' + oi + '" data-key="rarity" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;">' + R.map(function(o) { return '<option ' + (item.rarity===o?'selected':'') + '>' + o + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<div style="border-top:1px solid #333;padding-top:6px;">' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.faction</span>' + _chips(oi, 'faction', t.faction) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.effect</span>' + _chips(oi, 'effect', t.effect) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.damageType</span>' + _chips(oi, 'damageType', t.damageType) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.sinAffinity</span>' + _chips(oi, 'sinAffinity', t.sinAffinity) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.special</span>' + _chips(oi, 'special', t.special) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">coreMechanic</span>' + _chips(oi, 'coreMechanic', item.coreMechanic) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else if (type === 'egos') {
    var SIN = ['暴怒','色欲','怠惰','暴食','忧郁','傲慢','嫉妒'];
    html += items.map(function(item) {
      var oi = data.indexOf(item);
      var t = item.tags || {};
      return '<div class="edit-card" style="margin-bottom:12px;padding:10px;background:#1a1a2e;border-radius:6px;border:1px solid #2a2a4a;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="color:#ffd700;font-weight:bold;font-size:12px;">#' + (oi+1) + ' ' + escapeHtml(item.name) + '</span>' +
          '<button data-delete="' + oi + '" style="padding:2px 8px;background:#662222;color:#f44336;border:1px solid #883333;border-radius:3px;cursor:pointer;font-size:10px;">🗑</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;margin-bottom:6px;">' +
          '<div><span style="color:#888;font-size:10px;">id</span><input data-idx="' + oi + '" data-key="id" value="' + escapeHtml(item.id||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">name</span><input data-idx="' + oi + '" data-key="name" value="' + escapeHtml(item.name||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">sinner</span><input data-idx="' + oi + '" data-key="sinner" value="' + escapeHtml(item.sinner||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">level</span><select data-idx="' + oi + '" data-key="level" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;">' + L.map(function(o) { return '<option ' + (item.level===o?'selected':'') + '>' + o + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
          '<label style="font-size:11px;color:#ccc;"><input data-idx="' + oi + '" data-key="isBaseEgo" type="checkbox" ' + (item.isBaseEgo?'checked':'') + ' style="accent-color:#ffd700;"> 初始EGO</label>' +
        '</div>' +
        '<div style="border-top:1px solid #333;padding-top:6px;">' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.damageType</span>' + _chips(oi, 'damageType', t.damageType) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.effect</span>' + _chips(oi, 'effect', t.effect) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.special</span>' + _chips(oi, 'special', t.special) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">sinCost</span>' + SIN.map(function(s) { return '<label style="display:inline-flex;align-items:center;gap:1px;margin-right:4px;font-size:10px;" title="' + s + '"><span style="color:#aaa;">' + s[0] + '</span><input data-idx="' + oi + '" data-sinkey="' + s + '" value="' + (item.sinCost?.[s]||0) + '" style="width:26px;padding:1px 2px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:10px;text-align:center;"></label>'; }).join('') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else if (type === 'relics') {
    html += items.map(function(item) {
      var oi = data.indexOf(item);
      return '<div class="edit-card" style="margin-bottom:12px;padding:10px;background:#1a1a2e;border-radius:6px;border:1px solid #2a2a4a;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="color:#ffd700;font-weight:bold;font-size:12px;">#' + (oi+1) + ' ' + escapeHtml(item.name) + '</span>' +
          '<button data-delete="' + oi + '" style="padding:2px 8px;background:#662222;color:#f44336;border:1px solid #883333;border-radius:3px;cursor:pointer;font-size:10px;">🗑</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:6px;">' +
          '<div><span style="color:#888;font-size:10px;">id</span><input data-idx="' + oi + '" data-key="id" value="' + escapeHtml(item.id||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">name</span><input data-idx="' + oi + '" data-key="name" value="' + escapeHtml(item.name||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">tier</span><select data-idx="' + oi + '" data-key="tier" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;">' + T.map(function(o) { return '<option ' + (item.tier===o?'selected':'') + '>' + o + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<div style="border-top:1px solid #333;padding-top:6px;">' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.effect</span>' + _chips(oi, 'effect', (item.tags||{}).effect) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.sinAffinity</span>' + _chips(oi, 'sinAffinity', (item.tags||{}).sinAffinity) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">price</span><input data-idx="' + oi + '" data-key="price" value="' + escapeHtml(item.price!=null?String(item.price):'') + '" style="width:80px;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
        '</div>' +
      '</div>';
    }).join('');
  } else if (type === 'cardpacks') {
    var FL = [1,2,3,4,5];
    var MD = ['normal','hard','parallel','extreme'];
    var ML = ['普通','困难','平行叠加','极限'];
    html += items.map(function(item) {
      var oi = data.indexOf(item);
      var av = item.availability || {};
      return '<div class="edit-card" style="margin-bottom:12px;padding:10px;background:#1a1a2e;border-radius:6px;border:1px solid #2a2a4a;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="color:#ffd700;font-weight:bold;font-size:12px;">#' + (oi+1) + ' ' + escapeHtml(item.name) + '</span>' +
          '<button data-delete="' + oi + '" style="padding:2px 8px;background:#662222;color:#f44336;border:1px solid #883333;border-radius:3px;cursor:pointer;font-size:10px;">🗑</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:6px;">' +
          '<div><span style="color:#888;font-size:10px;">id</span><input data-idx="' + oi + '" data-key="id" value="' + escapeHtml(item.id||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div><span style="color:#888;font-size:10px;">name</span><input data-idx="' + oi + '" data-key="name" value="' + escapeHtml(item.name||'') + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
        '</div>' +
        '<div style="border-top:1px solid #333;padding-top:4px;">' +
          '<span style="color:#888;font-size:10px;">availability:</span>' +
          MD.map(function(m, mi) {
            var isArr = Array.isArray(av[m]);
            var chk = isArr || av[m] === true;
            var h = '<label style="display:inline-flex;align-items:center;gap:2px;margin-right:6px;font-size:10px;cursor:pointer;"><input class="av-cb" data-idx="' + oi + '" data-mode="' + m + '" type="checkbox" ' + (chk?'checked':'') + '>' + ML[mi] + '</label>';
            if (mi < 2) {
              h += '层:' + FL.map(function(f) {
                return '<label style="display:inline-flex;align-items:center;gap:1px;margin-right:2px;font-size:9px;cursor:pointer;"><input class="av-fcb" data-idx="' + oi + '" data-mode="' + m + '" data-floor="' + f + '" type="checkbox" ' + (isArr&&av[m].includes(f)?'checked':'') + '>' + f + '</label>';
              }).join('') + ' ';
            }
            return h;
          }).join('') +
        '</div>' +
      '</div>';
    }).join('');
  } else {
    var keys = Object.keys(data[0]||{}).filter(function(k) { return k !== 'tags' && k !== 'sinCost' && k !== 'availability'; });
    html += items.map(function(item) {
      var oi = data.indexOf(item);
      return '<div class="edit-card" style="margin-bottom:12px;padding:10px;background:#1a1a2e;border-radius:6px;border:1px solid #2a2a4a;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
          '<span style="color:#ffd700;font-weight:bold;font-size:12px;">#' + (oi+1) + ' ' + escapeHtml(item.name||item.id||'') + '</span>' +
          '<button data-delete="' + oi + '" style="padding:2px 8px;background:#662222;color:#f44336;border:1px solid #883333;border-radius:3px;cursor:pointer;font-size:10px;">🗑</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:4px;">' +
          keys.map(function(k) { return '<div><span style="color:#888;font-size:10px;">' + k + '</span><input data-idx="' + oi + '" data-key="' + k + '" value="' + escapeHtml(String(item[k]??'')) + '" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>'; }).join('') +
        '</div>' +
      '</div>';
    }).join('');
  }
  content.innerHTML = html;

  // Add button
  var addBtn = document.getElementById('editor-add-item');
  if (addBtn) addBtn.addEventListener('click', function() {
    var template = JSON.parse(JSON.stringify(data[0] || {}));
    Object.keys(template).forEach(function(k) {
      if (typeof template[k] === 'string') template[k] = '';
      else if (Array.isArray(template[k])) template[k] = [];
      else if (typeof template[k] === 'object' && template[k]) template[k] = {};
    });
    template.id = 'new_' + Date.now();
    template.name = '新条目';
    var SINNER_ORDER = ['李箱','浮士德','堂吉诃德','良秀','默尔索','鸿璐','希斯克利夫','以实玛利','罗佳','辛克莱','奥提斯','格里高尔'];
    var lastSinner = template.sinner || '';
    var insertIdx = data.length;
    if (lastSinner) {
      var lastIdx = SINNER_ORDER.indexOf(lastSinner);
      if (lastIdx >= 0) {
        for (var i = data.length - 1; i >= 0; i--) {
          if (SINNER_ORDER.indexOf(data[i].sinner) <= lastIdx) { insertIdx = i + 1; break; }
        }
      }
    }
    data.splice(insertIdx, 0, template);
    renderEditorRows();
  });

  // Delete buttons
  content.querySelectorAll('button[data-delete]').forEach(function(b) {
    b.addEventListener('click', function() {
      if (!confirm('确定删除此条目？')) return;
      data.splice(parseInt(b.dataset.delete), 1);
      renderEditorRows();
    });
  });

  // Chip handlers: .cs = selected (click removes), .cg = suggest (click adds), .ci = custom input
  content.querySelectorAll('.cs').forEach(function(el) {
    el.addEventListener('click', function() {
      var idx = parseInt(el.dataset.idx);
      var field = el.dataset.field;
      var tag = el.dataset.tag;
      if (!data[idx]) return;
      var target = (field === 'coreMechanic') ? data[idx] : (data[idx].tags || (data[idx].tags = {}));
      var arr = target[field];
      if (!Array.isArray(arr)) arr = (arr && typeof arr === 'string') ? arr.split(/[,，、\s]+/).filter(Boolean) : [];
      target[field] = arr.filter(function(t) { return t !== tag; });
      renderEditorRows();
    });
  });
  content.querySelectorAll('.cg').forEach(function(el) {
    el.addEventListener('click', function() {
      var idx = parseInt(el.dataset.idx);
      var field = el.dataset.field;
      var tag = el.dataset.tag;
      if (!data[idx]) return;
      var target = (field === 'coreMechanic') ? data[idx] : (data[idx].tags || (data[idx].tags = {}));
      var arr = target[field];
      if (!Array.isArray(arr)) arr = (arr && typeof arr === 'string') ? arr.split(/[,，、\s]+/).filter(Boolean) : [];
      if (!arr.includes(tag)) arr.push(tag);
      target[field] = arr;
      renderEditorRows();
    });
  });
  content.querySelectorAll('.ci').forEach(function(inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && inp.value.trim()) {
        var idx = parseInt(inp.dataset.idx);
        var field = inp.dataset.field;
        var tag = inp.value.trim();
        if (!data[idx]) return;
        var target = (field === 'coreMechanic') ? data[idx] : (data[idx].tags || (data[idx].tags = {}));
        var arr = target[field];
        if (!Array.isArray(arr)) arr = (arr && typeof arr === 'string') ? arr.split(/[,，、\s]+/).filter(Boolean) : [];
        if (!arr.includes(tag)) arr.push(tag);
        target[field] = arr;
        inp.value = '';
        renderEditorRows();
      }
    });
  });
}

function addTag(idx, group, tag) {
  const item = _currentEditData[idx];
  if (!item) return;
  if (!item.tags) item.tags = {};
  if (!item.tags[group]) item.tags[group] = [];
  if (!item.tags[group].includes(tag)) {
    item.tags[group].push(tag);
    renderEditorRows();
  }
}

function removeTag(idx, group, tag) {
  const item = _currentEditData[idx];
  if (!item || !item.tags || !item.tags[group]) return;
  item.tags[group] = item.tags[group].filter(t => t !== tag);
  renderEditorRows();
}

async function saveEditorData() {
  const content = document.getElementById('editor-content');
  const type = _currentEditType;
  // Save plain text fields + selects
  const _splitArr = (v) => v ? v.split(/[,，、\s]+/).filter(Boolean) : [];
  const _tagKeys = {}; // faction/special now managed by chip system
  content.querySelectorAll('input[data-key]').forEach(input => {
    const idx = parseInt(input.dataset.idx);
    const key = input.dataset.key;
    let val = (input.type === 'checkbox') ? input.checked : input.value;
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    else if (_tagKeys[key]) val = _splitArr(val);
    if (_currentEditData[idx]) {
      // Route tag sub-keys to tags object for identity/EGO types
      if (_tagKeys[key] && (type === 'identities' || type === 'egos')) {
        if (!_currentEditData[idx].tags) _currentEditData[idx].tags = {};
        _currentEditData[idx].tags[key] = val;
      } else {
        _currentEditData[idx][key] = val;
      }
    }
  });
  content.querySelectorAll('select[data-key]').forEach(sel => {
    const idx = parseInt(sel.dataset.idx);
    const key = sel.dataset.key;
    if (_currentEditData[idx]) _currentEditData[idx][key] = sel.value;
  });
  // Save sinCost fields
  content.querySelectorAll('input[data-sinkey]').forEach(input => {
    const idx = parseInt(input.dataset.idx);
    const key = input.dataset.sinkey;
    const val = parseInt(input.value) || 0;
    if (_currentEditData[idx] && _currentEditData[idx].sinCost) {
      _currentEditData[idx].sinCost[key] = val;
    }
  });
  // Save cardpack availability
  if (type === 'cardpacks') {
    _currentEditData.forEach((item, idx) => {
      if (!item.availability) return;
      const modes = ['normal','hard','parallel','extreme'];
      modes.forEach(m => {
        const modeCB = content.querySelector(`.av-mode-cb[data-idx="${idx}"][data-mode="${m}"]`);
        const checked = modeCB ? modeCB.checked : false;
        if (m === 'parallel' || m === 'extreme') {
          item.availability[m] = checked;
        } else {
          if (checked) {
            const floors = [];
            content.querySelectorAll(`.av-floor-cb[data-idx="${idx}"][data-mode="${m}"]:checked`).forEach(cb => {
              floors.push(parseInt(cb.dataset.floor));
            });
            item.availability[m] = floors.length > 0 ? floors : [1];
          } else {
            item.availability[m] = [];
          }
        }
      });
    });
  }
  await window.electronAPI.saveData(type, _currentEditData);
  if (type === 'identities') { identities = _currentEditData; renderIdentityTable(); }
  if (type === 'egos') { egos = _currentEditData; renderEgoTable(); }
  showToast('💾', `${type} 已保存`);
}

function showDataStats() {
  const stats = [
    `人格: ${identities.length} 条 (已拥有: ${ownedIdentities.size})`,
    `EGO: ${egos.length} 条 (已拥有: ${ownedEgos.size})`,
    `人格池: ${identityPools.length} 个`,
  ];
  alert('📊 数据统计\n\n' + stats.join('\n'));
}

// ── Toast ──
function showToast(icon, message) {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `<strong>${icon} ${escapeHtml(message)}</strong>`;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ── Utility ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
