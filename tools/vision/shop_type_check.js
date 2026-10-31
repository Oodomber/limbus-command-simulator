// 校验「普通商店 / 特殊商店」判据：把 datasets/frames/shop 下所有帧过一遍 readShopType
// 跑法：$env:ELECTRON_RUN_AS_NODE=''; & .\node_modules\electron\dist\electron.exe tools\vision\shop_type_check.js
const path = require('path');
const fs = require('fs');
const { app, nativeImage } = require('electron');
const readers = require('../../src/vision/readers');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'datasets', 'frames', 'shop');

function bgraToRGBA(bmp, width, height) {
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    rgba[i * 4] = bmp[p + 2];
    rgba[i * 4 + 1] = bmp[p + 1];
    rgba[i * 4 + 2] = bmp[p];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

app.whenReady().then(() => {
  const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  let norm = 0;
  let spec = 0;
  for (const f of files) {
    const img = nativeImage.createFromPath(path.join(DIR, f));
    const size = img.getSize();
    const bmp = img.toBitmap();
    const rgba = bgraToRGBA(bmp, size.width, size.height);
    const r = readers.readShopType(rgba, size.width, size.height);
    if (r.type === 'special') spec++;
    else norm++;
    console.log(`${f}  ${r.type === 'special' ? '特殊' : '普通'}  红 ${String(r.redPixels).padStart(5)}  占比 ${r.redRatio.toFixed(4)}`);
  }
  console.log(`\n合计 ${files.length} 帧：普通 ${norm}，特殊 ${spec}`);
  app.exit(0);
});
