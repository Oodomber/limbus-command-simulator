"""在指定帧上叠加百分比网格，方便目测锚点坐标（开发期工具）"""

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")


def font(size):
    for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def main(paths, out):
    tiles = []
    for rel in paths:
        p = os.path.join(FRAMES, rel)
        img = Image.open(p).convert("RGB").resize((1000, 625), Image.LANCZOS)
        d = ImageDraw.Draw(img)
        f = font(13)
        for i in range(1, 10):
            x = int(1000 * i / 10)
            y = int(625 * i / 10)
            d.line([(x, 0), (x, 625)], fill=(255, 60, 60), width=1)
            d.line([(0, y), (1000, y)], fill=(255, 60, 60), width=1)
            d.text((x + 2, 2), f"{i/10:.1f}", fill=(255, 220, 120), font=f)
            d.text((2, y + 1), f"{i/10:.1f}", fill=(255, 220, 120), font=f)
        d.text((6, 606), rel, fill=(120, 255, 160), font=f)
        tiles.append(img)
    sheet = Image.new("RGB", (1000, 625 * len(tiles)), (0, 0, 0))
    for i, t in enumerate(tiles):
        sheet.paste(t, (0, i * 625))
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main(sys.argv[2:], sys.argv[1])
