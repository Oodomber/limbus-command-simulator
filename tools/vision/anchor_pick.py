"""人工指定锚点 + 自动微调 + 打分（开发期工具）

与 anchor_scan.py 的区别：这里锚点是我按语义选的（标题、按钮、名牌），
脚本只在正负 1.2% 范围内微调位置，保证它落在字上而不是空白上。

必须避开「同一局才稳定」的区域：
  - 底部罪人条（y > 0.76）：队伍不同就完全不同
  - 顶部的星光 / 经费数字：每局数值不同
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
REPORTS = os.path.join(ROOT, "reports")

# phase, x, y, w, h -- 归一化
GUESSES = [
    ("cardpack", 0.918, 0.172, 0.048, 0.068),      # 右侧竖排第二格「图鉴」小方框（连框一起）
    ("route", 0.030, 0.158, 0.088, 0.042),         # 「正在探索第」字样（不含层数数字）
    ("combat", 0.006, 0.056, 0.036, 0.046),        # 左上「WAVE」字样（不含数字）
    ("event", 0.536, 0.189, 0.111, 0.050),         # 右侧「选项」缎带
    ("judgment", 0.555, 0.512, 0.360, 0.040),      # 「判定阈值 / 预计数值」标签行
    ("event_reward", 0.292, 0.199, 0.205, 0.050),  # 标题「选择遭遇战奖励卡」
    ("shop", 0.078, 0.515, 0.295, 0.058),          # 强化 / 合成 / 售卖 三按钮
    ("boss_reward", 0.683, 0.753, 0.135, 0.050),   # 「拒绝饰品」按钮
]

W, H = 2560, 1600
JIT = 0.012
JIT_STEP = 0.004


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def load_phase():
    phases = {}
    for phase in sorted(os.listdir(FRAMES)):
        d = os.path.join(FRAMES, phase)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.lower().endswith(".png"))
        if not files:
            continue
        phases[phase] = [
            (os.path.join(d, f), np.asarray(Image.open(os.path.join(d, f)).convert("L"), dtype=np.float32))
            for f in files
        ]
    return phases


def evaluate(phases, phase, rect):
    x, y, w, h = rect
    owner = []
    vecs = []
    for name, items in phases.items():
        for path, arr in items:
            p = arr[y:y + h, x:x + w]
            if p.shape != (h, w):
                return None
            p = p - p.mean()
            n = np.linalg.norm(p) + 1e-6
            vecs.append((p / n).ravel())
            owner.append(name)
    owner = np.array(owner)
    vecs = np.stack(vecs)

    idx = np.where(owner == phase)[0]
    if len(idx) < 2:
        return None
    tmpl = vecs[idx].mean(axis=0)
    tmpl /= np.linalg.norm(tmpl) + 1e-6
    sims = vecs @ tmpl
    within = float(sims[idx].min())
    cross = float(np.delete(sims, idx).max())
    return within, cross, within - cross


def main():
    phases = load_phase()
    print(f"载入 {sum(len(v) for v in phases.values())} 帧 / {len(phases)} 环节\n")

    results = []
    for phase, gx, gy, gw, gh in GUESSES:
        if phase not in phases:
            print(f"缺少环节帧：{phase}")
            continue
        w, h = int(gw * W), int(gh * H)
        best = None
        for dx in np.arange(-JIT, JIT + 1e-9, JIT_STEP):
            for dy in np.arange(-JIT, JIT + 1e-9, JIT_STEP):
                x = int((gx + dx) * W)
                y = int((gy + dy) * H)
                if x < 0 or y < 0 or x + w > W or y + h > H:
                    continue
                r = evaluate(phases, phase, (x, y, w, h))
                if r is None:
                    continue
                within, cross, score = r
                if best is None or score > best[0]:
                    best = (score, within, cross, x, y, w, h)
        if best is None:
            print(f"{phase} 没有任何可用位置")
            continue
        score, within, cross, x, y, w, h = best
        results.append(
            {
                "phase": phase,
                "score": round(score, 3),
                "within": round(within, 3),
                "cross": round(cross, 3),
                "norm": [round(x / W, 4), round(y / H, 4), round(w / W, 4), round(h / H, 4)],
                "px": [x, y, w, h],
            }
        )
        flag = "OK  " if within >= 0.90 and cross <= 0.55 else "WEAK"
        print(
            f"{flag} {phase:<13} within {within:.3f}  cross {cross:.3f}  sep {score:+.3f}"
            f"   at ({x / W:.3f}, {y / H:.3f})  {w}x{h}"
        )

    out = os.path.join(REPORTS, "anchor_picked.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\n写入 {out}")

    cell_w, cell_h = 420, 300
    sheet = Image.new("RGB", (cell_w * 4, cell_h * 2), (18, 16, 22))
    d = ImageDraw.Draw(sheet)
    f1 = font(16)
    for i, r in enumerate(results):
        x, y, w, h = r["px"]
        d_path = sorted(os.listdir(os.path.join(FRAMES, r["phase"])))[0]
        frame = Image.open(os.path.join(FRAMES, r["phase"], d_path)).convert("RGB")
        crop = frame.crop((x, y, x + w, y + h))
        scale = min(300 / max(1, crop.width), 190 / max(1, crop.height))
        crop = crop.resize((max(1, int(crop.width * scale)), max(1, int(crop.height * scale))), Image.LANCZOS)
        cx, cy = (i % 4) * cell_w, (i // 4) * cell_h
        sheet.paste(crop, (cx + 10, cy + 34))
        d.text((cx + 10, cy + 8), r["phase"], fill=(230, 220, 200), font=f1)
        d.text(
            (cx + 10, cy + 236),
            f"within {r['within']:.2f}   cross {r['cross']:.2f}",
            fill=(150, 145, 160),
            font=f1,
        )
        d.text((cx + 10, cy + 258), f"{w}x{h} px", fill=(110, 105, 120), font=f1)
    out2 = os.path.join(REPORTS, "anchor_picked.png")
    sheet.save(out2)
    print(f"写入 {out2}")


if __name__ == "__main__":
    sys.exit(main())
