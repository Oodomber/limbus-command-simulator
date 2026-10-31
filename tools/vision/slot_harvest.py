"""按槽位采收数字字形模板（开发期工具，不进产物）

背景：同一数字在不同 UI 槽位里的字号/配色/描边都不同，一套通用模板认不准
（实测商店价格模板去认路线层数「2」→ 判成 8；去认 WAVE → 整块被边框粘连）。
所以每个槽位各建一套模板。

槽位定义（归一化坐标，以 2560×1600 帧为准）：
- wave_num  : WAVE 铭牌分数框内的分子
- wave_den  : WAVE 铭牌分数框内的分母（中间那个「/」切出来丢掉）
- turn      : TURN 铭牌分数框内的数字

用法：
    python tools/vision/slot_harvest.py            # 采收 + 自检
"""

import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
OUT_JSON = os.path.join(ROOT, "src", "vision", "digit_slots.json")
OUT_PNG = os.path.join(ROOT, "reports", "digit_slots.png")

CW, CH = 18, 26  # 统一画布

SLOTS = {
    "wave_num": {"x": 0.0455, "y": 0.0795, "w": 0.0240, "h": 0.0225, "thr": 110, "pick": 0},
    "wave_den": {"x": 0.0455, "y": 0.0795, "w": 0.0240, "h": 0.0225, "thr": 110, "pick": 2},
    "turn":     {"x": 0.0485, "y": 0.1275, "w": 0.0200, "h": 0.0255, "thr": 110, "pick": 0},
}

# 已知值（人工从 reports/wave_plates.png 读出）
KNOWN = {
    "combat/20261030-152431-075.png": {"wave_num": "1", "wave_den": "1", "turn": "1"},
    "combat/20261030-152443-371.png": {"wave_num": "1", "wave_den": "1", "turn": "1"},
    "combat/20261030-152500-485.png": {"wave_num": "1", "wave_den": "1", "turn": "2"},
    "combat/20261030-152541-778.png": {"wave_num": "1", "wave_den": "1", "turn": "3"},
    "combat/20261030-153422-765.png": {"wave_num": "3", "wave_den": "4", "turn": "4"},
    "combat/20261030-153823-956.png": {"wave_num": "1", "wave_den": "1", "turn": "2"},
}


def gray_of(path):
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8)


def runs_of(mask, min_ink=2):
    """按列投影切段，返回 [(x0, x1)]"""
    cols = mask.sum(axis=0)
    segs = []
    start = None
    for x, c in enumerate(cols):
        if c >= min_ink:
            if start is None:
                start = x
        else:
            if start is not None:
                segs.append((start, x - 1))
                start = None
    if start is not None:
        segs.append((start, len(cols) - 1))
    return segs


def glyph_of(mask, x0, x1):
    sub = mask[:, x0:x1 + 1]
    rows = np.where(sub.any(axis=1))[0]
    if rows.size == 0:
        return None
    y0, y1 = int(rows[0]), int(rows[-1])
    return sub[y0:y1 + 1, :]


def to_canvas(g, w=CW, h=CH):
    """按高度对齐缩放到画布正中，窄字不拉伸"""
    gh, gw = g.shape
    scale = (h - 2) / max(1, gh)
    nw = max(1, min(w - 2, int(round(gw * scale))))
    nh = h - 2
    img = Image.fromarray((g.astype(np.uint8) * 255))
    img = img.resize((nw, nh), Image.BILINEAR)
    canvas = np.zeros((h, w), dtype=np.float32)
    ox = (w - nw) // 2
    canvas[1:1 + nh, ox:ox + nw] = np.asarray(img, dtype=np.float32) / 255.0
    return canvas


def ncc(a, b):
    a = a.ravel() - a.mean()
    b = b.ravel() - b.mean()
    na, nb = np.linalg.norm(a), np.linalg.norm(b)
    if na < 1e-6 or nb < 1e-6:
        return -1.0
    return float(a @ b / (na * nb))


def harvest():
    bank = {k: [] for k in SLOTS}
    report = []
    for rel, truth in KNOWN.items():
        path = os.path.join(FRAMES, rel)
        if not os.path.exists(path):
            print("缺帧", rel)
            continue
        g = gray_of(path)
        H, W = g.shape
        for slot, cfg in SLOTS.items():
            x0, y0 = int(cfg["x"] * W), int(cfg["y"] * H)
            x1, y1 = int((cfg["x"] + cfg["w"]) * W), int((cfg["y"] + cfg["h"]) * H)
            patch = g[y0:y1, x0:x1]
            mask = patch >= cfg["thr"]
            segs = runs_of(mask)
            want = cfg["pick"]
            if len(segs) <= want:
                report.append((rel, slot, truth[slot], "切段不足(%d)" % len(segs)))
                continue
            xa, xb = segs[want]
            glyph = glyph_of(mask, xa, xb)
            if glyph is None:
                report.append((rel, slot, truth[slot], "空字形"))
                continue
            canvas = to_canvas(glyph)
            bank[slot].append({"d": truth[slot], "px": canvas})
            report.append((rel, slot, truth[slot], "ok %dx%d" % (glyph.shape[1], glyph.shape[0])))
    return bank, report


def self_check(bank):
    ok = 0
    total = 0
    for slot, items in bank.items():
        print("\n[%s] %d 个样本" % (slot, len(items)))
        for i, it in enumerate(items):
            best, best_s = None, -2
            for j, other in enumerate(items):
                if i == j:
                    continue  # 留一：不和自己比
                s = ncc(it["px"], other["px"])
                if s > best_s:
                    best_s, best = s, other["d"]
            total += 1
            hit = best == it["d"]
            ok += 1 if hit else 0
            print("  %s -> %s (%.3f) %s" % (it["d"], best, best_s, "OK" if hit else "MISS"))
    print("\n留一自检：%d/%d" % (ok, total))


def save(bank):
    data = {
        "canvas": [CW, CH],
        "slots": {k: [{"d": it["d"], "px": [[int(round(v * 255)) for v in row] for row in it["px"]]} for it in v]
                  for k, v in bank.items()},
    }
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("\n写入", OUT_JSON)

    tiles = []
    for slot, items in bank.items():
        for it in items:
            tiles.append((slot, it["d"], it["px"]))
    cols = 12
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("L", (cols * (CW + 6), rows * (CH + 18)), 20)
    for i, (slot, d, px) in enumerate(tiles):
        im = Image.fromarray((px * 255).astype(np.uint8))
        x = (i % cols) * (CW + 6) + 3
        y = (i // cols) * (CH + 18) + 3
        sheet.paste(im, (x, y))
    sheet = sheet.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST)
    sheet.save(OUT_PNG)
    print("写入", OUT_PNG)


if __name__ == "__main__":
    bank, report = harvest()
    for r in report:
        print("  %-42s %-9s %s  %s" % r)
    self_check(bank)
    save(bank)
