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

  const isEgo = type === 'ego';
  const checkedCount = isEgo
    ? egos.filter(e => ownedEgos.has(e.id)).length
    : identities.filter(i => ownedIdentities.has(i.id)).length;
  const unitName = isEgo ? 'EGO' : '人格';

  const overlay = document.createElement('div');
  overlay.id = 'pool-name-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a1a2e;border:2px solid #ffd700;border-radius:12px;padding:24px;min-width:320px;';
  box.innerHTML = `
    <h3 style="color:#ffd700;margin:0 0 4px;">📝 新建${unitName}池</h3>
    <p style="color:#aaa;font-size:0.85em;margin:0 0 12px;">将使用当前已勾选的 <b style="color:#ffd700;">${checkedCount}</b> 个${unitName}来创建池</p>
    <input id="pool-name-input" type="text" placeholder="输入池名称"
      style="width:100%;padding:10px;background:#0f0f23;color:#e0e0e0;border:1px solid #3a3a5a;border-radius:6px;font-size:14px;margin-bottom:16px;">
    <div style="display:flex;gap:8px;">
      <button id="pool-name-confirm" style="flex:1;padding:10px;background:#ffd700;color:#1a1a2e;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">创建</button>
      <button id="pool-name-cancel" style="flex:1;padding:10px;background:#333;color:#aaa;border:1px solid #444;border-radius:6px;cursor:pointer;">取消</button>
    </div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const input = document.getElementById('pool-name-input');

  // Multi-layered focus strategy:
  // 1) Ask main process to focus the window (fire-and-forget)
  window.electronAPI.focusWindow().catch(() => {});

  // 2) Focus the input after layout is complete
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });

  // 3) Fallback: clicking anywhere on the overlay focuses the input
  //    (handles cases where OS focus wasn't on the window)
  overlay.addEventListener('click', (e) => {
    // Don't interfere with button clicks
    if (e.target.tagName === 'BUTTON') return;
    input.focus();
  });

  // 4) Safety net: repeated focus attempts
  for (const delay of [100, 300, 600]) {
    setTimeout(() => {
      if (document.getElementById('pool-name-modal') && document.activeElement !== input) {
        input.focus();
      }
    }, delay);
  }

  document.getElementById('pool-name-confirm').addEventListener('click', () => {
    overlay.remove();
    callback(input.value.trim());
  });
  document.getElementById('pool-name-cancel').addEventListener('click', () => {
    overlay.remove();
    callback(null);
  });

  // Prevent key events from leaking through to the main window
  overlay.addEventListener('keydown', (e) => {
    e.stopPropagation();
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
    <img src="../resources/images/index.png" style="width:56px;height:56px;object-fit:contain;margin-bottom:8px;" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><div style="font-size:48px;margin-bottom:8px;display:none;">☝</div>
    <h3 style="color:#ffd700;margin:0 0 16px;">开发者验证</h3>
    <input id="dev-pwd-input" type="password" placeholder="请输入密码"
      style="width:100%;padding:10px;background:#0f0f23;color:#e0e0e0;border:1px solid #3a3a5a;border-radius:6px;font-size:14px;margin-bottom:12px;text-align:center;">
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

  // Multi-layered focus strategy
  window.electronAPI.focusWindow().catch(() => {});

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      input.focus();
    });
  });

  // Fallback: clicking anywhere on overlay focuses the input
  overlay.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    input.focus();
  });

  // Safety net: repeated focus attempts
  for (const delay of [100, 300, 600]) {
    setTimeout(() => {
      if (document.getElementById('dev-auth-modal') && document.activeElement !== input) {
        input.focus();
      }
    }, delay);
  }

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

  // Ensure main window has OS focus for input fields
  window.electronAPI.focusWindow().catch(() => {});

  // Load current settings
  const config = await window.electronAPI.getConfig('settings') || {};
  const freeMin = config.freeInstructionIntervalMin ?? 180;
  const freeMax = config.freeInstructionIntervalMax ?? 300;
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
      <button class="dev-menu-btn" data-action="reset-stats" style="color:#ff6b6b;">🗑 重置累计数据（加护/业/历史/成就）</button>
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
  box.querySelector('[data-action="reset-stats"]').addEventListener('click', async () => {
    if (!confirm('确认重置？\n\n这将清空：\n- 累计指令加护 / 业\n- 指令历史记录\n- 成就进度\n\n此操作不可撤销！')) return;
    await window.electronAPI.resetStats();
    await refreshGlobalStats();
    showToast('🗑', '累计数据已重置');
  });
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
    await window.electronAPI.setConfig('settings.freeInstructionIntervalMin', parseInt(freeMinEl.value) || 180);
    showToast('⚙', `自由指令最小间隔 → ${freeMinEl.value}秒`);
  });
  if (freeMaxEl) freeMaxEl.addEventListener('change', async () => {
    await window.electronAPI.setConfig('settings.freeInstructionIntervalMax', parseInt(freeMaxEl.value) || 300);
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

  // Ensure main window has OS focus for input fields
  window.electronAPI.focusWindow().catch(() => {});

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
  // Convert templates object to editable array of {key, variants}
  if (type === 'templates' && _currentEditData && !Array.isArray(_currentEditData)) {
    _currentEditData = Object.entries(_currentEditData).map(([key, variants]) => ({
      key,
      variants: Array.isArray(variants) ? [...variants] : [],
    }));
  }
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
  } else if (type === 'templates') {
    // ── Phase-grouped template editor ──
    var PHASE_GROUPS = [
      { label: '编队-人格', phase: 'deploy_identity', keys: ['deploy_identity','deploy_identity_vague'] },
      { label: '编队-EGO', phase: 'deploy_ego', keys: ['deploy_ego','deploy_ego_force_base'] },
      { label: '星光', phase: 'starlight', keys: ['starlight','starlight_none'] },
      { label: '开局饰品', phase: 'starting_relic', keys: ['starting_relic','starting_relic_none'] },
      { label: '卡包', phase: 'cardpack', keys: ['cardpack_pick','cardpack_position','cardpack_reroll'] },
      { label: '路线', phase: 'route', keys: ['route'] },
      { label: '战斗', phase: 'combat', keys: ['combat_no_formation','combat_defend_all','combat_no_ego','combat_win_rate','combat_damage','combat_all_upper','combat_all_lower','combat_upper_skill','combat_lower_skill','combat_use_ego','combat_overclock_ego','combat_guard','combat_speed_attack','combat_speed_guard','combat_speed_ego','combat_speed_overclock','combat_golden_bough'] },
      { label: '事件', phase: 'event', keys: ['event_option','event_vague'] },
      { label: '事件奖励', phase: 'event_reward', keys: ['event_reward'] },
      { label: '商店', phase: 'shop', keys: ['shop_buy','shop_sell','shop_sell_ash','shop_fuse','shop_no_heal','shop_reroll','shop_upgrade','shop_keyword_reroll','shop_replace_skill','shop_change_identity','shop_change_identity_multi','shop_change_identity_triple','shop_special_probability','shop_heal'] },
      { label: '隐藏BOSS', phase: 'hidden_boss', keys: ['hidden_boss_fight','hidden_boss_leave'] },
      { label: '判定', phase: 'judgment', keys: ['judgment'] },
      { label: '关底奖励', phase: 'boss_reward', keys: ['boss_reward'] },
      { label: '自由指令', phase: 'free_instruction', keys: ['free_instruction'] },
    ];
    // Build lookup: template key → phase group
    var KEY_TO_GROUP = {};
    PHASE_GROUPS.forEach(function(g) {
      g.keys.forEach(function(k) { KEY_TO_GROUP[k] = g; });
    });
    // Collect keys already assigned to groups
    var assignedKeys = new Set(Object.keys(KEY_TO_GROUP));
    // Any unassigned template keys go to "其他"
    var otherKeys = items.filter(function(item) { return !assignedKeys.has(item.key); });

    function _extractVars(variants) {
      var vs = new Set();
      (variants||[]).forEach(function(v) {
        var m = v.match(/\{(\w+)\}/g);
        if (m) m.forEach(function(t) { vs.add(t.slice(1,-1)); });
      });
      return Array.from(vs);
    }

    function _renderTemplateCard(item, oi) {
      var allVars = _extractVars(item.variants);
      var varTags = allVars.map(function(v) {
        return '<span style="display:inline-block;padding:1px 6px;background:#1a3a5a;color:#7ab8e0;border-radius:3px;font-size:9px;margin:1px 2px;" title="可填入标签">{' + escapeHtml(v) + '}</span>';
      }).join('');

      var variantRows = (item.variants||[]).map(function(variant, vi) {
        return '<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;">' +
          '<input data-tpl-idx="' + oi + '" data-vi="' + vi + '" value="' + escapeHtml(variant) + '" style="flex:1;padding:3px 6px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:3px;font-size:11px;font-family:monospace;">' +
          '<button data-del-var="' + oi + '" data-vi="' + vi + '" title="删除此变体" style="padding:2px 6px;background:#662222;color:#f44336;border:1px solid #883333;border-radius:3px;cursor:pointer;font-size:10px;flex-shrink:0;">✕</button>' +
        '</div>';
      }).join('');

      return '<div class="tpl-card" style="margin-bottom:8px;padding:8px 10px;background:#141428;border-radius:4px;border:1px solid #252545;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
          '<div><code style="color:#ffd700;font-size:12px;font-weight:bold;">' + escapeHtml(item.key) + '</code>' +
          (varTags ? ' <span style="margin-left:8px;">' + varTags + '</span>' : '') + '</div>' +
          '<button data-del-tpl="' + oi + '" title="删除此模板" style="padding:2px 8px;background:#662222;color:#f44336;border:1px solid #883333;border-radius:3px;cursor:pointer;font-size:10px;">🗑 模板</button>' +
        '</div>' +
        '<div style="margin-bottom:4px;">' + variantRows + '</div>' +
        '<button data-add-var="' + oi + '" style="padding:2px 10px;background:#2a4a2a;color:#8fdf8f;border:1px solid #3a5a3a;border-radius:3px;cursor:pointer;font-size:10px;">+ 添加变体</button>' +
      '</div>';
    }

    html += '<div style="margin-bottom:12px;"><button id="editor-add-template" style="padding:6px 16px;background:#4caf50;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">➕ 新增模板</button><span style="color:#888;font-size:12px;margin-left:8px;">共 ' + data.length + ' 个模板</span></div>';

    PHASE_GROUPS.forEach(function(group) {
      var groupItems = items.filter(function(item) { return group.keys.indexOf(item.key) !== -1; });
      html += '<div class="tpl-phase-section" style="margin-bottom:16px;border:1px solid #333;border-radius:6px;overflow:hidden;">' +
        '<div class="tpl-phase-header" data-phase="' + group.phase + '" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#1a1a3a;cursor:pointer;user-select:none;">' +
          '<span style="color:#ffd700;font-weight:bold;font-size:14px;">📋 ' + escapeHtml(group.label) + ' <span style="color:#888;font-weight:normal;font-size:11px;">(' + group.phase + ')</span></span>' +
          '<span style="color:#888;font-size:11px;">' + groupItems.length + ' 个模板 ▾</span>' +
        '</div>' +
        '<div class="tpl-phase-body" style="padding:8px 12px;background:#0a0a1a;">' +
          (groupItems.length > 0 ? groupItems.map(function(item) { return _renderTemplateCard(item, data.indexOf(item)); }).join('') : '<p style="color:#555;font-size:11px;padding:8px;">（此环节暂无模板）</p>') +
        '</div>' +
      '</div>';
    });

    // Other/unassigned templates
    if (otherKeys.length > 0) {
      html += '<div class="tpl-phase-section" style="margin-bottom:16px;border:1px solid #333;border-radius:6px;overflow:hidden;">' +
        '<div class="tpl-phase-header" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#1a1a3a;cursor:pointer;user-select:none;">' +
          '<span style="color:#ff9800;font-weight:bold;font-size:14px;">📋 其他 <span style="color:#888;font-weight:normal;font-size:11px;">(未归类)</span></span>' +
          '<span style="color:#888;font-size:11px;">' + otherKeys.length + ' 个模板 ▾</span>' +
        '</div>' +
        '<div class="tpl-phase-body" style="padding:8px 12px;background:#0a0a1a;">' +
          otherKeys.map(function(item) { return _renderTemplateCard(item, data.indexOf(item)); }).join('') +
        '</div>' +
      '</div>';
    }

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

  // ── Template editor event handlers ──
  if (type === 'templates') {
    // Phase collapse toggle
    content.querySelectorAll('.tpl-phase-header').forEach(function(hdr) {
      hdr.addEventListener('click', function() {
        var body = hdr.nextElementSibling;
        if (body) { body.style.display = body.style.display === 'none' ? '' : 'none'; }
      });
    });
    // Add new template
    var addTplBtn = document.getElementById('editor-add-template');
    if (addTplBtn) addTplBtn.addEventListener('click', function() {
      var newKey = prompt('请输入新模板的键名（如 combat_new）：');
      if (!newKey || !newKey.trim()) return;
      // Check duplicates
      if (data.some(function(item) { return item.key === newKey.trim(); })) {
        alert('模板键名 "' + newKey.trim() + '" 已存在！');
        return;
      }
      data.push({ key: newKey.trim(), variants: [''] });
      renderEditorRows();
    });
    // Add variant
    content.querySelectorAll('button[data-add-var]').forEach(function(b) {
      b.addEventListener('click', function() {
        var idx = parseInt(b.dataset.addVar);
        if (!data[idx] || !Array.isArray(data[idx].variants)) return;
        data[idx].variants.push('');
        renderEditorRows();
      });
    });
    // Delete variant
    content.querySelectorAll('button[data-del-var]').forEach(function(b) {
      b.addEventListener('click', function() {
        var idx = parseInt(b.dataset.delVar);
        var vi = parseInt(b.dataset.vi);
        if (!data[idx] || !Array.isArray(data[idx].variants)) return;
        if (data[idx].variants.length <= 1) {
          alert('至少保留一个模板变体。若要删除整个模板请点击"🗑 模板"。');
          return;
        }
        data[idx].variants.splice(vi, 1);
        renderEditorRows();
      });
    });
    // Delete template
    content.querySelectorAll('button[data-del-tpl]').forEach(function(b) {
      b.addEventListener('click', function() {
        var idx = parseInt(b.dataset.delTpl);
        var tplKey = data[idx] ? data[idx].key : '未知';
        if (!confirm('确定删除模板 "' + tplKey + '" 吗？此操作不可恢复。')) return;
        data.splice(idx, 1);
        renderEditorRows();
      });
    });
  }

  // Add button
  var addBtn = document.getElementById('editor-add-item');
  if (addBtn) addBtn.addEventListener('click', function() {
    if (type === 'templates') {
      var newKey = prompt('请输入新模板的键名（如 combat_new）：');
      if (!newKey || !newKey.trim()) return;
      if (data.some(function(item) { return item.key === newKey.trim(); })) {
        alert('模板键名 "' + newKey.trim() + '" 已存在！');
        return;
      }
      data.push({ key: newKey.trim(), variants: [''] });
      renderEditorRows();
      return;
    }
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
  // Save template variants (stored in data-tpl-idx / data-vi inputs)
  if (type === 'templates') {
    content.querySelectorAll('input[data-tpl-idx]').forEach(input => {
      const idx = parseInt(input.dataset.tplIdx);
      const vi = parseInt(input.dataset.vi);
      if (_currentEditData[idx] && Array.isArray(_currentEditData[idx].variants)) {
        _currentEditData[idx].variants[vi] = input.value;
      }
    });
    // Remove empty variants (keep at least one)
    _currentEditData.forEach(function(item) {
      if (Array.isArray(item.variants)) {
        item.variants = item.variants.filter(function(v) { return v.trim() !== ''; });
        if (item.variants.length === 0) item.variants = [''];
      }
    });
    // Convert array back to object for saving
    const obj = {};
    _currentEditData.forEach(function(item) {
      obj[item.key] = item.variants;
    });
    await window.electronAPI.saveData(type, obj);
    showToast('💾', `${type} 已保存`);
    return;
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
