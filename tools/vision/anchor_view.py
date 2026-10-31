"""锚点审阅图（读 src/vision/anchors.json 这份唯一真相）

和 anchor_pick.py / anchor_review.py 的区别：那两个用的是开发期猜的坐标和
anchor_picked.json 里存下来的旧分数，改完 anchors.json 之后会不同步。
这里所有坐标、所有分数都现算，改完 anchors.json 直接重跑即可。

用法：python tools/vision/anchor_view.py [输出目录]
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
REPORTS = os.path.join(ROOT, "reports")
ANCHORS = os.path.join(ROOT, "src", "vision", "anchors.json")

LABEL = {
    "cardpack": "卡包选择",
    "route": "路线",
    "combat": "战斗（指令选择）",
    "combat_battle": "战斗（交战进行中）",
    "event": "事件",
    "judgment": "判定",
    "event_reward": "奖励卡",
    "shop": "商店",
    "boss_reward": "饰品奖励",
}

CANON = 128


def font(size):
    for p in (r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def gray(img):
    return np.asarray(img.convert("L"), dtype=np.float32)


def crop_vec(g, rect, out_w=CANON):
    """按归一化 rect 取样，缩放到固定宽度，返回零均值单位向量"""
    H, W = g.shape
    x0 = int(round(rect[0] * W))
    y0 = int(round(rect[1] * H))
    x1 = int(round((rect[0] + rect[2]) * W))
    y1 = int(round((rect[1] + rect[3]) * H))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    patch = g[y0:y1, x0:x1]
    if patch.size == 0:
        return None, (x0, y0, x1, y1)
    out_h = max(1, int(round(out_w * (y1 - y0) / max(1, (x1 - x0)))))
    img = Image.fromarray(patch.astype(np.uint8))
    img = img.resize((out_w, out_h), Image.BILINEAR)
    v = np.asarray(img, dtype=np.float32).ravel()
    v = v - v.mean()
    n = np.linalg.norm(v)
    return (v / n if n > 0 else v), (x0, y0, x1, y1)


def phase_dirs():
    return [p for p in sorted(os.listdir(FRAMES)) if os.path.isdir(os.path.join(FRAMES, p))]


def frame_files(phase):
    d = os.path.join(FRAMES, phase)
    if not os.path.isdir(d):
        return []
    return [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.lower().endswith(".png")]


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(REPORTS, "anchor_review")
    os.makedirs(out_dir, exist_ok=True)

    with open(ANCHORS, encoding="utf-8") as f:
        anchors = [a for a in json.load(f)["anchors"] if a.get("kind") != "presence"]

    # 对每个锚点：用「这一个锚点的 rect」去裁所有环节的所有帧，
    # 这样向量维度一致，within/cross 才能比。
    made = []
    for idx, a in enumerate(anchors, 1):
        phase = a["phase"]
        files = frame_files(phase)
        if not files:
            continue

        own, own_img = [], None
        for fp in files:
            im = Image.open(fp).convert("RGB")
            if own_img is None:
                own_img = (fp, im)
            v, _ = crop_vec(gray(im), a["rect"])
            if v is not None:
                own.append(v)
        if not own:
            continue

        tmpl = np.median(np.stack(own), axis=0)
        tn = np.linalg.norm(tmpl)
        tmpl = tmpl / (tn if tn > 0 else 1)
        within = min(float(v @ tmpl) for v in own)

        cross = 0.0
        cross_phase = "-"
        for other in phase_dirs():
            if other == phase:
                continue
            for fp in frame_files(other):
                v, _ = crop_vec(gray(Image.open(fp)), a["rect"])
                if v is None or v.shape != tmpl.shape:
                    continue
                s = float(v @ tmpl)
                if s > cross:
                    cross, cross_phase = s, other

        fp, im = own_img
        W, H = im.size
        x0 = int(a["rect"][0] * W)
        y0 = int(a["rect"][1] * H)
        x1 = int((a["rect"][0] + a["rect"][2]) * W)
        y1 = int((a["rect"][1] + a["rect"][3]) * H)

        # 左：整帧 + 绿色框；右：锚点放大
        left_w = 1000
        left = im.resize((left_w, int(left_w * H / W)), Image.LANCZOS)
        sx = left_w / W
        d = ImageDraw.Draw(left)
        bx0, by0, bx1, by1 = x0 * sx, y0 * sx, x1 * sx, y1 * sx
        d.rectangle([bx0, by0, bx1, by1], outline=(60, 255, 120), width=3)
        for cx, cy in ((bx0, by0), (bx1, by0), (bx0, by1), (bx1, by1)):
            d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=(60, 255, 120))

        pad = 6
        crop = im.crop((max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)))
        zoom_w = 620
        crop = crop.resize((zoom_w, max(1, int(zoom_w * crop.height / crop.width))), Image.LANCZOS)

        lh = left.height
        rh = crop.height + 150
        sheet = Image.new("RGB", (left_w + 40 + zoom_w, max(lh, rh) + 60), (18, 16, 22))
        dd = ImageDraw.Draw(sheet)
        sheet.paste(left, (0, 50))
        sheet.paste(crop, (left_w + 40, 80))

        f_title = font(24)
        f_txt = font(15)
        dd.text((6, 10), f"{LABEL.get(phase, phase)}（{phase}）", fill=(240, 232, 210), font=f_title)
        dd.text(
            (left_w + 40, 40),
            f"锚点放大  {x1 - x0}×{y1 - y0}px   within {within:.3f} / cross {cross:.3f}（{cross_phase}）",
            fill=(220, 214, 200),
            font=f_txt,
        )
        dd.text(
            (left_w + 40, 80 + crop.height + 14),
            f"归一化位置 x={a['rect'][0]:.4f} y={a['rect'][1]:.4f} w={a['rect'][2]:.4f} h={a['rect'][3]:.4f}",
            fill=(170, 166, 156),
            font=f_txt,
        )
        dd.text(
            (left_w + 40, 80 + crop.height + 40),
            f"样帧 {os.path.basename(fp)}   within=同环节最差帧   cross=其他环节最高",
            fill=(170, 166, 156),
            font=f_txt,
        )
        dd.text(
            (left_w + 40, 80 + crop.height + 66),
            a.get("name", ""),
            fill=(150, 146, 138),
            font=f_txt,
        )

        p = os.path.join(out_dir, f"{idx:02d}_{phase}.png")
        sheet.save(p)
        made.append(p)
        print(f"{phase:14s} within {within:.3f}  cross {cross:.3f}  {p}")

    print(f"\n共 {len(made)} 张")


if __name__ == "__main__":
    main()
