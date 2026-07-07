/**
 * 探索事件页面爬虫 — 浏览器 Console 脚本
 *
 * 使用方法：
 *   1. 浏览器打开 https://limbuscompany.huijiwiki.com/wiki/%E6%8E%A2%E7%B4%A2%E4%BA%8B%E4%BB%B6
 *   2. 等待页面完全加载，滚到底部确保所有内容渲染
 *   3. F12 打开控制台，粘贴此脚本，回车运行
 *   4. 自动复制到剪贴板 + 下载 events_raw.json
 *
 * 爬取范围：镜像迷宫 + 活动卡包 两大区块下的所有子区块（跳过主线探索）
 */

(function() {
  'use strict';

  console.log('=== 探索事件页面爬虫 ===');

  // ========== 辅助函数 ==========

  function getHeadingLevel(el) {
    const match = el.tagName && el.tagName.match(/^H(\d)$/);
    return match ? parseInt(match[1]) : 99;
  }

  // ========== 第一步：扫描所有标题 ==========

  const allHeadings = document.querySelectorAll('h1, h2, h3, h4');
  const headingInfos = [];

  allHeadings.forEach(h => {
    headingInfos.push({ el: h, text: h.textContent.trim(), level: getHeadingLevel(h) });
  });

  console.log('页面标题列表 (' + headingInfos.length + '个):');
  headingInfos.forEach((h, i) => {
    console.log('  [' + i + '] H' + h.level + ' | ' + h.text);
  });

  // ========== 第二步：定位镜像迷宫和活动卡包 ==========

  let mirrorIdx = -1;
  let cardpackIdx = -1;

  for (let i = 0; i < headingInfos.length; i++) {
    const t = headingInfos[i].text;
    if (t.includes('镜像迷宫')) {
      mirrorIdx = i;
      console.log('✓ 找到"镜像迷宫" [' + i + '] H' + headingInfos[i].level);
    }
    if (t.includes('活动卡包') || t.includes('活动')) {
      cardpackIdx = i;
      console.log('✓ 找到"活动卡包" [' + i + '] H' + headingInfos[i].level);
    }
  }

  if (mirrorIdx === -1 && cardpackIdx === -1) {
    console.error('❌ 未找到"镜像迷宫"或"活动卡包"标题！');
    return;
  }

  // ========== 第三步：核心爬取函数 ==========

  // 从 headingEl 开始遍历 DOM，收集所有事件行，直到遇到同级/上级标题
  function scrapeSection(headingEl) {
    const events = [];
    const startLevel = getHeadingLevel(headingEl);
    let current = headingEl.nextElementSibling;

    while (current) {
      // 只遇到同级或上级标题才停（穿透所有子标题继续爬）
      if (/^H[1-4]$/.test(current.tagName)) {
        if (getHeadingLevel(current) <= startLevel) {
          break;
        }
        // 子标题（H3/H4 在 H2 下）→ 继续
      }

      // 在表格行中查找事件
      const tables = [];
      if (current.tagName === 'TABLE') {
        tables.push(current);
      } else {
        tables.push(...current.querySelectorAll('table'));
      }

      for (const table of tables) {
        for (const row of table.querySelectorAll('tr')) {
          const tds = row.querySelectorAll('td');
          if (tds.length < 2) continue;

          // 左列必须有指向事件详情页的链接
          const detailLink = tds[0].querySelector('a[title^="事件-"], a[href*="/wiki/%E4%BA%8B%E4%BB%B6-"]');
          if (!detailLink) continue;

          const name = (detailLink.getAttribute('title') || '').replace(/^事件-/, '').trim();
          const detailUrl = detailLink.getAttribute('href') || '';

          // 图片（过滤饰品边框装饰图）
          const images = [];
          for (const img of tds[0].querySelectorAll('img')) {
            if (img.alt && img.alt.includes('边框')) continue;
            images.push({
              alt: img.getAttribute('alt') || '',
              src: img.getAttribute('src') || '',
              srcset: img.getAttribute('srcset') || '',
              width: img.getAttribute('width') || '',
              height: img.getAttribute('height') || '',
              fileWidth: img.getAttribute('data-file-width') || '',
              fileHeight: img.getAttribute('data-file-height') || '',
            });
          }

          const optionsRawHTML = tds[1].innerHTML.trim();

          if (name && optionsRawHTML) {
            events.push({ name, detailUrl, images, optionsRawHTML });
          }
        }
      }

      current = current.nextElementSibling;
    }

    return events;
  }

  // ========== 第四步：执行爬取 ==========

  let allEvents = [];

  // 镜像迷宫（从此标题到下一个同级/上级标题）
  if (mirrorIdx >= 0) {
    const mirrorEvents = scrapeSection(headingInfos[mirrorIdx].el);
    console.log('镜像迷宫区块：' + mirrorEvents.length + ' 个事件');
    allEvents = allEvents.concat(mirrorEvents);
  }

  // 活动卡包
  if (cardpackIdx >= 0) {
    const cardpackEvents = scrapeSection(headingInfos[cardpackIdx].el);
    console.log('活动卡包区块：' + cardpackEvents.length + ' 个事件');
    allEvents = allEvents.concat(cardpackEvents);
  }

  // ========== 第五步：输出 ==========

  console.log('\n=== 共 ' + allEvents.length + ' 个事件 ===');

  if (allEvents.length === 0) {
    console.error('❌ 未爬取到事件！可能原因：');
    console.error('  1. 事件不在 <table> 中');
    console.error('  2. 标题文本不匹配（查看上方标题列表）');
    return;
  }

  console.log('前5个事件:');
  allEvents.slice(0, 5).forEach((e, i) => {
    console.log('  [' + (i + 1) + '] ' + e.name + ' | 图:' + e.images.length + '张 | ' + e.detailUrl);
  });

  const jsonStr = JSON.stringify(allEvents, null, 2);
  console.log('\nJSON: ' + (jsonStr.length / 1024).toFixed(1) + ' KB');

  // 复制
  try {
    copy(jsonStr);
    console.log('✅ 已复制到剪贴板');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = jsonStr;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    console.log('✅ 已复制到剪贴板 (fallback)');
  }

  // 下载
  try {
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'events_raw.json';
    a.click();
    URL.revokeObjectURL(url);
    console.log('✅ 已下载 events_raw.json');
  } catch (e) {
    console.warn('⚠️ 下载失败: ' + e.message);
  }

  console.log('\n=== 完成 ===');

})();
