"""把帧的某个小区域放大并叠细网格，用来量数字的精确位置（开发期工具）

用法：
  python tools/vision/crop_zoom.py <帧相对路径> <x> <y> <w> <h> <输出文件> [放大倍数] [网格步长%]
例：
  python tools/vision/crop_zoom.py combat/xxx.png 0 0.05 0.14 0.09 %TEMP%\\z.png 6 0.5
"""

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


def main():
    rel, x, y, w, h, out = sys.argv[1:7]
    scale = float(sys.argv[7]) if len(sys.argv) > 7 else 6.0
    step = float(sys.argv[8]) if len(sys.argv) > 8 else 0.005

    img = Image.open(os.path.join(FRAMES, rel)).convert("RGB")
    W, H = img.size
    x, y, w, h = float(x), float(y), float(w), float(h)
    box = (int(x * W), int(y * H), int((x + w) * W), int((y + h) * H))
    crop = img.crop(box)
    crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    d = ImageDraw.Draw(crop)
    f = font(12)

    # 竖线：每个 step 一条，标出绝对归一化坐标
    v = x
    while v <= x + w + 1e-9:
        px = int((v - x) * W * scale)
        major = abs((v * 100) % 1.0) < 1e-6
        d.line([(px, 0), (px, crop.height)], fill=(255, 90, 90) if major else (120, 40, 40), width=1)
        if major:
            d.text((px + 2, 2), f"{v:.2f}", fill=(255, 220, 120), font=f)
        v += step

    v = y
    while v <= y + h + 1e-9:
        py = int((v - y) * H * scale)
        major = abs((v * 100) % 1.0) < 1e-6
        d.line([(0, py), (crop.width, py)], fill=(255, 90, 90) if major else (120, 40, 40), width=1)
        if major:
            d.text((2, py + 1), f"{v:.2f}", fill=(255, 220, 120), font=f)
        v += step

    crop.save(out)
    print(f"{out}  {crop.width}x{crop.height}  from {box}")


if __name__ == "__main__":
    main()
