"""字形切分与取样（开发期工具）

给定一帧里的一个数字区域，二值化后按竖直投影切出每个字，
打印每字的像素框，并把切出来的字拼成一张带编号的图，方便人工核对。

用法：
  python tools/vision/digit_scan.py <帧相对路径> <x> <y> <w> <h> <输出png> [--dark-text]
"""

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def otsu(gray):
    hist, _ = np.histogram(gray, bins=256, range=(0, 256))
    total = gray.size
    sum_all = np.dot(np.arange(256), hist)
    sum_b = 0.0
    w_b = 0.0
    best = 0
    best_var = -1.0
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        var = w_b * w_f * (m_b - m_f) ** 2
        if var > best_var:
            best_var = var
            best = t
    return best


def main():
    rel, x, y, w, h, out = sys.argv[1:7]
    dark = "--dark-text" in sys.argv

    img = Image.open(os.path.join(FRAMES, rel)).convert("RGB")
    W, H = img.size
    box = (int(float(x) * W), int(float(y) * H), int((float(x) + float(w)) * W), int((float(y) + float(h)) * H))
    crop = img.crop(box)
    gray = np.asarray(crop.convert("L"), dtype=np.float32)

    thr = otsu(gray.astype(np.uint8))
    for i, a in enumerate(sys.argv):
        if a == "--thr":
            thr = float(sys.argv[i + 1])
    mask = (gray < thr) if dark else (gray > thr)
    # 去掉零星噪点：要求整列至少 2 个亮像素
    col_sum = mask.sum(axis=0)
    runs = []
    start = None
    for i, v in enumerate(col_sum):
        if v >= 2 and start is None:
            start = i
        elif v < 2 and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(col_sum) - 1))

    print(f"区域 {box}  阈值 {thr}  切出 {len(runs)} 段")
    glyphs = []
    for i, (a, b) in enumerate(runs):
        sub = mask[:, a:b + 1]
        rows = np.where(sub.any(axis=1))[0]
        if not len(rows):
            continue
        top, bottom = int(rows[0]), int(rows[-1])
        glyphs.append((i, a, b, top, bottom))
        print(f"  #{i}  x {a}..{b} (宽 {b - a + 1})  y {top}..{bottom} (高 {bottom - top + 1})")

    if not glyphs:
        print("没切到任何字，检查区域或阈值")
        return

    cell = 90
    sheet = Image.new("RGB", (cell * len(glyphs), cell + 26), (20, 18, 24))
    d = ImageDraw.Draw(sheet)
    f = font(13)
    for idx, (i, a, b, top, bottom) in enumerate(glyphs):
        g = crop.crop((a, top, b + 1, bottom + 1))
        s = min((cell - 8) / max(1, g.width), (cell - 8) / max(1, g.height))
        g = g.resize((max(1, int(g.width * s)), max(1, int(g.height * s))), Image.LANCZOS)
        sheet.paste(g, (idx * cell + (cell - g.width) // 2, 24 + (cell - g.height) // 2))
        d.text((idx * cell + 4, 4), f"#{i} {b - a + 1}x{bottom - top + 1}", fill=(220, 210, 190), font=f)
    sheet.save(out)
    print(f"写入 {out}")


if __name__ == "__main__":
    main()
