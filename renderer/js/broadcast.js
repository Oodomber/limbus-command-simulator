// 广播横幅渲染进程
// 文字效果与传呼机一致：逐字「乱码滚动」，整串吐完后瞬间定格成正文。
const bannerEl = document.getElementById('banner');
const textEl = document.getElementById('banner-text');

// 与 renderer/js/overlay.js 里那张乱码表保持一致，两边观感才统一
const SCRAMBLE_CHARS = '日月金木水火土天地玄黃宇宙洪荒龍鳳鬼神乾坤陰陽風雲雷電山澤河海春秋冬夏仁義禮智忠孝廉恥文武劍刀槍戟弓箭矛盾甲冑城郭宮殿樓閣花草竹石鳥獸蟲魚魂魄精氣神魔仙妖';
const TYPE_SPEED = 35; // 每字 35ms，和传呼机的 startTypewriter 默认值相同

let hideTimer = null;
let typeTimer = null;
let collapseTimer = null;

function randomScramble() {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

// 已揭示的长度内逐字换成乱码，但保留换行 —— 这样牌匾高度在打字过程中不会跳。
function scrambleUpTo(target, revealed) {
  let out = '';
  for (let i = 0; i < revealed && i < target.length; i++) {
    out += target[i] === '\n' ? '\n' : randomScramble();
  }
  return out;
}

function show(text, duration) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }

  const target = String(text || '');
  const holdMs = Math.max(1200, Number(duration) || 5000);

  bannerEl.classList.remove('hidden');
  void bannerEl.offsetWidth;      // 强制回流，让金线展开的过渡能重新播
  bannerEl.classList.add('show');

  textEl.textContent = '';

  let revealed = 0;
  typeTimer = setInterval(() => {
    revealed++;
    if (revealed >= target.length) {
      clearInterval(typeTimer);
      typeTimer = null;
      textEl.textContent = target;
      // 打字动画走完才开始计停留时间
      hideTimer = setTimeout(hide, holdMs);
      return;
    }
    textEl.textContent = scrambleUpTo(target, revealed);
  }, TYPE_SPEED);
}

function hide() {
  bannerEl.classList.remove('show');
  hideTimer = null;
  collapseTimer = setTimeout(() => {
    bannerEl.classList.add('hidden');
    collapseTimer = null;
  }, 320);
}

window.broadcastAPI.onShow((data) => show(data && data.text, data && data.duration));
window.broadcastAPI.onHide(() => hide());

// 音效：和传呼机一样，用 <audio id="sfx-xxx">，名字里的下划线换成连字符
window.broadcastAPI.onPlaySound((name) => {
  const id = 'sfx-' + String(name || '').replace(/_/g, '-');
  const el = document.getElementById(id);
  if (!el) return;
  try {
    el.currentTime = 0;
    el.play().catch(() => {});
  } catch {}
});
