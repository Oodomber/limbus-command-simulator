"""在一条竖带里自动找「一行行的数字」并切出字（开发期工具）

不靠我目测 y 坐标：给一条竖带，先在竖直方向找亮行分成若干「行带」，
再在每一行带内按竖直投影切成一个个字。

用法：
  python tools/vision/probe_digits.py <帧相对路径> <x中心> <半宽> [--thr N] [--y0 0.30] [--y1 0.75]
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")


def runs(flags, min_len=1):
    out = []
    start = None
    for i, v in enumerate(flags):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_len:
                out.append((start, i - 1))
            start = None
    if start is not None and len(flags) - start >= min_len:
        out.append((start, len(flags) - 1))
    return out


def main():
    rel, cx, half = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    thr = 95.0
    y0, y1 = 0.30, 0.78
    for i, a in enumerate(sys.argv):
        if a == "--thr":
            thr = float(sys.argv[i + 1])
        if a == "--y0":
            y0 = float(sys.argv[i + 1])
        if a == "--y1":
            y1 = float(sys.argv[i + 1])

    img = Image.open(os.path.join(FRAMES, rel)).convert("RGB")
    W, H = img.size
    box = (int((cx - half) * W), int(y0 * H), int((cx + half) * W), int(y1 * H))
    gray = np.asarray(img.crop(box).convert("L"), dtype=np.float32)
    mask = gray > thr

    row_flags = mask.sum(axis=1) >= 3
    bands = runs(row_flags, min_len=8)
    print(f"竖带 {box}  阈值 {thr}  找到 {len(bands)} 行")
    for bi, (r0, r1) in enumerate(bands):
        band = mask[r0:r1 + 1]
        cols = runs(band.sum(axis=0) >= 2, min_len=2)
        parts = []
        for c0, c1 in cols:
            sub = band[:, c0:c1 + 1]
            rr = np.where(sub.any(axis=1))[0]
            xa = (box[0] + c0) / W
            xb = (box[0] + c1) / W
            parts.append(f"[{c1 - c0 + 1}x{rr[-1] - rr[0] + 1} @{xa:.4f}]")
        ytop = (box[1] + r0) / H
        ybot = (box[1] + r1) / H
        print(f"  行{bi}  y {ytop:.4f}..{ybot:.4f} (高 {r1 - r0 + 1}px)  字 {len(cols)} 个  {' '.join(parts)}")


if __name__ == "__main__":
    main()
