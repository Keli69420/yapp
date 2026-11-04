# Draws icon-180.png: a raised grey disc with a black barbell. Standard library only.
# Run from the project root: python3 -I tools/make_icon.py icon-180.png
import struct, sys, zlib

SIZE = 180
BG, SHADE, LIGHT, INK = (225, 225, 225), (172, 172, 172), (255, 255, 255), (20, 20, 20)
CX, CY, R = 90, 90, 64
BAR = [(40, 86, 100, 8, 2), (50, 64, 11, 52, 3), (64, 72, 8, 36, 3), (108, 72, 8, 36, 3), (119, 64, 11, 52, 3)]


def blur(mask, radius, passes=3):
    """Repeated box blur, which looks like a Gaussian."""
    for _ in range(passes):
        for horizontal in (True, False):
            out = [0.0] * (SIZE * SIZE)
            for a in range(SIZE):
                total, width = 0.0, 2 * radius + 1
                for b in range(-radius, SIZE + radius):
                    add = min(max(b + radius, 0), SIZE - 1)
                    sub = min(max(b - radius - 1, 0), SIZE - 1)
                    i_add = a * SIZE + add if horizontal else add * SIZE + a
                    i_sub = a * SIZE + sub if horizontal else sub * SIZE + a
                    total += mask[i_add] - mask[i_sub]
                    if 0 <= b < SIZE:
                        out[a * SIZE + b if horizontal else b * SIZE + a] = total / width
            mask = out
    return mask


def disc(ox=0, oy=0):
    return [1.0 if (x - CX - ox) ** 2 + (y - CY - oy) ** 2 <= R * R else 0.0 for y in range(SIZE) for x in range(SIZE)]


def in_bar(px, py):
    for x, y, w, h, r in BAR:
        if not (x <= px <= x + w and y <= py <= y + h):
            continue
        dx, dy = max(x + r - px, 0, px - (x + w - r)), max(y + r - py, 0, py - (y + h - r))
        if dx * dx + dy * dy <= r * r:
            return True
    return False


def mix(a, b, t):
    return tuple(a[c] * (1 - t) + b[c] * t for c in range(3))


shade, light = blur(disc(7, 7), 5), blur(disc(-7, -7), 5)
rows = bytearray()
for y in range(SIZE):
    rows.append(0)
    for x in range(SIZE):
        i = y * SIZE + x
        c = mix(BG, SHADE, shade[i])
        c = mix(c, LIGHT, light[i])
        d2 = (x + .5 - CX) ** 2 + (y + .5 - CY) ** 2
        c = mix(c, BG, max(0.0, min(1.0, R + .5 - d2 ** .5)))
        hits = sum(in_bar(x + (a + .5) / 4, y + (b + .5) / 4) for a in range(4) for b in range(4))
        c = mix(c, INK, hits / 16)
        rows += bytes(round(v) for v in c)


def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
