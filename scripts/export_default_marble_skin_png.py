#!/usr/bin/env python3
from __future__ import annotations

import math
import os
import struct
import zlib

WIDTH = 512
HEIGHT = 256


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def blend_channel(dst: int, src: int, alpha: float) -> int:
    mixed = dst * (1.0 - alpha) + src * alpha
    return int(clamp(round(mixed), 0, 255))


def write_pixel(buf: bytearray, x: int, y: int, color: tuple[int, int, int]) -> None:
    if x < 0 or x >= WIDTH or y < 0 or y >= HEIGHT:
        return
    idx = (y * WIDTH + x) * 3
    buf[idx] = color[0]
    buf[idx + 1] = color[1]
    buf[idx + 2] = color[2]


def blend_pixel(buf: bytearray, x: int, y: int, color: tuple[int, int, int], alpha: float) -> None:
    if x < 0 or x >= WIDTH or y < 0 or y >= HEIGHT:
        return
    idx = (y * WIDTH + x) * 3
    buf[idx] = blend_channel(buf[idx], color[0], alpha)
    buf[idx + 1] = blend_channel(buf[idx + 1], color[1], alpha)
    buf[idx + 2] = blend_channel(buf[idx + 2], color[2], alpha)


def lerp_color(c0: tuple[int, int, int], c1: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        int(round(c0[0] + (c1[0] - c0[0]) * t)),
        int(round(c0[1] + (c1[1] - c0[1]) * t)),
        int(round(c0[2] + (c1[2] - c0[2]) * t)),
    )


def gradient_color(t: float) -> tuple[int, int, int]:
    c0 = (0x19, 0x31, 0x45)
    c1 = (0x1F, 0x4F, 0x78)
    c2 = (0x10, 0x22, 0x35)
    if t <= 0.55:
        return lerp_color(c0, c1, t / 0.55)
    return lerp_color(c1, c2, (t - 0.55) / 0.45)


def fill_background(buf: bytearray) -> None:
    dx = float(WIDTH)
    dy = float(HEIGHT)
    denom = dx * dx + dy * dy
    for y in range(HEIGHT):
        for x in range(WIDTH):
            t = clamp((x * dx + y * dy) / denom, 0.0, 1.0)
            write_pixel(buf, x, y, gradient_color(t))


def fill_rect(
    buf: bytearray,
    x: float,
    y: float,
    w: float,
    h: float,
    color: tuple[int, int, int],
) -> None:
    x0 = max(0, int(math.floor(x)))
    x1 = min(WIDTH, int(math.ceil(x + w)))
    y0 = max(0, int(math.floor(y)))
    y1 = min(HEIGHT, int(math.ceil(y + h)))
    for py in range(y0, y1):
        for px in range(x0, x1):
            if x <= px < x + w and y <= py < y + h:
                write_pixel(buf, px, py, color)


def fill_circle(
    buf: bytearray,
    cx: float,
    cy: float,
    radius: float,
    color: tuple[int, int, int],
) -> None:
    x0 = max(0, int(math.floor(cx - radius)))
    x1 = min(WIDTH - 1, int(math.ceil(cx + radius)))
    y0 = max(0, int(math.floor(cy - radius)))
    y1 = min(HEIGHT - 1, int(math.ceil(cy + radius)))
    rr = radius * radius
    for py in range(y0, y1 + 1):
        for px in range(x0, x1 + 1):
            dx = (px + 0.5) - cx
            dy = (py + 0.5) - cy
            if dx * dx + dy * dy <= rr:
                write_pixel(buf, px, py, color)


def distance_to_segment(
    px: float,
    py: float,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
) -> float:
    vx = x2 - x1
    vy = y2 - y1
    wx = px - x1
    wy = py - y1
    vv = vx * vx + vy * vy
    if vv <= 1e-9:
        return math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    t = clamp((wx * vx + wy * vy) / vv, 0.0, 1.0)
    proj_x = x1 + t * vx
    proj_y = y1 + t * vy
    return math.sqrt((px - proj_x) ** 2 + (py - proj_y) ** 2)


def stroke_line(
    buf: bytearray,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: float,
    color: tuple[int, int, int],
    alpha: float,
) -> None:
    half = width * 0.5
    pad = int(math.ceil(half + 1.0))
    x0 = max(0, int(math.floor(min(x1, x2))) - pad)
    x3 = min(WIDTH - 1, int(math.ceil(max(x1, x2))) + pad)
    y0 = max(0, int(math.floor(min(y1, y2))) - pad)
    y3 = min(HEIGHT - 1, int(math.ceil(max(y1, y2))) + pad)
    for py in range(y0, y3 + 1):
        for px in range(x0, x3 + 1):
            dist = distance_to_segment(px + 0.5, py + 0.5, x1, y1, x2, y2)
            if dist <= half:
                # Soft 1px feather at edge to better match canvas stroke antialiasing.
                edge_alpha = alpha
                if dist > half - 1.0:
                    edge_alpha = alpha * (half - dist)
                if edge_alpha > 0:
                    blend_pixel(buf, px, py, color, edge_alpha)


def chunk(chunk_type: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + chunk_type + payload + struct.pack(">I", crc)


def write_png(path: str, rgb: bytes, width: int, height: int) -> None:
    raw = bytearray()
    row_bytes = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0
        start = y * row_bytes
        raw.extend(rgb[start : start + row_bytes])

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", ihdr))
    png.extend(chunk(b"IDAT", idat))
    png.extend(chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(png)


def build_default_skin() -> bytes:
    buf = bytearray(WIDTH * HEIGHT * 3)
    fill_background(buf)

    stripe_colors = [
        (0x64, 0xD2, 0xFF),
        (0x2B, 0x8B, 0xE0),
        (0x4C, 0xB4, 0xFF),
    ]
    stripe_width = WIDTH / 20.0
    for i in range(20):
        color = stripe_colors[i % len(stripe_colors)]
        fill_rect(buf, i * stripe_width, 0.0, stripe_width * 0.7, HEIGHT, color)

    fill_rect(buf, WIDTH * 0.08, HEIGHT * 0.2, WIDTH * 0.1, HEIGHT * 0.2, (0xFF, 0x6F, 0x61))
    fill_circle(buf, WIDTH * 0.76, HEIGHT * 0.7, HEIGHT * 0.12, (0xFF, 0xD1, 0x66))
    fill_rect(buf, WIDTH * 0.48, 0.0, WIDTH * 0.03, HEIGHT, (0xFF, 0xFF, 0xFF))

    stroke_line(
        buf,
        WIDTH * 0.15,
        0.0,
        WIDTH * 0.95,
        float(HEIGHT),
        10.0,
        (0, 0, 0),
        0.45,
    )
    stroke_line(
        buf,
        0.0,
        HEIGHT * 0.22,
        float(WIDTH),
        HEIGHT * 0.78,
        5.0,
        (255, 255, 255),
        0.5,
    )

    return bytes(buf)


def main() -> None:
    out_dir = os.path.join("output", "skins")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "default-marble-reference-512x256.png")
    skin = build_default_skin()
    write_png(out_path, skin, WIDTH, HEIGHT)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
