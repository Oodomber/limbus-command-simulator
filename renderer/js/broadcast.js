// 广播横幅渲染进程：只负责「显示一段文字，到点自己淡出」
const bannerEl = document.getElementById('banner');
const textEl = document.getElementById('banner-text');

let hideTimer = null;

function show(text, duration) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  textEl.textContent = text || '';
  bannerEl.classList.remove('hidden');

  // 每次播报抖一下高光，让玩家余光能注意到
  bannerEl.classList.remove('flash');
  void bannerEl.offsetWidth;   // 强制回流，保证动画能重播
  bannerEl.classList.add('flash');

  const ms = Math.max(1200, Number(duration) || 5000);
  hideTimer = setTimeout(hide, ms);
}

function hide() {
  bannerEl.classList.add('hidden');
  hideTimer = null;
}

window.broadcastAPI.onShow((data) => show(data && data.text, data && data.duration));
window.broadcastAPI.onHide(() => hide());
