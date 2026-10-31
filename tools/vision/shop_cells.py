"""商店格子读数（开发期工具）

不读数字、不做 OCR：每个格子只看「图标上方那条标签带里有没有红字、红字有多宽」。
- 没有红字            -> 正常格
- 红字窄（3 个字）    -> 已购买
- 红字宽（4 个字）    -> 经费不足

几何（归一化，2560x1600 为基准）：
- 四列图标框左边缘 COL_X = [0.4550, 0.5765, 0.6980, 0.8195]
- 图标框宽 0.062、高 0.103
- 行间距 0.1924；第一行框顶 y=0.3120
- 标签带取框顶往上 0.030、往下 0.004 的一条横带，左右各放宽 0.020
"""

import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames", "shop")
OUT = os.path.join(ROOT, "reports", "shop_cells.png")

COL_X = [0.4550, 0.5765, 0.6980, 0.8195]
BOX_W, BOX_H = 0.062, 0.103
ROW_Y = [0.3120, 0.3120 + 0.1924, 0.3120 + 2 * 0.1924]

LABEL_DY = 0.014    # 标签带顶相对框顶（红字实际压在图标框上沿上）
LABEL_H = 0.028     # 带高
PAD_X = 0.020


def red_mask(rgb):
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    # 标签是饱和红/橙红；图标里的暖色会被 R>G 条件挡掉一部分，但仍需面积阈值
    return (r > 130) & (r - g > 55) & (r - b > 55)


def cell_label(rgb, W, H, col, row):
    x0 = int((COL_X[col] - PAD_X) * W)
    x1 = int((COL_X[col] + BOX_W + PAD_X) * W)
    y0 = int((ROW_Y[row] + LABEL_DY) * H)
    y1 = int((ROW_Y[row] + LABEL_DY + LABEL_H) * H)
    patch = rgb[max(0, y0):y1, max(0, x0):x1]
    if patch.size == 0:
        return None, 0, 0
    m = red_mask(patch)
    n = int(m.sum())
    if n < 40:
        return "none", n, 0.0
    cols = np.where(m.any(axis=0))[0]
    span = (cols[-1] - cols[0] + 1) / W  # 归一化宽度
    return ("label", n, span)


def main():
    files = sorted(f for f in os.listdir(FRAMES) if f.endswith(".png"))
    tiles = []
    for f in files:
        rgb = np.asarray(Image.open(os.path.join(FRAMES, f)).convert("RGB"))
        H, W = rgb.shape[:2]
        print("\n" + f)
        for row in range(3):
            line = []
            for col in range(4):
                kind, n, span = cell_label(rgb, W, H, col, row)
                tag = "   -   " if kind == "none" else ("宽" if span > 0.062 else "窄")
                line.append("%s(n=%4d,w=%.3f)" % (tag, n, span))
            print("  行%d  " % (row) + "  ".join(line))
        tiles.append((f, rgb))
    # 出一个可视核对图：把第一张有标签的帧的 12 个标签带裁出来拼一起
    for f, rgb in tiles:
        H, W = rgb.shape[:2]
        bands = []
        for row in range(3):
            for col in range(4):
                x0 = int((COL_X[col] - PAD_X) * W)
                x1 = int((COL_X[col] + BOX_W + PAD_X) * W)
                y0 = int((ROW_Y[row] + LABEL_DY) * H)
                y1 = int((ROW_Y[row] + LABEL_DY + LABEL_H) * H)
                bands.append(Image.fromarray(rgb[max(0, y0):y1, max(0, x0):x1]))
        w = max(b.width for b in bands)
        h = max(b.height for b in bands)
        sheet = Image.new("RGB", (w * 4, h * 3), (10, 10, 10))
        for i, b in enumerate(bands):
            sheet.paste(b, ((i % 4) * w, (i // 4) * h))
        sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.LANCZOS)
        out = OUT.replace(".png", "_" + f[9:15] + ".png")
        sheet.save(out)
        print("  ->", out)
        break


if __name__ == "__main__":
    main()
