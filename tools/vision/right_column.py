"""对比各环节右侧竖排图标栏（开发期工具）

用于判断「右侧三个小方框」能不能当卡包页的锚点：
把每个环节代表帧的右边缘竖条裁下来并排，肉眼比对图标组合是否唯一。
"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")
OUT = os.path.join(ROOT, "reports")

X0, X1 = 0.925, 1.0
Y0, Y1 = 0.0, 0.68


def font(size):
    for p in (r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def main(out_name):
    phases = [p for p in sorted(os.listdir(FRAMES)) if os.path.isdir(os.path.join(FRAMES, p))]
    tiles = []
    for phase in phases:
        files = sorted(f for f in os.listdir(os.path.join(FRAMES, phase)) if f.lower().endswith(".png"))
        if not files:
            continue
        img = Image.open(os.path.join(FRAMES, phase, files[0])).convert("RGB")
        w, h = img.size
        crop = img.crop((int(X0 * w), int(Y0 * h), int(X1 * w), int(Y1 * h)))
        crop = crop.resize((int(crop.width * 1.6), int(crop.height * 1.6)), Image.LANCZOS)
        tiles.append((phase, crop))

    cw = max(t.width for _, t in tiles) + 20
    ch = max(t.height for _, t in tiles) + 34
    sheet = Image.new("RGB", (cw * len(tiles), ch), (18, 16, 22))
    d = ImageDraw.Draw(sheet)
    f = font(17)
    for i, (phase, t) in enumerate(tiles):
        sheet.paste(t, (i * cw + 10, 30))
        d.text((i * cw + 10, 6), phase, fill=(230, 220, 200), font=f)
    p = os.path.join(OUT, out_name)
    sheet.save(p)
    print(p)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "right_column.png")
