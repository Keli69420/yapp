# Draws the logo files with the standard library only. Run from the project root:
#   python3 -I tools/make_icon.py
# Writes icon-180.png (home-screen icon, solid grey background) and logo/logo.png
# (1024 px, transparent). The shapes below must match logo/logo.svg and icon.svg.
import math
import struct
import zlib

INK = (0x14, 0x14, 0x14)
GREY = (0xE1, 0xE1, 0xE1)
DX, DY = 1, 14  # the translate() in the SVG, which centres the drawing

CIRCLES = [(319, 150, 111), (176, 191, 23)]  # boulder, head
LINES = [  # points, width
    ([(58, 437), (452, 208)], 15),  # slope
    ([(186, 234), (226, 199)], 17),  # arm
    ([(148, 298), (122, 352), (92, 401)], 22),  # rear leg
    ([(92, 401), (115, 390)], 13),  # rear foot
    ([(156, 298), (221, 291), (214, 340)], 21),  # front leg
    ([(214, 340), (238, 326)], 13),  # front foot
]


def torso():
    """The torso path from the SVG, flattened into points."""
    hip_back, shoulder_back, shoulder_front, hip_front = (138.1, 293.2), (169.6, 223.2), (204.4, 242.8), (163.2, 303.9)
    pts = []
    c1, c2 = (148.5, 271.6), (157.8, 244.1)
    for i in range(30):
        t = i / 30
        pts.append(tuple((1 - t) ** 3 * hip_back[k] + 3 * (1 - t) ** 2 * t * c1[k] + 3 * (1 - t) * t * t * c2[k] + t ** 3 * shoulder_back[k] for k in (0, 1)))
    sx, sy = (shoulder_back[0] + shoulder_front[0]) / 2, (shoulder_back[1] + shoulder_front[1]) / 2
    start = math.atan2(shoulder_back[1] - sy, shoulder_back[0] - sx)
    for i in range(24):
        pts.append((sx + 20 * math.cos(start + math.pi * i / 24), sy + 20 * math.sin(start + math.pi * i / 24)))
    c = (186, 270)
    for i in range(20):
        t = i / 20
        pts.append(tuple((1 - t) ** 2 * shoulder_front[k] + 2 * (1 - t) * t * c[k] + t * t * hip_front[k] for k in (0, 1)))
    return pts


def coverage(size, zoom):
    """How much of each pixel the logo covers, 0 to 1. Zoom scales it around the centre."""
    k = size / 512 * zoom
    off = size * (1 - zoom) / 2

    def to_px(x, y):
        return ((x + DX) * k + off, (y + DY) * k + off)

    cov = [0.0] * (size * size)

    def stamp(x0, y0, x1, y1, sd):
        for y in range(max(0, int(y0) - 2), min(size, int(y1) + 3)):
            row = y * size
            for x in range(max(0, int(x0) - 2), min(size, int(x1) + 3)):
                c = 0.5 - sd(x + 0.5, y + 0.5)
                if c > 0:
                    cov[row + x] = max(cov[row + x], min(c, 1.0))

    for cx, cy, r in CIRCLES:
        X, Y = to_px(cx, cy)
        R = r * k
        stamp(X - R, Y - R, X + R, Y + R, lambda x, y, X=X, Y=Y, R=R: math.hypot(x - X, y - Y) - R)

    for pts, width in LINES:
        R = width * k / 2
        for p, q in zip(pts, pts[1:]):
            A, B = to_px(*p), to_px(*q)
            vx, vy = B[0] - A[0], B[1] - A[1]
            L = vx * vx + vy * vy

            def sd(x, y, A=A, vx=vx, vy=vy, L=L, R=R):
                t = max(0, min(1, ((x - A[0]) * vx + (y - A[1]) * vy) / L))
                return math.hypot(x - A[0] - t * vx, y - A[1] - t * vy) - R

            stamp(min(A[0], B[0]) - R, min(A[1], B[1]) - R, max(A[0], B[0]) + R, max(A[1], B[1]) + R, sd)

    poly = [to_px(*p) for p in torso()]
    n = len(poly)

    def poly_sd(x, y):
        best, inside = 1e9, False
        for i in range(n):
            (ax, ay), (bx, by) = poly[i], poly[(i + 1) % n]
            vx, vy = bx - ax, by - ay
            t = max(0, min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)))
            best = min(best, math.hypot(x - ax - t * vx, y - ay - t * vy))
            if (ay > y) != (by > y) and x < ax + (y - ay) / (by - ay) * (bx - ax):
                inside = not inside
        return -best if inside else best

    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    stamp(min(xs), min(ys), max(xs), max(ys), poly_sd)
    return cov


def write_png(path, size, cov, background=None):
    """background=None gives a transparent PNG; a colour gives a solid one, which iOS wants."""
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            c = cov[y * size + x]
            if background is None:
                rows += bytes((*INK, round(c * 255)))
            else:
                rows += bytes(round(background[i] * (1 - c) + INK[i] * c) for i in range(3))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    colour_type = 6 if background is None else 2
    header = struct.pack(">IIBBBBB", size, size, 8, colour_type, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


write_png("icon-180.png", 180, coverage(180, 0.84), GREY)
write_png("logo/logo.png", 1024, coverage(1024, 1.0))
