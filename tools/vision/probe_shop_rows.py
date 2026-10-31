"""探测：商店格子的行位置能不能靠「经费图标（橙色圆环）」动态找出来。

目的：商品数可能是 7 或 8，特殊商店的已购商品会挪到第三行；
用户稍微滚动页面，固定 y 的格子就会错位，导致「普通/已购」判错。
"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames", "shop")

COL_X0 = [0.4859, 0.6051, 0.7243, 0.8435]  # 每列「价格数字」的左边缘
COIN_DX0, COIN_DX1 = -0.018, -0.006        # 经费图标在数字左侧


def rows_of(img, c):
    W, H = img.size
    a = np.asarray(img.convert("RGB"), dtype=np.int16)
    x0 = int((COL_X0[c] + COIN_DX0) * W)
    x1 = int((COL_X0[c] + COIN_DX1) * W)
    band = a[:, x0:x1]
    r, g, b = band[:, :, 0], band[:, :, 1], band[:, :, 2]
    # 金币：亮橙（红高、绿中、蓝低）
    mask = (r > 150) & (g > 70) & (g < 200) & (b < 100)
    counts = mask.sum(axis=1)
    ys = []
    y = int(0.28 * H)
    end = int(0.82 * H)
    thr = max(6, int((x1 - x0) * 0.25))
    while y < end:
        if counts[y] >= thr:
            y2 = y
            while y2 < end and counts[y2] >= thr:
                y2 += 1
            if y2 - y >= 12:  # 至少 12px 高才当一个图标
                ys.append(((y + y2) / 2) / H)
            y = y2 + 1
        else:
            y += 1
    return ys


def main():
    names = sorted(f for f in os.listdir(FRAMES) if f.lower().endswith(".png"))
    for name in names:
        img = Image.open(os.path.join(FRAMES, name))
        print(name)
        for c in range(4):
            ys = rows_of(img, c)
            print(f"   列{c}: " + "  ".join(f"{y:.3f}" for y in ys))


if __name__ == "__main__":
    main()
