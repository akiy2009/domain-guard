"""Domain Guard アイコン生成スクリプト (PIL 不要 / 標準ライブラリのみ)"""
import math
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "icons"

GREEN_TOP = (34, 160, 82)
GREEN_BOTTOM = (12, 92, 48)
BORDER = (255, 255, 255)


def shield_half_width(y: float) -> float:
    if y < 0.08 or y > 0.93:
        return 0.0
    if y <= 0.55:
        return 0.42
    t = (y - 0.55) / (0.93 - 0.55)
    return 0.42 * math.sqrt(max(0.0, 1.0 - t * t))


def inside_shield(x: float, y: float) -> bool:
    return abs(x) <= shield_half_width(y)


def dist_to_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    seg_len2 = vx * vx + vy * vy
    if seg_len2 == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, (wx * vx + wy * vy) / seg_len2))
    cx, cy = ax + t * vx, ay + t * vy
    return math.hypot(px - cx, py - cy)


def render(size: int) -> list[list[tuple[int, int, int, int]]]:
    cx = 0.5
    scale = 0.92
    check = [(0.28, 0.5), (0.44, 0.66), (0.74, 0.32)]
    thickness = 0.085 if size >= 32 else 0.1
    border_t = 0.055 if size >= 32 else 0.07
    rows = []
    for py_i in range(size):
        row = []
        y = (py_i + 0.5) / size
        for px_i in range(size):
            x = (px_i + 0.5) / size
            nx = (x - cx) / scale
            ny = (y - 0.5) / scale + 0.5
            if not inside_shield(nx, ny):
                row.append((0, 0, 0, 0))
                continue
            hw = shield_half_width(ny)
            edge_dist = hw - abs(nx)
            if edge_dist < border_t:
                row.append((*BORDER, 255))
                continue
            grad = (ny - 0.08) / (0.93 - 0.08)
            r = int(GREEN_TOP[0] + (GREEN_BOTTOM[0] - GREEN_TOP[0]) * grad)
            g = int(GREEN_TOP[1] + (GREEN_BOTTOM[1] - GREEN_TOP[1]) * grad)
            b = int(GREEN_TOP[2] + (GREEN_BOTTOM[2] - GREEN_TOP[2]) * grad)
            on_check = min(
                dist_to_segment(nx, ny, *check[0], *check[1]),
                dist_to_segment(nx, ny, *check[1], *check[2]),
            )
            if on_check < thickness:
                row.append((*BORDER, 255))
            else:
                row.append((r, g, b, 255))
        rows.append(row)
    return rows


def write_png(path: Path, rows) -> None:
    height = len(rows)
    width = len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        rows = render(size)
        out = OUT_DIR / f"icon{size}.png"
        write_png(out, rows)
        print(f"wrote {out} ({size}x{size})")


if __name__ == "__main__":
    main()
