/**
 * 下载事件图片到本地 resources/events/
 *
 * 用法: node tools/download-event-images.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const EVENTS_PATH = path.join(__dirname, '..', 'data', 'events.json');
const IMAGE_DIR = path.join(__dirname, '..', 'resources', 'events');

const events = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
console.log(`Events: ${events.length}`);

if (!fs.existsSync(IMAGE_DIR)) {
  fs.mkdirSync(IMAGE_DIR, { recursive: true });
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

async function main() {
  let downloaded = 0, skipped = 0, failed = 0;

  for (const event of events) {
    if (!event.image || !event.image.startsWith('http')) {
      skipped++; continue;
    }

    const hash = crypto.createHash('md5').update(event.url).digest('hex').substring(0, 16);
    const filename = `event-${hash}.png`;
    const localPath = `resources/events/${filename}`;
    const fullPath = path.join(IMAGE_DIR, filename);

    if (fs.existsSync(fullPath)) {
      event.image = localPath;
      skipped++; continue;
    }

    try {
      process.stdout.write(`[${downloaded + 1}] ${event.name}...`);
      await downloadFile(event.image, fullPath);
      const stat = fs.statSync(fullPath);
      if (stat.size > 0) {
        event.image = localPath;
        downloaded++;
        console.log(` OK (${(stat.size / 1024).toFixed(0)}KB)`);
      } else {
        fs.unlinkSync(fullPath);
        throw new Error('Empty file');
      }
    } catch (e) {
      failed++;
      console.log(` FAIL: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 100));
  }

  fs.writeFileSync(EVENTS_PATH, JSON.stringify(events, null, 2), 'utf8');
  console.log(`\nDone: downloaded ${downloaded} | skipped ${skipped} | failed ${failed}`);
}

main().catch(console.error);
