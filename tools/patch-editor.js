// Patch script: replace renderEditorRows and related handlers
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'renderer', 'js', 'main.js');
let code = fs.readFileSync(filePath, 'utf8');

// Find markers
const startMarker = 'function renderEditorRows() {';
const endMarker = 'function addTag(idx, group, tag) {';

let start = code.indexOf(startMarker);
let end = code.indexOf(endMarker);

if (start < 0 || end < 0) {
  console.error('MARKERS NOT FOUND!');
  console.log('start:', start, 'end:', end);
  process.exit(1);
}

const newCode = `
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
    effect:       { tags: ['烧伤','流血','震颤','破裂','沉沦','呼吸','充能'] },
    damageType:   { tags: ['打击','斩击','突刺'] },
    sinAffinity:  { tags: ['暴怒','色欲','怠惰','暴食','忧郁','傲慢','嫉妒'] },
    coreMechanic: { tags: ['烧伤','流血','震颤','破裂','沉沦','呼吸','充能'] },
  };
  function _arr(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'string') return v.split(/[,，、\\s]+/).filter(Boolean);
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
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.faction</span><input data-idx="' + oi + '" data-key="faction" value="' + escapeHtml((t.faction||[]).join('、')) + '" placeholder="逗号分隔" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.effect</span>' + _chips(oi, 'effect', t.effect) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.damageType</span>' + _chips(oi, 'damageType', t.damageType) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.sinAffinity</span>' + _chips(oi, 'sinAffinity', t.sinAffinity) + '</div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.special</span><input data-idx="' + oi + '" data-key="special" value="' + escapeHtml((t.special||[]).join('、')) + '" placeholder="逗号分隔" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
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
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.effect</span><input data-idx="' + oi + '" data-key="egoEffect" value="' + escapeHtml((t.effect||[]).join('、')) + '" placeholder="逗号分隔" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
          '<div style="margin-bottom:3px;"><span style="color:#888;font-size:10px;">tags.special</span><input data-idx="' + oi + '" data-key="special" value="' + escapeHtml((t.special||[]).join('、')) + '" placeholder="逗号分隔" style="width:100%;padding:2px 4px;background:#0f0f23;color:#e0e0e0;border:1px solid #333;border-radius:2px;font-size:11px;"></div>' +
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
      if (!Array.isArray(arr)) arr = (arr && typeof arr === 'string') ? arr.split(/[,，、\\s]+/).filter(Boolean) : [];
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
      if (!Array.isArray(arr)) arr = (arr && typeof arr === 'string') ? arr.split(/[,，、\\s]+/).filter(Boolean) : [];
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
        if (!Array.isArray(arr)) arr = (arr && typeof arr === 'string') ? arr.split(/[,，、\\s]+/).filter(Boolean) : [];
        if (!arr.includes(tag)) arr.push(tag);
        target[field] = arr;
        inp.value = '';
        renderEditorRows();
      }
    });
  });
}
`;

code = code.substring(0, start) + newCode + code.substring(end);
fs.writeFileSync(filePath, code);
console.log('DONE - replaced renderEditorRows and chip handlers');
