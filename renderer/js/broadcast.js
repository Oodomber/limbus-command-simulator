// 广播横幅渲染进程：只负责「显示一段文字，到点自己收起来」
const bannerEl = document.getElementById('banner');
const textEl = document.getElementById('banner-text');

let hideTimer = null;

function show(text, duration) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  textEl.textContent = text || '';
  bannerEl.classList.remove('hidden');

  const ms = Math.max(1200, Number(duration) || 5000);
  hideTimer = setTimeout(hide, ms);
}

function hide() {
  bannerEl.classList.add('hidden');
  hideTimer = null;
}

window.broadcastAPI.onShow((data) => show(data && data.text, data && data.duration));
window.broadcastAPI.onHide(() => hide());
