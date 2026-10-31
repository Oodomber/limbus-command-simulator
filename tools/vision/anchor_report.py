"""把 anchor_scan.py 的结果画成两张人工可检查的图（开发期工具）

产出：
  reports/anchor_map.png    每个环节的代表帧 + 前 3 个锚点框位置
  reports/anchor_crops.png  每个环节第 1 个锚点的原始裁切（放大 3 倍）
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
REPORTS = os.path.join(ROOT, "reports")

COLORS = [(255, 90, 90), (255, 176, 64), (120, 220, 140)]
PHASE_LABEL = {
    "cardpack": "卡包选择",
    "route": "路线",
    "combat": "战斗",
    "event": "事件",
    "judgment": "判定",
    "event_reward": "奖励卡",
    "shop": "商店",
    "hidden_boss": "隐藏BOSS",
    "boss_reward": "关底奖励",
}


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def main():
    with open(os.path.join(REPORTS, "anchor_scan.json"), encoding="utf-8") as f:
        data = json.load(f)

    phases = [p for p in data if data[p]]
    tw, th = 800, 500
    cols = 2
    rows = (len(phases) + cols - 1) // cols

    sheet = Image.new("RGB", (cols * tw, rows * (th + 26)), (18, 16, 22))
    draw = ImageDraw.Draw(sheet)
    f_label = font(20)

    crops = Image.new("RGB", (len(phases) * 260, 300), (18, 16, 22))
    dcrops = ImageDraw.Draw(crops)
    f_small = font(15)

    for i, phase in enumerate(phases):
        d = os.path.join(FRAMES, phase)
        files = sorted(x for x in os.listdir(d) if x.lower().endswith(".png"))
        if not files:
            continue
        frame = Image.open(os.path.join(d, files[0])).convert("RGB")
        cx = (i % cols) * tw
        cy = (i // cols) * (th + 26)

        thumb = frame.copy()
        td = ImageDraw.Draw(thumb)
        for k, a in enumerate(data[phase][:3]):
            x, y, w, h = a["px"]
            td.rectangle([x, y, x + w, y + h], outline=COLORS[k], width=6)
            td.text((x + 8, y + 8), str(k + 1), fill=COLORS[k], font=f_label)
        thumb = thumb.resize((tw, th), Image.LANCZOS)
        sheet.paste(thumb, (cx, cy + 26))

        label = f"{PHASE_LABEL.get(phase, phase)}  ({phase})"
        draw.text((cx + 8, cy + 3), label, fill=(230, 220, 200), font=f_label)

        ax, ay, aw, ah = data[phase][0]["px"]
        crop = frame.crop((ax, ay, ax + aw, ay + ah)).resize((240, 240), Image.LANCZOS)
        ox = i * 260
        crops.paste(crop, (ox + 10, 30))
        dcrops.text((ox + 10, 8), PHASE_LABEL.get(phase, phase), fill=(230, 220, 200), font=f_small)
        dcrops.text(
            (ox + 10, 274),
            f"{data[phase][0]['within']:.2f} / {data[phase][0]['cross']:.2f}",
            fill=(150, 145, 160),
            font=f_small,
        )

    out1 = os.path.join(REPORTS, "anchor_map.png")
    out2 = os.path.join(REPORTS, "anchor_crops.png")
    sheet.save(out1)
    crops.save(out2)
    print(out1)
    print(out2)


if __name__ == "__main__":
    main()
