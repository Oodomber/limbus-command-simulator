#!/usr/bin/env python3
"""
vision_server.py — Long-lived Python vision engine for 谨遵指令 Phase 10.

Reads JSON commands from stdin (one per line), processes them using
OpenCV template matching + mss screen capture, and writes JSON responses
to stdout (one per line).

Dependencies: pip install opencv-python mss numpy
"""

import sys
import json
import os
import time
import traceback
from pathlib import Path

# ── Lazy imports (checked at startup) ──
try:
    import cv2
    import numpy as np
    from mss import MSS
except ImportError as e:
    # Fatal — write error and exit before entering command loop
    err = {"ok": False, "error": f"ImportError: {e}. Install with: pip install opencv-python mss numpy"}
    sys.stdout.write(json.dumps(err, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.exit(1)


# ══════════════════════════════════════════════════════════════════════
#  VisionServer
# ══════════════════════════════════════════════════════════════════════

class VisionServer:
    def __init__(self):
        self.sct = MSS()
        self.template_cache = {}   # label -> BGR numpy array
        self.relic_index = {}      # relic_id -> BGR numpy array (64x64)
        self.monitors = self.sct.monitors  # monitor 0 = all, 1+ = individual

    # ── Main loop ──────────────────────────────────────────────────

    def run(self):
        """Read JSON commands from stdin, dispatch, write JSON responses to stdout."""
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
                action = cmd.get("action", "")
                req_id = cmd.get("reqId")  # echoed back for request-response pairing
                method = self._dispatch.get(action)
                if method is None:
                    resp = {"ok": False, "error": f"Unknown action: {action}"}
                else:
                    resp = method(cmd)
                # Always echo back reqId if present
                if req_id is not None:
                    resp["reqId"] = req_id
            except json.JSONDecodeError as e:
                resp = {"ok": False, "error": f"Invalid JSON: {e}"}
            except Exception as e:
                resp = {"ok": False, "error": str(e), "traceback": traceback.format_exc()}

            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()

            if action == "shutdown":
                break

    # ── Command dispatch table ─────────────────────────────────────

    @property
    def _dispatch(self):
        return {
            "health_check": self.cmd_health_check,
            "calibrate_capture": self.cmd_calibrate_capture,
            "detect_phase": self.cmd_detect_phase,
            "recognize_shop": self.cmd_recognize_shop,
            "rebuild_relic_icon_index": self.cmd_rebuild_relic_icon_index,
            "shutdown": self.cmd_shutdown,
        }

    # ══════════════════════════════════════════════════════════════
    #  COMMANDS
    # ══════════════════════════════════════════════════════════════

    def cmd_health_check(self, cmd):
        """Return OpenCV version, available monitors, and dependency status."""
        return {
            "ok": True,
            "opencv_version": cv2.__version__,
            "numpy_version": np.__version__,
            "monitor_count": len(self.monitors) - 1,  # exclude virtual "all" monitor
            "monitors": [
                {
                    "index": i,
                    "width": m["width"],
                    "height": m["height"],
                    "left": m.get("left", 0),
                    "top": m.get("top", 0),
                }
                for i, m in enumerate(self.monitors)
                if i > 0  # skip monitor 0 (virtual "all displays")
            ],
        }

    def cmd_calibrate_capture(self, cmd):
        """Capture a screenshot region and save it as a reference template."""
        region = cmd.get("region")
        save_path = cmd.get("save_path")
        label = cmd.get("label", "unknown")

        if not save_path:
            return {"ok": False, "error": "Missing save_path"}

        img = self._capture(region=region)
        os.makedirs(os.path.dirname(save_path) or ".", exist_ok=True)
        cv2.imwrite(save_path, img)

        h, w = img.shape[:2]
        # Also cache it in memory
        self.template_cache[label] = img

        return {
            "ok": True,
            "path": save_path,
            "size": [w, h],
            "label": label,
        }

    def cmd_detect_phase(self, cmd):
        """Screenshot + multi-scale template match against phase reference images."""
        screenshot = self._capture(region=cmd.get("region"), monitor=cmd.get("monitor", 0))
        phases = cmd.get("phases", [])
        threshold = cmd.get("conf_threshold", 0.75)
        refs_dir = cmd.get("refs_dir", "")

        if not phases:
            return {"ok": False, "error": "No phases specified"}

        best_phase = None
        best_conf = 0.0
        best_matched = None
        best_region = None

        for phase in phases:
            # Load all templates for this phase from {refs_dir}/{phase}*.png
            templates = self._load_phase_templates(phase, refs_dir)
            if not templates:
                continue

            for tpl_label, tpl_img in templates.items():
                conf, loc, size = self._match_template(screenshot, tpl_img, threshold)
                if conf > best_conf:
                    best_conf = conf
                    best_phase = phase
                    best_matched = tpl_label
                    best_region = {
                        "x": int(loc[0]), "y": int(loc[1]),
                        "width": int(size[0]), "height": int(size[1]),
                    }
                    # Early exit if we have a strong match
                    if best_conf >= threshold:
                        return {
                            "ok": True,
                            "phase": phase,
                            "confidence": round(best_conf, 4),
                            "matched_template": tpl_label,
                            "region": best_region,
                        }

        if best_phase and best_conf >= threshold:
            return {
                "ok": True,
                "phase": best_phase,
                "confidence": round(best_conf, 4),
                "matched_template": best_matched,
                "region": best_region,
            }

        return {
            "ok": True,
            "phase": None,
            "best_match": best_phase,
            "best_confidence": round(best_conf, 4),
        }

    def cmd_recognize_shop(self, cmd):
        """Capture the shop grid area and match each cell against relic icons."""
        screenshot = self._capture(region=cmd.get("region"), monitor=cmd.get("monitor", 0))
        grid = cmd.get("shop_grid")
        refs_dir = cmd.get("reference_dir", "")
        threshold = cmd.get("conf_threshold", 0.75)

        if not grid:
            return {"ok": False, "error": "Missing shop_grid"}

        cols = grid.get("cols", 5)
        rows = grid.get("rows", 2)
        gx = grid.get("x", 0)
        gy = grid.get("y", 0)
        gw = grid.get("width", 0)
        gh = grid.get("height", 0)

        if gw <= 0 or gh <= 0:
            return {"ok": False, "error": "Invalid shop_grid dimensions"}

        # Lazy-load relic icon index
        if not self.relic_index and refs_dir:
            self._build_relic_index(refs_dir)

        cell_w = gw // cols
        cell_h = gh // rows
        items = []

        for row in range(rows):
            for col in range(cols):
                slot = row * cols + col
                cx = gx + col * cell_w
                cy = gy + row * cell_h

                # Ensure cell is within screenshot bounds
                sh, sw = screenshot.shape[:2]
                if cy + cell_h > sh or cx + cell_w > sw:
                    items.append({"slot": slot, "id": None, "confidence": None, "error": "out of bounds"})
                    continue

                cell = screenshot[cy:cy + cell_h, cx:cx + cell_w]

                best_id = None
                best_conf = 0.0

                for relic_id, ref_img in self.relic_index.items():
                    conf, _, _ = self._match_template(cell, ref_img, 0.5)
                    if conf > best_conf:
                        best_conf = conf
                        best_id = relic_id

                if best_id and best_conf >= threshold:
                    items.append({
                        "slot": slot,
                        "id": best_id,
                        "confidence": round(best_conf, 4),
                    })
                else:
                    items.append({
                        "slot": slot,
                        "id": None,
                        "confidence": None if best_conf < 0.3 else round(best_conf, 4),
                    })

        return {"ok": True, "items": items}

    def cmd_rebuild_relic_icon_index(self, cmd):
        """Rebuild the relic icon matching index from disk."""
        source_dir = cmd.get("source_dir", "")
        dest_dir = cmd.get("dest_dir", "")
        target_size = tuple(cmd.get("target_size", [64, 64]))

        if not source_dir:
            return {"ok": False, "error": "Missing source_dir"}

        source = Path(source_dir)
        if not source.is_dir():
            return {"ok": False, "error": f"Source directory not found: {source_dir}"}

        # Copy/resize icons to dest_dir
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)

        count = 0
        for img_path in source.iterdir():
            if img_path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                continue
            try:
                img = cv2.imread(str(img_path), cv2.IMREAD_UNCHANGED)
                if img is None:
                    continue
                # Resize to target size
                resized = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)
                # Convert to BGR (drop alpha if present)
                if resized.shape[-1] == 4:
                    resized = cv2.cvtColor(resized, cv2.COLOR_BGRA2BGR)

                stem = img_path.stem
                self.relic_index[stem] = resized

                if dest_dir:
                    dest_path = os.path.join(dest_dir, f"{stem}.png")
                    cv2.imwrite(dest_path, resized)

                count += 1
            except Exception as e:
                print(f"[vision_server] Warning: failed to process {img_path.name}: {e}", file=sys.stderr)

        return {"ok": True, "indexed": count, "source_dir": source_dir, "dest_dir": dest_dir or None}

    def cmd_shutdown(self, cmd):
        """Graceful shutdown."""
        return {"ok": True, "message": "goodbye"}

    # ══════════════════════════════════════════════════════════════
    #  INTERNALS
    # ══════════════════════════════════════════════════════════════

    def _capture(self, region=None, monitor=0):
        """Capture a screenshot using mss. Returns BGR numpy array."""
        if region:
            mon = {
                "top": region["y"],
                "left": region["x"],
                "width": region["width"],
                "height": region["height"],
            }
        else:
            # mss monitors are 1-indexed (0 = virtual all)
            idx = min(monitor + 1, len(self.monitors) - 1) if monitor >= 0 else 1
            mon = self.monitors[idx]

        img = np.array(self.sct.grab(mon))
        # mss returns BGRA; convert to BGR
        return cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    def _match_template(self, screenshot, template, threshold=0.75):
        """
        Multi-scale template matching.
        Returns (best_confidence, best_location, best_size).
        """
        tpl_h, tpl_w = template.shape[:2]
        scr_h, scr_w = screenshot.shape[:2]

        # Template must be smaller than screenshot
        if tpl_h > scr_h or tpl_w > scr_w:
            # Try downscaling the template
            scale = min(scr_h / tpl_h, scr_w / tpl_w) * 0.9
            if scale < 0.2:
                return (0.0, (0, 0), (tpl_w, tpl_h))
            template = cv2.resize(template, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            tpl_h, tpl_w = template.shape[:2]

        best_conf = 0.0
        best_loc = (0, 0)
        best_size = (tpl_w, tpl_h)

        for scale in [0.8, 1.0, 1.2]:
            sw = int(tpl_w * scale)
            sh = int(tpl_h * scale)
            if sw < 10 or sh < 10:
                continue
            if sw > scr_w or sh > scr_h:
                continue

            scaled = cv2.resize(template, (sw, sh), interpolation=cv2.INTER_AREA)
            result = cv2.matchTemplate(screenshot, scaled, cv2.TM_CCOEFF_NORMED)
            _, max_val, _, max_loc = cv2.minMaxLoc(result)

            if max_val > best_conf:
                best_conf = max_val
                best_loc = max_loc
                best_size = (sw, sh)

        return (best_conf, best_loc, best_size)

    def _load_phase_templates(self, phase, refs_dir):
        """
        Load all template images for a given phase from refs_dir.
        Returns {label: BGR image}.
        """
        if not refs_dir or not os.path.isdir(refs_dir):
            return {}

        templates = {}
        prefix = f"{phase}_"
        try:
            for fname in os.listdir(refs_dir):
                if not fname.startswith(prefix):
                    continue
                if not fname.lower().endswith((".png", ".jpg", ".jpeg")):
                    continue
                label = fname.rsplit(".", 1)[0]  # strip extension
                if label in self.template_cache:
                    templates[label] = self.template_cache[label]
                else:
                    fpath = os.path.join(refs_dir, fname)
                    img = cv2.imread(fpath, cv2.IMREAD_COLOR)
                    if img is not None:
                        self.template_cache[label] = img
                        templates[label] = img
        except OSError:
            pass

        return templates

    def _build_relic_index(self, refs_dir, target_size=(64, 64)):
        """
        Load all relic reference icons into self.relic_index.
        Key = filename stem (relic ID), Value = BGR image resized to target_size.
        """
        if not refs_dir or not os.path.isdir(refs_dir):
            return

        for fname in os.listdir(refs_dir):
            if not fname.lower().endswith((".png", ".jpg", ".jpeg")):
                continue
            fpath = os.path.join(refs_dir, fname)
            try:
                img = cv2.imread(fpath, cv2.IMREAD_UNCHANGED)
                if img is None:
                    continue
                if img.shape[-1] == 4:
                    img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
                resized = cv2.resize(img, target_size, interpolation=cv2.INTER_AREA)
                stem = fname.rsplit(".", 1)[0]
                self.relic_index[stem] = resized
            except Exception:
                continue


# ══════════════════════════════════════════════════════════════════════
#  Entry point
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    server = VisionServer()
    server.run()
