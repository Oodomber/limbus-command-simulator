/**
 * parse-fusions.js — 从合成.txt提取饰品合成配方
 *
 * 用法: node tools/parse-fusions.js
 * 输入: data/合成.txt
 * 输出: data/fusions.json
 */

const fs = require('fs');
const path = require('path');

const INPUT = path.join(__dirname, '..', 'data', '合成.txt');
const OUTPUT = path.join(__dirname, '..', 'data', 'fusions.json');

const html = fs.readFileSync(INPUT, 'utf8');

// 用简单的正则+字符串方式解析，不引入额外依赖
// 策略：找到所有 table.wikitable，在每个table中提取所有span.label

// 提取所有表格
const tableRegex = /<table\s[^>]*class="wikitable"[^>]*>([\s\S]*?)<\/table>/gi;
const tables = [];
let tableMatch;
while ((tableMatch = tableRegex.exec(html)) !== null) {
  tables.push(tableMatch[1]);
}

console.log(`找到 ${tables.length} 个合成表格\n`);

const fusions = [];
const allEffectCategories = [];

for (const tableHtml of tables) {
  // 提取效果分类（第一个tr中的td colspan文本）
  const catMatch = tableHtml.match(/<td\s[^>]*colspan[^>]*>([^<]+)<\/td>/i);
  const category = catMatch ? catMatch[1].trim() : '未知';
  if (category !== '未知') allEffectCategories.push(category);

  // 提取所有行
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/gi;
  const rows = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    rows.push(rowMatch[1]);
  }

  // 跳过前两行（分类标题行 + 表头行）
  for (let r = 2; r < rows.length; r++) {
    const rowHtml = rows[r];

    // 检查是否是分隔行（包含 "a" "b" "c" 等字母标记的表头）
    const cleanedRow = rowHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
    if (/^[a-d]+$/.test(cleanedRow) || cleanedRow === '' || /^(a|b|c|d|e|f|g|h)$/.test(cleanedRow)) {
      continue;
    }

    // 提取所有 span.label 的名称
    const labelRegex = /<span\s[^>]*class="label"[^>]*>([^<]+)<\/span>/gi;
    const labels = [];
    let labelMatch;
    while ((labelMatch = labelRegex.exec(rowHtml)) !== null) {
      labels.push(labelMatch[1].trim());
    }

    if (labels.length < 2) continue; // 至少需要材料+结果

    const result = labels[labels.length - 1];
    const materials = labels.slice(0, -1);

    // 去重（有时同一个材料出现两次在row中）
    const uniqueMaterials = [...new Set(materials)];

    fusions.push({
      result,
      category,
      materials: uniqueMaterials,
      materialCount: uniqueMaterials.length,
    });
  }
}

// 按分类分组输出
console.log(`提取到 ${fusions.length} 条合成配方\n`);

const byCategory = {};
for (const f of fusions) {
  if (!byCategory[f.category]) byCategory[f.category] = [];
  byCategory[f.category].push(f);
}

for (const [cat, items] of Object.entries(byCategory)) {
  console.log(`  ${cat}: ${items.length} 条`);
  for (const item of items) {
    console.log(`    ${item.materials.join(' + ')} → ${item.result}`);
  }
}

// 写入
fs.writeFileSync(OUTPUT, JSON.stringify(fusions, null, 2), 'utf8');
console.log(`\n✅ 写入 ${OUTPUT} (${fusions.length} 条)`);

// 统计可合成饰品
const resultNames = new Set(fusions.map(f => f.result));
console.log(`   可合成的饰品: ${resultNames.size} 种`);
