#!/usr/bin/env python3
from __future__ import annotations

import math
import os
import zlib

PAGE_WIDTH = 612
PAGE_HEIGHT = 792


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def template_color(u: float, v: float) -> tuple[int, int, int]:
    # Keep this close to the in-game fallback style so the template is familiar.
    grad = 0.45 + 0.55 * (1.0 - v)
    base_r = int((16 + 35 * grad))
    base_g = int((34 + 85 * grad))
    base_b = int((53 + 120 * grad))

    stripe_palette = [
        (100, 210, 255),
        (43, 139, 224),
        (76, 180, 255),
    ]
    stripe_index = int(u * 20) % 3
    stripe_mix = 0.62 if (int(u * 20) % 1) == 0 else 0.0
    sr, sg, sb = stripe_palette[stripe_index]
    r = int(base_r * (1 - stripe_mix) + sr * stripe_mix)
    g = int(base_g * (1 - stripe_mix) + sg * stripe_mix)
    b = int(base_b * (1 - stripe_mix) + sb * stripe_mix)

    if 0.08 <= u <= 0.18 and 0.2 <= v <= 0.4:
        r, g, b = 255, 111, 97

    dx = u - 0.76
    dy = v - 0.7
    if (dx * dx) / (0.12 * 0.12) + (dy * dy) / (0.12 * 0.12) <= 1.0:
        r, g, b = 255, 209, 102

    if 0.48 <= u <= 0.51:
        r, g, b = 255, 255, 255

    diag_a = v - u * 0.85
    if -0.02 <= diag_a <= 0.02:
        r = int(r * 0.55)
        g = int(g * 0.55)
        b = int(b * 0.55)

    diag_b = v - (0.22 + u * 0.56)
    if -0.01 <= diag_b <= 0.01:
        r = int(r * 0.88 + 255 * 0.12)
        g = int(g * 0.88 + 255 * 0.12)
        b = int(b * 0.88 + 255 * 0.12)

    return r, g, b


def build_template_image(width: int, height: int) -> bytes:
    pixels = bytearray(width * height * 3)
    idx = 0
    for y in range(height):
        v = y / max(1, height - 1)
        for x in range(width):
            u = x / max(1, width - 1)
            r, g, b = template_color(u, v)
            pixels[idx] = r
            pixels[idx + 1] = g
            pixels[idx + 2] = b
            idx += 3
    return bytes(pixels)


def build_sphere_preview_image(size: int) -> bytes:
    pixels = bytearray(size * size * 3)
    light = (0.35, 0.55, 1.0)
    light_len = math.sqrt(light[0] * light[0] + light[1] * light[1] + light[2] * light[2])
    lx, ly, lz = light[0] / light_len, light[1] / light_len, light[2] / light_len
    center = (size - 1) * 0.5
    radius = size * 0.44
    idx = 0

    for py in range(size):
        for px in range(size):
            nx = (px - center) / radius
            ny = (center - py) / radius
            rr = nx * nx + ny * ny
            if rr > 1.0:
                bg = int(236 - 30 * (py / max(1, size - 1)))
                pixels[idx] = bg
                pixels[idx + 1] = bg
                pixels[idx + 2] = min(255, bg + 8)
                idx += 3
                continue

            nz = math.sqrt(max(0.0, 1.0 - rr))
            lon = math.atan2(nz, nx)
            lat = math.asin(max(-1.0, min(1.0, ny)))
            u = (lon / (2.0 * math.pi) + 0.5) % 1.0
            v = 0.5 - lat / math.pi
            r, g, b = template_color(u, v)

            ndotl = max(0.0, nx * lx + ny * ly + nz * lz)
            shade = 0.35 + 0.65 * ndotl
            rim = clamp01((1.0 - nz) * 1.2)
            r = int(r * shade + 255 * rim * 0.15)
            g = int(g * shade + 255 * rim * 0.15)
            b = int(b * shade + 255 * rim * 0.15)

            pixels[idx] = max(0, min(255, r))
            pixels[idx + 1] = max(0, min(255, g))
            pixels[idx + 2] = max(0, min(255, b))
            idx += 3

    return bytes(pixels)


def escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class PDFBuilder:
    def __init__(self) -> None:
        self._objects: list[bytes] = []

    def add_object(self, payload: bytes | str) -> int:
        data = payload.encode("latin-1") if isinstance(payload, str) else payload
        self._objects.append(data)
        return len(self._objects)

    def render(self, root_obj_id: int) -> bytes:
        out = bytearray()
        out.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        xref_offsets = [0]
        for index, obj in enumerate(self._objects, start=1):
            xref_offsets.append(len(out))
            out.extend(f"{index} 0 obj\n".encode("ascii"))
            out.extend(obj)
            out.extend(b"\nendobj\n")

        xref_start = len(out)
        out.extend(f"xref\n0 {len(self._objects) + 1}\n".encode("ascii"))
        out.extend(b"0000000000 65535 f \n")
        for offset in xref_offsets[1:]:
            out.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
        out.extend(
            f"trailer\n<< /Size {len(self._objects) + 1} /Root {root_obj_id} 0 R >>\n".encode("ascii")
        )
        out.extend(f"startxref\n{xref_start}\n%%EOF\n".encode("ascii"))
        return bytes(out)


def image_object(width: int, height: int, rgb_data: bytes) -> bytes:
    compressed = zlib.compress(rgb_data, level=9)
    header = (
        f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
        f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
        f"/Length {len(compressed)} >>\nstream\n"
    ).encode("ascii")
    return header + compressed + b"\nendstream"


def stream_object(content: str) -> bytes:
    payload = content.encode("latin-1")
    return f"<< /Length {len(payload)} >>\nstream\n".encode("ascii") + payload + b"\nendstream"


def text_line(x: float, y: float, size: float, text: str) -> str:
    return f"BT /F1 {size:.2f} Tf {x:.2f} {y:.2f} Td ({escape_pdf_text(text)}) Tj ET\n"


def line(x1: float, y1: float, x2: float, y2: float) -> str:
    return f"{x1:.2f} {y1:.2f} m {x2:.2f} {y2:.2f} l S\n"


def rect(x: float, y: float, w: float, h: float, fill: bool = False) -> str:
    op = "f" if fill else "S"
    return f"{x:.2f} {y:.2f} {w:.2f} {h:.2f} re {op}\n"


def build_pdf(output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    pdf = PDFBuilder()

    font_id = pdf.add_object("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    template_w, template_h = 1024, 512
    sphere_size = 840
    template_image_id = pdf.add_object(image_object(template_w, template_h, build_template_image(template_w, template_h)))
    sphere_image_id = pdf.add_object(image_object(sphere_size, sphere_size, build_sphere_preview_image(sphere_size)))

    resources_id = pdf.add_object(
        (
            f"<< /Font << /F1 {font_id} 0 R >> "
            f"/XObject << /ImTemplate {template_image_id} 0 R /ImSphere {sphere_image_id} 0 R >> >>"
        )
    )

    # Page 1: paint template with guides
    tx, ty, tw, th = 56.0, 290.0, 500.0, 250.0
    content_1 = []
    content_1.append("0.08 0.10 0.14 rg\n")
    content_1.append(rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=True))
    content_1.append("1 1 1 rg\n")
    content_1.append(text_line(56, 742, 20, "Get Tilted Marble Skin Template"))
    content_1.append(text_line(56, 720, 11, "2:1 equirectangular texture (left/right edges touch at the seam)."))
    content_1.append(text_line(56, 702, 11, "Detail is sharpest near equator. Poles compress heavily."))
    content_1.append(f"q {tw:.2f} 0 0 {th:.2f} {tx:.2f} {ty:.2f} cm /ImTemplate Do Q\n")

    content_1.append("0.95 0.30 0.25 RG 2 w\n")
    content_1.append(line(tx, ty, tx, ty + th))
    content_1.append(line(tx + tw, ty, tx + tw, ty + th))
    content_1.append("0.30 0.80 0.95 RG 1.5 w\n")
    content_1.append(line(tx, ty + th * 0.5, tx + tw, ty + th * 0.5))
    content_1.append("0.96 0.86 0.38 RG 1.25 w\n")
    content_1.append(rect(tx, ty + th * 0.25, tw, th * 0.5))
    content_1.append("0.82 0.82 0.82 RG 0.8 w\n")
    content_1.append(line(tx, ty + 6, tx + tw, ty + 6))
    content_1.append(line(tx, ty + th - 6, tx + tw, ty + th - 6))

    content_1.append("1 1 1 rg\n")
    content_1.append(text_line(tx, ty - 22, 10, "Seam: left and right edges connect"))
    content_1.append(text_line(tx + 280, ty - 22, 10, "Equator center line"))
    content_1.append(text_line(tx, ty - 38, 10, "Safe detail band (25%-75% V): highest visible fidelity"))
    content_1.append(text_line(tx, ty - 54, 10, "Keep logos/text away from top and bottom 8-12% to avoid polar stretching"))

    page1_content_id = pdf.add_object(stream_object("".join(content_1)))

    # Page 2: fit preview
    rx, ry, rw, rh = 146.0, 560.0, 320.0, 160.0
    sx, sy, sw, sh = 126.0, 160.0, 360.0, 360.0
    content_2 = []
    content_2.append("0.09 0.11 0.15 rg\n")
    content_2.append(rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=True))
    content_2.append("1 1 1 rg\n")
    content_2.append(text_line(56, 742, 20, "Marble Skin Wrap Preview"))
    content_2.append(text_line(56, 720, 11, "Same template shown above, wrapped onto a sphere for visual fit."))
    content_2.append(f"q {rw:.2f} 0 0 {rh:.2f} {rx:.2f} {ry:.2f} cm /ImTemplate Do Q\n")
    content_2.append(f"q {sw:.2f} 0 0 {sh:.2f} {sx:.2f} {sy:.2f} cm /ImSphere Do Q\n")
    content_2.append("0.95 0.30 0.25 RG 1.2 w\n")
    content_2.append(line(rx, ry + rh + 8, sx + sw * 0.52, sy + sh * 0.5))
    content_2.append(line(rx + rw, ry + rh + 8, sx + sw * 0.52, sy + sh * 0.5))
    content_2.append("0.30 0.80 0.95 RG 1.2 w\n")
    content_2.append(line(rx + rw * 0.5, ry, sx + sw * 0.5, sy + sh * 0.5))
    content_2.append("1 1 1 rg\n")
    content_2.append(text_line(56, 118, 10, "Left/right template edges converge at one vertical seam on the marble."))
    content_2.append(text_line(56, 102, 10, "Horizontal center of template maps to the marble equator."))
    content_2.append(text_line(56, 86, 10, "Top/bottom rows collapse near poles, so avoid critical detail there."))

    page2_content_id = pdf.add_object(stream_object("".join(content_2)))

    pages_id = len(pdf._objects) + 3
    page1_id = pdf.add_object(
        (
            f"<< /Type /Page /Parent {pages_id} 0 R "
            f"/MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources {resources_id} 0 R /Contents {page1_content_id} 0 R >>"
        )
    )
    page2_id = pdf.add_object(
        (
            f"<< /Type /Page /Parent {pages_id} 0 R "
            f"/MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources {resources_id} 0 R /Contents {page2_content_id} 0 R >>"
        )
    )
    pages_id = pdf.add_object(f"<< /Type /Pages /Kids [{page1_id} 0 R {page2_id} 0 R] /Count 2 >>")
    catalog_id = pdf.add_object(f"<< /Type /Catalog /Pages {pages_id} 0 R >>")

    with open(output_path, "wb") as handle:
        handle.write(pdf.render(catalog_id))


def main() -> None:
    output_path = os.path.join("output", "pdf", "marble-skin-template.pdf")
    build_pdf(output_path)
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
