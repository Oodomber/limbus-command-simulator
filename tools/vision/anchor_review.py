"""把选定的锚点画到整帧上 + 放大对照（开发期工具）

产出 reports/anchor_review/*.png：每个环节一张审阅图
  左边：整帧，锚点位置用亮绿框圈出
  右边：该锚点区域放大 3 倍，看清到底框住了什么
"""

import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
REPORTS = os.path.join(ROOT, "reports")
OUT = os.path.join(REPORTS, "anchor_review")

LABEL = {
    "cardpack": "卡包选择（cardpack）",
    "route": "路线（route）",
    "combat": "战斗（combat）",
    "event": "事件（event）",
    "judgment": "判定（judgment）",
    "event_reward": "奖励卡选择（reward_card）",
    "shop": "商店（shop）",
    "boss_reward": "关底奖励（boss_reward）",
}

GREEN = (0, 255, 136)
DIM = (150, 145, 160)
WHITE = (235, 228, 210)


def font(size, bold=False):
    names = (r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc") if bold else (
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
    )
    for p in names:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def ticks(d, x0, y0, x1, y1, color, w=3, L=22):
    """画四个角的直角标记，比整圈线更不遮挡画面"""
    d.line([(x0, y0), (x0 + L, y0)], fill=color, width=w)
    d.line([(x0, y0), (x0, y0 + L)], fill=color, width=w)
    d.line([(x1, y0), (x1 - L, y0)], fill=color, width=w)
    d.line([(x1, y0), (x1, y0 + L)], fill=color, width=w)
    d.line([(x0, y1), (x0 + L, y1)], fill=color, width=w)
    d.line([(x0, y1), (x0, y1 - L)], fill=color, width=w)
    d.line([(x1, y1), (x1 - L, y1)], fill=color, width=w)
    d.line([(x1, y1), (x1, y1 - L)], fill=color, width=w)


def panel(rec):
    phase = rec["phase"]
    x, y, w, h = rec["px"]
    d_path = os.path.join(FRAMES, phase, sorted(os.listdir(os.path.join(FRAMES, phase)))[0])
    frame = Image.open(d_path).convert("RGB")
    fw, fh = frame.size

    FW, FH = 1040, 650
    frame_small = frame.resize((FW, FH), Image.LANCZOS)
    sd = ImageDraw.Draw(frame_small)

    sx, sy = FW / fw, FH / fh
    bx0, by0, bx1, by1 = x * sx, y * sy, (x + w) * sx, (y + h) * sy
    # 暗底 + 四角标记，保证小框也看得见
    sd.rectangle([bx0 - 2, by0 - 2, bx1 + 2, by1 + 2], outline=(0, 60, 35), width=5)
    ticks(sd, bx0, by0, bx1, by1, GREEN, w=4, L=14)

    # 放大图
    crop = frame.crop((x, y, x + w, y + h))
    ZW, ZH = 620, 420
    z = min((ZW - 20) / crop.width, (ZH - 20) / crop.height)
    crop_big = crop.resize((max(1, int(crop.width * z)), max(1, int(crop.height * z))), Image.LANCZOS)
    zc = Image.new("RGB", (ZW, ZH), (12, 11, 16))
    zc.paste(crop_big, ((ZW - crop_big.width) // 2, (ZH - crop_big.height) // 2))
    zd = ImageDraw.Draw(zc)
    zd.rectangle([0, 0, ZW - 1, ZH - 1], outline=(60, 55, 72), width=2)

    # 连线：从整帧的框引到放大图
    canvas = Image.new("RGB", (FW + ZW + 30, 700), (18, 16, 22))
    canvas.paste(frame_small, (0, 44))
    canvas.paste(zc, (FW + 30, 120))
    d = ImageDraw.Draw(canvas)
    cx = FW + 30
    d.line(
        [(bx1 + 4, (by0 + by1) / 2 + 44), (cx - 8, 120 + ZH / 2)],
        fill=(90, 80, 60),
        width=2,
    )
    d.text((6, 10), LABEL.get(phase, phase), fill=WHITE, font=font(24, True))
    d.text(
        (FW + 30, 92),
        f"锚点放大 {z:.1f}x   {w}x{h}px   within {rec['within']:.2f} / cross {rec['cross']:.2f}",
        fill=DIM,
        font=font(16),
    )
    d.text(
        (FW + 30, 578),
        f"归一化位置 x={x / fw:.3f} y={y / fh:.3f} w={w / fw:.3f} h={h / fh:.3f}",
        fill=DIM,
        font=font(15),
    )
    d.text(
        (FW + 30, 604),
        "within=同环节最差帧的相关度（越高越稳）",
        fill=(110, 105, 120),
        font=font(14),
    )
    d.text(
        (FW + 30, 626),
        "cross=其他环节任意帧的最高相关度（越低越不会误判）",
        fill=(110, 105, 120),
        font=font(14),
    )
    return canvas


def main():
    with open(os.path.join(REPORTS, "anchor_picked.json"), encoding="utf-8") as f:
        recs = json.load(f)
    keep = [r for r in recs if r["phase"] != "hidden_boss"]
    os.makedirs(OUT, exist_ok=True)
    paths = []
    for i, rec in enumerate(keep):
        img = panel(rec)
        p = os.path.join(OUT, f"{i + 1:02d}_{rec['phase']}.png")
        img.save(p)
        paths.append(p)
        print(p)
    return paths


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
