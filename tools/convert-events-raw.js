/**
 * 将 events_raw.json 转换为标准 events.json 格式
 *
 * 用法: node tools/convert-events-raw.js
 *
 * 输入:
 *   ../events_raw (1).json  — 浏览器 Console 爬取的 168 条原始事件
 *   data/relics.json        — 饰品数据 (445条，用于数字代号→名称映射)
 *   data/events.json        — 现有事件数据 (保留手动整理过的选项标签)
 *
 * 输出:
 *   data/events.json        — 覆盖写入
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAW_PATH = path.join(__dirname, '..', '..', '爬取原始数据', 'events_raw.json');
const RELICS_PATH = path.join(__dirname, '..', 'data', 'relics.json');
const EXISTING_PATH = path.join(__dirname, '..', 'data', 'events.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'events.json');

// ========== 加载数据 ==========

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
const relics = JSON.parse(fs.readFileSync(RELICS_PATH, 'utf8'));
const existing = JSON.parse(fs.readFileSync(EXISTING_PATH, 'utf8'));

console.log(`Raw events: ${raw.length}`);
console.log(`Relics: ${relics.length}`);
console.log(`Existing events: ${existing.length}`);

// ========== 建立映射表 ==========

// 数字代号 → 饰品名称 (从事件-饰品关联反推)
const codeToName = {};
for (const ev of raw) {
  const url = ev.detailUrl;
  const matchedRelics = relics.filter(r => r.source && r.source.url === url);
  if (matchedRelics.length === 0) continue;

  const imgMatches = [...ev.optionsRawHTML.matchAll(/<img alt="饰品-([^"]+)"/g)];
  const relicRefs = imgMatches.map(m => m[1].replace('.png', ''));

  const namedRefs = relicRefs.filter(r => !/^\d+$/.test(r));
  const numericRefs = relicRefs.filter(r => /^\d+$/.test(r));
  const uniqueNumericRefs = [...new Set(numericRefs)];

  const eventRelicNames = matchedRelics.map(r => r.name);

  // Fuzzy match: check if a named ref matches a relic name
  function fuzzyMatches(ref, name) {
    if (name.includes(ref) || ref.includes(name)) return true;
    // Character overlap
    const refChars = new Set([...ref]);
    const nameChars = new Set([...name]);
    let shared = 0;
    for (const ch of refChars) { if (nameChars.has(ch)) shared++; }
    return shared / Math.max(ref.length, name.length) >= 0.55;
  }

  const unmatchedNames = eventRelicNames.filter(n =>
    !namedRefs.some(ref => fuzzyMatches(ref, n))
  );

  for (let i = 0; i < Math.min(uniqueNumericRefs.length, unmatchedNames.length); i++) {
    codeToName[uniqueNumericRefs[i]] = unmatchedNames[i];
  }
}
console.log(`Numeric code → name mappings: ${Object.keys(codeToName).length}`);

// Url → existing event 索引
const existingByUrl = {};
for (const ev of existing) {
  existingByUrl[ev.url] = ev;
}

// ========== 辅助函数 ==========

function generateId(detailUrl) {
  const hash = crypto.createHash('md5').update(detailUrl).digest('hex').substring(0, 16);
  return `event-${hash}`;
}

function stripHtml(html) {
  // Replace sin icons with text before stripping tags
  let processed = html.replace(/<img alt="罪孽-(\S+)\.png"[^>]*>/g, (_, sin) => {
    const sinNames = { '暴怒':'暴怒','色欲':'色欲','怠惰':'怠惰','暴食':'暴食','忧郁':'忧郁','傲慢':'傲慢','嫉妒':'嫉妒' };
    return sinNames[sin] || sin;
  });
  // Replace coin/currency icons
  processed = processed.replace(/<img alt="镜牢经费\.png"[^>]*>/g, '经费');
  return processed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** 从 HTML 中提取罪孽属性 */
function extractSins(html) {
  const sins = [];
  const sinMap = {
    '暴怒': '暴怒', '色欲': '色欲', '怠惰': '怠惰', '暴食': '暴食',
    '忧郁': '忧郁', '傲慢': '傲慢', '嫉妒': '嫉妒'
  };
  const sinMatches = html.matchAll(/罪孽-(\S+)\.png/g);
  for (const m of sinMatches) {
    const sin = sinMap[m[1]];
    if (sin && !sins.includes(sin)) sins.push(sin);
  }
  return sins;
}

/** 从 HTML 中提取判定阈值 */
function extractCheck(html) {
  // 模式1: 判定 X/Y
  const m1 = html.match(/判定\s*(\d+)\s*\/\s*(\d+)/);
  if (m1) {
    return {
      favorable: { value: `≥${m1[1]}`, sins: [] },
      unfavorable: { value: `≥${m1[2]}`, sins: [] }
    };
  }
  // 模式2: ≥X : ≥Y
  const m2 = html.match(/≥(\d+)\s*:\s*≥(\d+)/);
  if (m2) {
    return {
      favorable: { value: `≥${m2[1]}`, sins: [] },
      unfavorable: { value: `≥${m2[2]}`, sins: [] }
    };
  }
  return null;
}

/** 从文本中查找饰品名称（解决数字代号→名称映射） */
function resolveRelicName(text) {
  // 先尝试直接匹配 relic 名称
  for (const relic of relics) {
    if (text.includes(relic.name) && relic.name.length >= 2) {
      return relic.name;
    }
  }
  // 尝试数字代号映射
  const numMatch = text.match(/(\d{4})/);
  if (numMatch && codeToName[numMatch[1]]) {
    return codeToName[numMatch[1]];
  }
  return null;
}

/** 将候选名称匹配到 relics.json 中的标准名称（模糊匹配） */
function resolveToCanonicalName(candidate) {
  // 精确匹配
  const exact = relics.find(r => r.name === candidate);
  if (exact) return exact.name;
  // 包含匹配
  const contains = relics.find(r => r.name.includes(candidate) || candidate.includes(r.name));
  if (contains) return contains.name;
  // 模糊匹配（字符重叠度）
  let best = null, bestScore = 0;
  const candChars = new Set([...candidate]);
  for (const relic of relics) {
    const rn = relic.name || '';
    if (rn.length < 2) continue;
    const relicChars = new Set([...rn]);
    let shared = 0;
    for (const ch of candChars) { if (relicChars.has(ch)) shared++; }
    const score = shared / Math.max(candidate.length, rn.length);
    if (score > bestScore && score >= 0.55) { bestScore = score; best = relic; }
  }
  return best ? best.name : candidate;
}

/** 从 HTML 中直接提取饰品引用 (在 strip 之前)，按 relic ID 去重 */
function extractRelicRefsFromHtml(html) {
  const seenIds = new Set();
  const refs = [];
  const imgRegex = /<img alt="饰品-([^"]+)"/g;
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    const alt = m[1].replace(/\.png$/, '');
    let canonicalName;
    if (/^\d+$/.test(alt)) {
      canonicalName = codeToName[alt] || null;
    } else {
      canonicalName = resolveToCanonicalName(alt);
    }
    if (!canonicalName) continue;
    // 找到对应的 relic，按 ID 去重
    const relic = relics.find(r => r.name === canonicalName);
    const relicId = relic ? relic.id : canonicalName;
    if (seenIds.has(relicId)) continue;
    seenIds.add(relicId);
    refs.push(canonicalName);
  }
  return refs;
}

/** 从 HTML 中提取经费/货币奖励 */
function extractCurrencyRewards(html) {
  const rewards = [];
  // 匹配 "获得XX经费" 模式
  const m = html.match(/获得(\d+)[^>]*经费/);
  if (m) rewards.push(`${m[1]}经费`);
  return rewards;
}

/** 判断文本是否包含"什么都没有发生" */
function isNothingHappens(text) {
  return /什么都没有发生/.test(text) || /没有奖励/.test(text);
}

/** 解析单个选项的 HTML 块 */
function parseOptionBlock(html, parentLabel) {
  const text = stripHtml(html);
  const sins = extractSins(html);
  const check = extractCheck(html);
  const relicRefs = extractRelicRefsFromHtml(html);
  const currencyRewards = extractCurrencyRewards(html);

  // 提取条件文本
  const condMatch = text.match(/[（(](.+?)[）)]/);
  let subtitle = condMatch ? condMatch[1] : '';

  let description = text;
  let results = [];

  // === 检测嵌套的成功/失败分支 ===
  // 在 HTML 中找嵌套的 <ul><li>成功/失败</li></ul>
  const nestedListMatch = html.match(/<ul>(.+?)<\/ul>/s);
  const hasNestedBranches = nestedListMatch && /成功|失败/.test(nestedListMatch[1]);

  if (hasNestedBranches) {
    // 解析嵌套分支：先分割嵌套的<li>
    const nestedInner = nestedListMatch[1].replace(/^<ul>/, '').replace(/<\/ul>$/, '');
    const nestedLis = nestedInner.split(/<\/li>\s*<li[^>]*>/);

    const branches = [];
    for (const liHtml of nestedLis) {
      const cleaned = liHtml.replace(/^<li[^>]*>/, '').replace(/<\/li>$/, '').trim();
      if (!cleaned) continue;

      // 提取标签颜色 (67AD69=成功绿, CD3532=失败红)
      const labelMatch = cleaned.match(/<span class="label"[^>]*style="background:\s*#(67AD69|CD3532)[^"]*"[^>]*>([^<]+)<\/span>/);
      if (!labelMatch) continue;

      const isSuccess = labelMatch[1] === '67AD69';
      const label = labelMatch[2];
      // 标签后面的全部内容
      const afterLabel = cleaned.substring(labelMatch.index + labelMatch[0].length);
      const branchText = stripHtml(afterLabel);
      const branchRelics = extractRelicRefsFromHtml(afterLabel);

      branches.push({ isSuccess, label, text: branchText, relics: branchRelics });
    }

    // 构建结果
    if (check && branches.length >= 2) {
      // 有罪孽判定 → 成功/失败分支
      const successBranch = branches.find(b => b.isSuccess);
      const failBranch = branches.find(b => !b.isSuccess);

      if (successBranch) {
        results.push({
          outcome: '判定成功',
          text: successBranch.text,
          effects: successBranch.relics.map(r => ({ text: `获得E.G.O饰品 ${r}`, reward: r }))
        });
      }
      if (failBranch) {
        results.push({
          outcome: '判定失败',
          text: failBranch.text,
          effects: failBranch.relics.map(r => ({ text: `获得E.G.O饰品 ${r}`, reward: r }))
        });
      }
    } else if (branches.length >= 2) {
      // 无条件判定但有成功/失败（条件分支）
      for (const branch of branches) {
        results.push({
          outcome: branch.label,
          text: branch.text,
          effects: branch.relics.map(r => ({ text: `获得E.G.O饰品 ${r}`, reward: r }))
        });
      }
    }
  }

  // === 检测战斗遭遇 ===
  if (/遭遇/.test(text) && /集中战斗/.test(html)) {
    // 提取战斗奖励
    const afterCombat = html.substring(html.lastIndexOf('战斗胜利'));
    const combatRelics = extractRelicRefsFromHtml(afterCombat);

    if (combatRelics.length > 0) {
      results.push({
        outcome: '战斗胜利',
        text: '获得' + combatRelics.map(r => `E.G.O饰品 ${r}`).join('、'),
        effects: combatRelics.map(r => ({ text: `获得E.G.O饰品 ${r}`, reward: r }))
      });
    }

    // 战斗失败
    if (/战斗失败/.test(text)) {
      results.push({
        outcome: '战斗失败',
        text: '没有奖励',
        effects: []
      });
    }
  }

  // === 如果没有子结果，直接从主文本提取 ===
  if (results.length === 0 && relicRefs.length > 0) {
    results.push({
      outcome: '获得',
      text: '获得' + relicRefs.map(r => `E.G.O饰品 ${r}`).join('、'),
      effects: relicRefs.map(r => ({ text: `获得E.G.O饰品 ${r}`, reward: r }))
    });
  }

  // 填充罪孽判定
  if (check) {
    check.favorable.sins = sins;
    check.unfavorable.sins = [];
  }

  return {
    label: parentLabel || '选项',
    subtitle,
    description,
    check,
    results,
  };
}

/** 分割顶级 <li>：只分割 depth=0 的 <li>，嵌套在 <ul> 内的不分割 */
function splitTopLevelLi(html) {
  let inner = html.replace(/^<ul>/, '').replace(/<\/ul>\s*$/, '');

  // 找到所有 <li 的位置
  const liPositions = [];
  const liRegex = /<li[>\s]/g;
  let m;
  while ((m = liRegex.exec(inner)) !== null) {
    liPositions.push(m.index);
  }

  // 对每个位置，检查前方 <ul> 和 </ul> 数量是否相等（depth=0）
  const splitPoints = [];
  for (const pos of liPositions) {
    const before = inner.substring(0, pos);
    const ulOpens = (before.match(/<ul[>\s]/g) || []).length;
    const ulCloses = (before.match(/<\/ul>/g) || []).length;
    if (ulOpens === ulCloses) {
      splitPoints.push(pos);
    }
  }

  // 按分割点切分
  const parts = [];
  for (let i = 0; i < splitPoints.length; i++) {
    const start = splitPoints[i];
    const end = (i + 1 < splitPoints.length) ? splitPoints[i + 1] : inner.length;
    parts.push(inner.substring(start, end));
  }

  // 清理：去 <li> </li> 标签
  return parts
    .map(p => p.replace(/^<li[^>]*>/, '').replace(/<\/li>$/, '').trim())
    .filter(p => p);
}

/** 解析整个 optionsRawHTML */
function parseOptions(rawHTML, codeToNameMap) {
  const options = [];
  const topLevelLis = splitTopLevelLi(rawHTML);

  topLevelLis.forEach((liHtml, idx) => {
    if (!liHtml) return;

    // 提取选项标签 (从 span.label)
    const labelMatch = liHtml.match(/<span class="label"[^>]*>([^<]+)<\/span>/);
    const optionLabel = labelMatch ? labelMatch[1] : `选项${idx + 1}`;

    const option = parseOptionBlock(liHtml, optionLabel);
    option._tabText = optionLabel;
    options.push(option);
  });

  return options;
}

/** 从现有数据提取选项标签 (用于保留手动整理过的标签) */
function extractExistingLabels(existingEvent) {
  if (!existingEvent) return [];
  return existingEvent.options.map(opt => opt.label);
}

// ========== 主转换逻辑 ==========

const output = [];
const errors = [];
let fixedNames = 0;
let fixedImages = 0;
let newEvents = 0;

for (const rawEvent of raw) {
  try {
    const url = rawEvent.detailUrl;
    const existing = existingByUrl[url];

    // 基础字段
    const event = {
      id: existing ? existing.id : generateId(url),
      name: '事件-' + rawEvent.name,
      url: url,
      image: null,
      options: []
    };

    // 图片处理
    if (existing && existing.image && existing.image.startsWith('resources/')) {
      event.image = existing.image;
    } else if (rawEvent.images && rawEvent.images.length > 0) {
      // 存储远程 URL（orb.js 需要适配，或后续下载到本地）
      event.image = rawEvent.images[0].src || null;
      if (!existing || !existing.image) fixedImages++;
    }

    // 解析选项
    const parsedOptions = parseOptions(rawEvent.optionsRawHTML, codeToName);

    // 如果存在旧数据，保留手动整理的标签
    if (existing) {
      const oldLabels = extractExistingLabels(existing);
      for (let i = 0; i < Math.min(parsedOptions.length, oldLabels.length); i++) {
        if (oldLabels[i] && oldLabels[i] !== parsedOptions[i]._tabText) {
          parsedOptions[i].label = oldLabels[i];
        }
      }
    }

    // 对于没有从旧数据拿到标签的选项，使用 _tabText 作为标签
    for (const opt of parsedOptions) {
      if (!opt.label || opt.label === '选项' || (opt._tabText && opt.label === opt._tabText)) {
        opt.label = opt._tabText || opt.label;
      }
    }

    event.options = parsedOptions;
    output.push(event);

    if (!existing) newEvents++;
    if (existing && existing.name !== event.name) fixedNames++;

  } catch (e) {
    console.error(`Error processing event "${rawEvent.name}":`, e.message);
    errors.push({ name: rawEvent.name, error: e.message });
  }
}

// ========== 处理"仅存于现有"的事件 (raw 中没有的) ==========
// 这些可能是 404 错误或名称不匹配的，需要检查是否需要保留
const rawUrls = new Set(raw.map(r => r.detailUrl));
const orphanedExisting = existing.filter(ev => !rawUrls.has(ev.url));

if (orphanedExisting.length > 0) {
  console.log('\n现有数据中在 raw 找不到的事件:');
  for (const ev of orphanedExisting) {
    console.log(`  - ${ev.name} (${ev.url})`);
  }
  // 不自动合并（这些可能是有问题的数据），手动检查
}

// ========== 去重 ==========
const seenUrls = new Set();
const deduped = [];
for (const ev of output) {
  if (!seenUrls.has(ev.url)) {
    seenUrls.add(ev.url);
    deduped.push(ev);
  }
}

// ========== 输出统计 ==========
console.log('\n=== 转换结果 ===');
console.log(`总事件数: ${deduped.length}`);
console.log(`新增事件: ${newEvents}`);
console.log(`名称修正: ${fixedNames}`);
console.log(`图片补充: ${fixedImages}`);
console.log(`重复移除: ${output.length - deduped.length}`);
console.log(`解析错误: ${errors.length}`);

if (errors.length > 0) {
  console.log('\n错误详情:');
  errors.forEach(e => console.log(`  ❌ ${e.name}: ${e.error}`));
}

// ========== 写入文件 ==========
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(deduped, null, 2), 'utf8');
console.log(`\n✅ 已写入 ${OUTPUT_PATH} (${(JSON.stringify(deduped).length / 1024).toFixed(1)} KB)`);

// ========== 同时备份旧文件 ==========
const backupPath = OUTPUT_PATH.replace('.json', '_backup.json');
fs.writeFileSync(backupPath, JSON.stringify(existing, null, 2), 'utf8');
console.log(`📦 旧文件备份至 ${backupPath}`);
