// 广播横幅渲染进程：显示一段文字，到点自己收起来
const bannerEl = document.getElementById('banner');
const textEl = document.getElementById('banner-text');

let hideTimer = null;
let collapseTimer = null;

function show(text, duration) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }

  textEl.textContent = text || '';
  bannerEl.classList.remove('hidden');

  // 强制回流，让「金线展开」这次过渡能重新播放
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');

  const ms = Math.max(1200, Number(duration) || 5000);
  hideTimer = setTimeout(hide, ms);
}

function hide() {
  bannerEl.classList.remove('show');
  hideTimer = null;
  // 等淡出过渡走完再彻底移除，避免下一帧闪一下
  collapseTimer = setTimeout(() => {
    bannerEl.classList.add('hidden');
    collapseTimer = null;
  }, 320);
}

window.broadcastAPI.onShow((data) => show(data && data.text, data && data.duration));
window.broadcastAPI.onHide(() => hide());
