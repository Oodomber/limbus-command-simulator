"""从已知价格的商店帧里采收 0~9 字形，训练并验证数字模板（开发期工具）

思路：商店每格价格是「金币图标 + 数字」，数字区域位置固定。
我已知这些帧里每格是多少（164/149/147/158/200…），
于是可以按「切出几个字就必须等于几位数字」来反推切分对不对，
对上了就把每个字打上标签存下来。

产出：
  src/vision/digit_templates.json   给运行时用的字形模板（量化到 0~255 的灰度）
  reports/digit_harvest.png         采收明细图，人工核对用
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
OUT_JSON = os.path.join(ROOT, "src", "vision", "digit_templates.json")
OUT_PNG = os.path.join(ROOT, "reports", "digit_harvest.png")

CW, CH = 16, 28  # 模板画布尺寸

# 价格数字区域的几何（归一化，2560x1600 下量的）
COL_X0 = [0.4859, 0.6051, 0.7243, 0.8435]  # 四列数字左边缘
DIGIT_W = 0.034  # 最多三位数字的横向宽度
ROW_Y = [0.4378, 0.6302]  # 两行价格的数字上边缘
ROW_H = 0.0200

# 已人工核对过的价格：帧 -> [(行, 列, "价格"), ...]
KNOWN = {
    "shop/20261030-152805-508.png": [
        (0, 0, "??"),
        (0, 1, "164"),
        (0, 2, "149"),
        (0, 3, "147"),
        (1, 0, "158"),
        (1, 1, "200"),
    ],
    "shop/20261030-155042-611.png": [
        (0, 0, "??"),
        (0, 1, "??"),
        (0, 2, "??"),
        (0, 3, "400"),
        (1, 0, "195"),
        (1, 1, "143"),
        (1, 2, "256"),
        (1, 3, "156"),
    ],
}


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


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


def mask_of(gray):
    """亮字掩膜：阈值取「中位数 + 45」与 90 的较大者，避免整片背景被点亮"""
    med = float(np.median(gray))
    thr = max(90.0, med + 45.0)
    return gray > thr, thr


def glyph_canvas(gray, c0, c1, r0, r1):
    """把单个字裁出来，按高度对齐后放进 CW x CH 画布（窄字不会被拉宽）"""
    g = gray[r0:r1 + 1, c0:c1 + 1]
    h, w = g.shape
    scale = (CH - 2) / max(1, h)
    nw = max(1, min(CW - 2, int(round(w * scale))))
    img = Image.fromarray(g.astype(np.uint8)).resize((nw, CH - 2), Image.LANCZOS)
    canvas = np.zeros((CH, CW), dtype=np.float32)
    x0 = (CW - nw) // 2
    canvas[1:CH - 1, x0:x0 + nw] = np.asarray(img, dtype=np.float32)
    return canvas


def main():
    samples = []  # {label, vec(32*48), src}
    tiles = []

    for rel, cells in KNOWN.items():
        img = Image.open(os.path.join(FRAMES, rel)).convert("RGB")
        W, H = img.size
        gray = np.asarray(img.convert("L"), dtype=np.float32)

        for row, col, expect in cells:
            x0 = COL_X0[col]
            y0 = ROW_Y[row]
            box = (
                int(x0 * W),
                int(y0 * H),
                int((x0 + DIGIT_W) * W),
                int((y0 + ROW_H) * H),
            )
            cell = gray[box[1]:box[3], box[0]:box[2]]
            mask, thr = mask_of(cell)
            cols = runs(mask.sum(axis=0) >= 2, min_len=2)

            if expect == "??":
                tiles.append((f"{rel.split('/')[1][-6:]} r{row}c{col} = '??'  未切分", cell, None))
                continue

            if len(cols) != len(expect):
                print(f"跳过 {rel} r{row}c{col}: 期望 {expect}({len(expect)}位) 实切 {len(cols)} 段")
                tiles.append((f"r{row}c{col} '{expect}' 切分失败({len(cols)}段)", cell, None))
                continue

            for label, (c0, c1) in zip(expect, cols):
                sub = mask[:, c0:c1 + 1]
                rr = np.where(sub.any(axis=1))[0]
                cv = glyph_canvas(cell, c0, c1, int(rr[0]), int(rr[-1]))
                samples.append({"label": label, "vec": cv, "src": f"{rel} r{row}c{col}"})
                tiles.append((f"{label}  r{row}c{col}", cv, label))

    by_label = {}
    for s in samples:
        by_label.setdefault(s["label"], []).append(s["vec"])

    print(f"\n共采到 {len(samples)} 个字形，覆盖 {len(by_label)} 个数字：")
    for d in sorted(by_label):
        print(f"  {d}: {len(by_label[d])}")

    # 用均值做模板，然后留一法自测
    templates = {}
    for d, vs in by_label.items():
        templates[d] = np.mean(np.stack(vs), axis=0)

    def norm(v):
        v = v - v.mean()
        n = np.linalg.norm(v) + 1e-6
        return v / n

    tmpl_n = {d: norm(t) for d, t in templates.items()}
    ok = 0
    confusions = {}
    for s in samples:
        v = norm(s["vec"])
        scores = {d: float(np.sum(v * t)) for d, t in tmpl_n.items()}
        pred = max(scores, key=scores.get)
        if pred == s["label"]:
            ok += 1
        else:
            confusions[(s["label"], pred)] = confusions.get((s["label"], pred), 0) + 1

    print(f"\n留一近似自测（模板含样本本身，会偏乐观）：{ok}/{len(samples)}")
    for (a, b), n in confusions.items():
        print(f"  真 {a} 判成 {b}: {n} 次")

    payload = {
        "size": [CW, CH],
        "note": "由 tools/vision/digit_harvest.py 从实拍帧采收；值域 0~255 灰度",
        "templates": {
            d: [int(round(x)) for x in t.ravel()] for d, t in sorted(templates.items())
        },
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    print(f"\n写入 {OUT_JSON}")

    # 明细图
    cell = 64
    per_row = 12
    rows = (len(tiles) + per_row - 1) // per_row
    sheet = Image.new("RGB", (per_row * cell, rows * (cell + 16)), (20, 18, 24))
    d = ImageDraw.Draw(sheet)
    f = font(11)
    for i, (cap, arr, _) in enumerate(tiles):
        a = np.asarray(arr, dtype=np.float32)
        if a.ndim == 2 and a.shape == (CH, CW):
            a = a / max(1.0, a.max()) * 255
        else:
            a = a / max(1.0, a.max()) * 255
        im = Image.fromarray(a.astype(np.uint8)).resize((cell - 8, cell - 8), Image.LANCZOS)
        cx = (i % per_row) * cell
        cy = (i // per_row) * (cell + 16)
        sheet.paste(im.convert("RGB"), (cx + 4, cy + 14))
        d.text((cx + 2, cy + 1), cap[:16], fill=(210, 200, 180), font=f)
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    sheet.save(OUT_PNG)
    print(f"写入 {OUT_PNG}")


if __name__ == "__main__":
    main()
