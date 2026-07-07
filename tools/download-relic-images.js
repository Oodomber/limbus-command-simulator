/**
 * download-relic-images.js — 批量下载饰品图片到本地
 *
 * 用法: node tools/download-relic-images.js
 *
 * 从 data/relics.json 读取图片URL，下载到 resources/relics/
 * 同时更新 relics.json 中的 image 字段为本地相对路径
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const RELICS_PATH = path.join(__dirname, '..', 'data', 'relics.json');
const IMG_DIR = path.join(__dirname, '..', 'resources', 'relics');

const CONCURRENCY = 8;  // 并发数
const TIMEOUT = 15000;

/**
 * 将缩略图URL转为原图URL
 * 缩略图: https://huiji-thumb.huijistatic.com/limbuscompany/uploads/thumb/a/b/filename.png/60px-filename.png
 * 原图:   https://huiji-public.huijistatic.com/limbuscompany/uploads/a/b/filename.png
 */
function thumbToOriginal(thumbUrl) {
  // 匹配 /thumb/hash1/hash2/filename/size-filename
  const m = thumbUrl.match(/\/thumb\/([^/]+\/[^/]+\/([^/]+))\//);
  if (m) {
    return `https://huiji-public.huijistatic.com/limbuscompany/uploads/${m[1]}`;
  }
  // fallback: 直接去掉 /thumb/ 和 /Npx- 部分
  let url = thumbUrl.replace('/thumb/', '/').replace(/\/\d+px-[^/]+$/, '');
  url = url.replace('huiji-thumb', 'huiji-public');
  return url;
}

/** 获取文件扩展名 */
function getExt(url, contentType) {
  if (contentType) {
    const m = contentType.match(/image\/(\w+)/);
    if (m) return '.' + m[1].replace('jpeg', 'jpg');
  }
  const m = url.match(/\.(png|jpg|jpeg|webp|gif)(\?|$|#)/i);
  return m ? '.' + m[1].toLowerCase() : '.png';
}

/** 下载单张图片 */
function downloadImage(savePath, url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: TIMEOUT }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(savePath, res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }

      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        fs.writeFileSync(savePath, buffer);
        resolve({ size: buffer.length, type: res.headers['content-type'] });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** 限流并发下载 */
async function downloadAll(items, concurrency) {
  const results = [];
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      const item = items[i];
      try {
        const result = await downloadImage(item.path, item.url);
        results[i] = { ok: true, ...result };
      } catch (e) {
        results[i] = { ok: false, error: e.message };
      }
      completed++;
      if (completed % 20 === 0 || completed === items.length) {
        process.stdout.write(`\r  ${completed}/${items.length}`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  console.log('');
  return results;
}

// ═══ 主流程 ═══
(async function main() {
  console.log('🔽 饰品图片批量下载\n');

  const relics = JSON.parse(fs.readFileSync(RELICS_PATH, 'utf8'));
  console.log(`📋 ${relics.length} 条饰品`);

  // 准备下载列表
  fs.mkdirSync(IMG_DIR, { recursive: true });

  const downloadItems = [];
  for (const relic of relics) {
    if (!relic.image) continue;
    const ext = getExt(relic.image);
    const filename = relic.id + ext;
    const savePath = path.join(IMG_DIR, filename);

    // 跳过已存在的
    if (fs.existsSync(savePath)) {
      downloadItems.push({ relic, path: savePath, url: relic.image, skip: true });
      continue;
    }

    const originalUrl = thumbToOriginal(relic.image);
    downloadItems.push({ relic, path: savePath, url: originalUrl, skip: false });
  }

  const toDownload = downloadItems.filter(x => !x.skip);
  console.log(`  已存在: ${downloadItems.length - toDownload.length}`);
  console.log(`  需下载: ${toDownload.length}\n`);

  if (toDownload.length === 0) {
    console.log('✅ 全部已下载');
    updateImagePaths(relics, downloadItems);
    return;
  }

  // 下载
  const results = await downloadAll(toDownload, CONCURRENCY);
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);

  console.log(`\n✅ 成功: ${ok.length}`);
  if (fail.length > 0) {
    console.log(`❌ 失败: ${fail.length}`);
    fail.forEach((r, i) => console.log(`   ${toDownload[i].relic.name}: ${r.error}`));
  }

  // 更新 image 路径
  updateImagePaths(relics, downloadItems);
})();

function updateImagePaths(relics, downloadItems) {
  // 建立 id→本地路径 映射
  const map = {};
  for (const item of downloadItems) {
    const localPath = 'resources/relics/' + path.basename(item.path);
    map[item.relic.id] = localPath;
  }

  // 更新
  let updated = 0;
  for (const relic of relics) {
    if (map[relic.id]) {
      relic.image = map[relic.id];
      updated++;
    }
  }

  fs.writeFileSync(RELICS_PATH, JSON.stringify(relics, null, 2), 'utf8');
  console.log(`✅ 更新了 ${updated} 条 image 路径 → data/relics.json`);
}
