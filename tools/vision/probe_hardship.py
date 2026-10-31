"""验证「追加的苦难」能不能分开关底奖励和关卡奖励（一次性实验脚本）"""

import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, "datasets", "frames")


def vec(img, box):
    g = np.asarray(img.convert("L"), dtype=np.float32)
    x0, y0, x1, y1 = box
    p = g[y0:y1, x0:x1]
    v = p.ravel() - p.mean()
    n = np.linalg.norm(v)
    return v / n if n else v


def main():
    # 模板：153658（三张卡的关底奖励）最左那张卡的「追加的苦难」标签
    ref = Image.open(os.path.join(FRAMES, "boss_reward", "20261030-153658-408.png"))
    W, H = ref.size
    tmpl_box = (int(0.225 * W), int(0.573 * H), int(0.330 * W), int(0.607 * H))
    t = vec(ref, tmpl_box)
    tw = tmpl_box[2] - tmpl_box[0]
    th = tmpl_box[3] - tmpl_box[1]
    print(f"模板 {tw}x{th}px（{tw*th} 维）")

    targets = [
        ("boss_reward", "20261030-153658-408.png"),
        ("boss_reward", "20261030-154610-347.png"),
        ("boss_reward", "20261030-155338-008.png"),
        ("boss_reward", "20261030-155342-538.png"),
        ("boss_reward", "20261030-224807-745.png"),
        ("boss_reward", "20261031-114454-408.png"),
        ("event_reward", "20261030-153647-605.png"),
        ("event_reward", "20261030-154625-273.png"),
        ("cardpack", "20261030-151834-617.png"),
    ]

    y0, y1 = int(0.573 * H), int(0.607 * H)
    for phase, name in targets:
        fp = os.path.join(FRAMES, phase, name)
        if not os.path.exists(fp):
            print(f"  {phase}/{name}: 不存在，跳过")
            continue
        im = Image.open(fp)
        best, best_x = -2.0, 0.0
        x = 0.12
        while x < 0.86:
            x0 = int(x * W)
            v = vec(im, (x0, y0, x0 + tw, y1))
            if v.shape == t.shape:
                s = float(v @ t)
                if s > best:
                    best, best_x = s, x
            x += 0.01
        print(f"  {phase:13s} {name}  最高 {best:+.3f} @ x={best_x:.2f}")


if __name__ == "__main__":
    main()
