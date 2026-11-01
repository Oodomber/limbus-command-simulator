"""生成便携版解压阶段的启动图（electron-builder portable.splashImage 只吃 BMP）。

画面：深底 + 顶部 logo（直接用 resources/icon.png，字体里没有的手势字符会变豆腐块）
+ 金色标题 + 一行「正在解压运行文件…」+ 装饰进度条。

运行：python tools/make_splash_bmp.py
产出：resources/splash.bmp（600x400，24 位）
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "resources", "splash.bmp")

W, H = 600, 400
BG = (10, 10, 26)
GOLD = (201, 169, 78)
GOLD_DIM = (125, 90, 30)
GREY = (150, 145, 160)
SUBTLE = (110, 100, 120)


def font(size, bold=False):
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    return ImageFont.load_default()


def center_text(draw, y, text, f, fill):
    box = draw.textbbox((0, 0), text, font=f)
    w = box[2] - box[0]
    draw.text(((W - w) / 2, y), text, font=f, fill=fill)


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # 上下金色细线
    d.rectangle([40, 40, W - 40, 41], fill=GOLD_DIM)
    d.rectangle([40, H - 41, W - 40, H - 40], fill=GOLD_DIM)

    # 顶部 logo
    icon_path = os.path.join(ROOT, "resources", "icon.png")
    if os.path.exists(icon_path):
        icon = Image.open(icon_path).convert("RGBA")
        icon = icon.resize((120, 120), Image.LANCZOS)
        img.paste(icon, (int((W - 120) / 2), 54), icon)

    # 标题与副标题
    center_text(d, 190, "谨 遵 指 令", font(34, bold=True), GOLD)
    center_text(d, 242, "THE INDEX COMMAND SIMULATOR", font(14), SUBTLE)

    # 提示
    center_text(d, 294, "正在解压运行文件，请稍候…", font(17), GREY)

    # 装饰进度条
    d.rounded_rectangle([150, 332, W - 150, 338], radius=3, fill=(26, 26, 58))
    d.rounded_rectangle([150, 332, 150 + 120, 338], radius=3, fill=GOLD)

    img.save(OUT, "BMP")
    print(OUT, os.path.getsize(OUT), "bytes", img.mode, img.size)


if __name__ == "__main__":
    main()
