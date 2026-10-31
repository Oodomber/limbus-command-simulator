"""用采收好的字形模板去认一个数字区域，看看能不能跨位置跨字号（开发期工具）

用法：
  python tools/vision/digit_probe.py <帧相对路径> <x> <y> <w> <h> [--thr 90] [--invert]

输出：切出的每段 → 判成哪个数字、得分多少、第二候选是多少
"""

import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
TMPL = os.path.join(ROOT, "src", "vision", "digit_templates.json")


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


def norm(v):
    v = v - v.mean()
    return v / (np.linalg.norm(v) + 1e-6)


def glyph_canvas(gray, c0, c1, r0, r1, CW, CH):
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
    rel, x, y, w, h = sys.argv[1:6]
    thr = None
    invert = "--invert" in sys.argv
    for i, a in enumerate(sys.argv):
        if a == "--thr":
            thr = float(sys.argv[i + 1])

    with open(TMPL, encoding="utf-8") as f:
        cfg = json.load(f)
    CW, CH = cfg["size"]
    tmpl = {d: norm(np.array(v, dtype=np.float32).reshape(CH, CW)) for d, v in cfg["templates"].items()}

    img = Image.open(os.path.join(FRAMES, rel)).convert("RGB")
    W, H = img.size
    box = (int(float(x) * W), int(float(y) * H), int((float(x) + float(w)) * W), int((float(y) + float(h)) * H))
    gray = np.asarray(img.crop(box).convert("L"), dtype=np.float32)

    if thr is None:
        thr = max(90.0, float(np.median(gray)) + 45.0)
    mask = (gray < thr) if invert else (gray > thr)

    cols = runs(mask.sum(axis=0) >= 2, min_len=2)
    print(f"{rel}  区域 {box}  阈值 {thr:.0f}  切出 {len(cols)} 段")
    out = []
    for c0, c1 in cols:
        sub = mask[:, c0:c1 + 1]
        rr = np.where(sub.any(axis=1))[0]
        if not len(rr):
            continue
        cv = norm(glyph_canvas(gray, c0, c1, int(rr[0]), int(rr[-1]), CW, CH))
        scores = sorted(((float(np.sum(cv * t)), d) for d, t in tmpl.items()), reverse=True)
        best, second = scores[0], scores[1]
        out.append(best[1])
        print(
            f"  x {c0}..{c1} ({c1 - c0 + 1}px) 高 {rr[-1] - rr[0] + 1}px"
            f"  → {best[1]}  {best[0]:.3f}   次选 {second[1]} {second[0]:.3f}"
        )
    print("识别结果: " + "".join(out))


if __name__ == "__main__":
    main()
