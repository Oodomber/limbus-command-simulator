"""锚点发现（开发期工具，不进打包产物）

目标：给 9 个环节里的每一次「页」，自动找出「只在当前页出现、别的页都没有」的小图块。

做法：
1. 所有帧缩放到 W×H 灰度图。
2. 在网格上滑窗取 PATCH×PATCH 的小块。
3. 对某个环节 p：
   - 模板 = 该环节所有帧在同一位置的小块逐像素取中位数（z 归一化后）
   - 自身分 within = 模板与该环节每帧小块的最小归一化互相关（最差的那一帧也要像）
   - 异己分 cross = 模板与其他环节任意一帧小块的最大归一化互相关
   - 可分辨度 = within - cross
4. 每个环节取可分辨度最高的若干个不重叠位置。

用法：python tools/vision/anchor_scan.py [--out reports/anchor_scan.json]
"""

import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

W, H = 640, 400
PATCH = 40
STEP = 10
TOPK = 8


def zscore(a, axis=(-2, -1)):
    m = a.mean(axis=axis, keepdims=True)
    s = a.std(axis=axis, keepdims=True)
    return (a - m) / (s + 1e-6)


def load_frames(frames_dir):
    phases = {}
    for phase in sorted(os.listdir(frames_dir)):
        d = os.path.join(frames_dir, phase)
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if f.lower().endswith(".png"))
        if not files:
            continue
        arrs = []
        for f in files:
            img = Image.open(os.path.join(d, f)).convert("L").resize((W, H), Image.LANCZOS)
            arrs.append(np.asarray(img, dtype=np.float32))
        phases[phase] = np.stack(arrs)
        print(f"  {phase:<14} {len(arrs):>3} 帧")
    return phases


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="datasets/frames")
    ap.add_argument("--out", default="reports/anchor_scan.json")
    ap.add_argument("--crops", default="reports/anchors")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    frames_dir = os.path.join(root, args.frames)
    if not os.path.isdir(frames_dir):
        sys.exit(f"找不到帧目录：{frames_dir}")

    print("读取帧：")
    phases = load_frames(frames_dir)
    names = list(phases.keys())
    all_frames = np.concatenate([phases[n] for n in names])
    owner = np.concatenate([[n] * len(phases[n]) for n in names])
    n_total = len(all_frames)
    print(f"合计 {n_total} 帧，{len(names)} 个环节")

    ys = range(0, H - PATCH + 1, STEP)
    xs = range(0, W - PATCH + 1, STEP)
    results = {n: [] for n in names}

    for y in ys:
        for x in xs:
            patches = all_frames[:, y:y + PATCH, x:x + PATCH]
            pn = zscore(patches).reshape(n_total, -1)
            pn = pn / (np.linalg.norm(pn, axis=1, keepdims=True) + 1e-6)
            # 空白块不能当锚点：黑背景在哪都像，会给出「假高可分辨度」
            med = np.median(patches, axis=0)
            if med.std() < 12.0:
                continue
            gy, gx = np.gradient(med)
            if (gy * gy + gx * gx).mean() < 60.0:
                continue
            for name in names:
                idx = np.where(owner == name)[0]
                if len(idx) < 2:
                    continue
                tmpl = np.median(pn[idx], axis=0)
                tn = tmpl / (np.linalg.norm(tmpl) + 1e-6)
                sims = pn @ tn
                within = float(sims[idx].min())
                cross = float(np.delete(sims, idx).max()) if len(idx) < n_total else 1.0
                results[name].append((within - cross, within, cross, x, y))

    sx = 2560 / W
    sy = 1600 / H
    report = {}
    os.makedirs(os.path.join(root, args.crops), exist_ok=True)

    for name in names:
        rows = sorted(results[name], reverse=True)
        picked = []
        for score, within, cross, x, y in rows:
            if score <= 0:
                break
            if any(abs(x - px) < PATCH and abs(y - py) < PATCH for _, _, _, px, py in picked):
                continue
            picked.append((score, within, cross, x, y))
            if len(picked) >= TOPK:
                break
        report[name] = [
            {
                "score": round(s, 4),
                "within": round(w, 4),
                "cross": round(c, 4),
                "patch": [x * 40 // 40, y],
                "norm": [
                    round(x / (W - PATCH), 4),
                    round(y / (H - PATCH), 4),
                    round(PATCH / W, 4),
                    round(PATCH / H, 4),
                ],
                "px": [
                    int(x * sx),
                    int(y * sy),
                    int(PATCH * sx),
                    int(PATCH * sy),
                ],
            }
            for s, w, c, x, y in picked
        ]
        print(f"\n{name}")
        for r in report[name][:4]:
            print(
                f"  可分辨 {r['score']:+.3f}  自身 {r['within']:.3f}  异己 {r['cross']:.3f}"
                f"  像素框 x={r['px'][0]} y={r['px'][1]} w={r['px'][2]}"
            )

    out_path = os.path.join(root, args.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n写入 {out_path}")


if __name__ == "__main__":
    main()
