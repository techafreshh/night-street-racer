#!/usr/bin/env python3
"""Deterministic generator for assets/city/night_sky.hdr.

Writes a tiny (64x32) RLE Radiance RGBE night-sky panorama:
a vertical dark-blue gradient (near-black zenith #05070f, horizon glow
band #1a1440 fading to black ground) plus ~40 fixed-seed white star
pixels in the top half. Godot's HDR loader only accepts RLE scanlines
(`32-bit_rle_rgbe`), so each scanline is RLE-encoded. Kept small (KBs)
for repo size and offline headless imports; a minimal stand-in in the
spirit of Poly Haven's CC0 night skies (see docs/CREDITS).
"""
import math
import os
import random

WIDTH = 64
HEIGHT = 32
STAR_COUNT = 40
STAR_SEED = 7

ZENITH = (0x05 / 255.0, 0x07 / 255.0, 0x0F / 255.0)
HORIZON = (0x1A / 255.0, 0x14 / 255.0, 0x40 / 255.0)
GROUND = (0.008, 0.008, 0.018)


def to_rgbe(r: float, g: float, b: float) -> bytes:
    m = max(r, g, b)
    if m < 1e-32:
        return bytes((0, 0, 0, 0))
    e = math.floor(math.log2(m)) + 1
    scale = (2.0**e) / 255.0
    r8 = min(255, int(r / scale))
    g8 = min(255, int(g / scale))
    b8 = min(255, int(b / scale))
    return bytes((r8, g8, b8, e + 128))


def encode_rle_scanline(scan: bytes) -> bytes:
    # Radiance RLE scanline: 0x02 0x02 <width hi> <width lo>, then one
    # channel run per component. Literal-only runs are valid RLE and
    # keep the encoder trivially correct; chunked at 128 per the spec.
    w = len(scan) // 4
    out = bytearray((0x02, 0x02, (w >> 8) & 0xFF, w & 0xFF))
    for c in range(4):
        channel = bytes(scan[i * 4 + c] for i in range(w))
        i = 0
        while i < w:
            n = min(128, w - i)
            out.append(n)
            out.extend(channel[i:i + n])
            i += n
    return bytes(out)


def sky_color(x: int, y: int) -> tuple:
    v = y / float(HEIGHT - 1)  # 0.0 zenith .. 1.0 nadir
    if v <= 0.5:
        t = v / 0.5
        r = ZENITH[0] + (HORIZON[0] - ZENITH[0]) * t
        g = ZENITH[1] + (HORIZON[1] - ZENITH[1]) * t
        b = ZENITH[2] + (HORIZON[2] - ZENITH[2]) * t
        band = math.exp(-(((v - 0.5) * 8.0) ** 2))
        r += 0.03 * band
        g += 0.02 * band
        b += 0.06 * band
    else:
        t = (v - 0.5) / 0.5
        r = HORIZON[0] + (GROUND[0] - HORIZON[0]) * t
        g = HORIZON[1] + (GROUND[1] - HORIZON[1]) * t
        b = HORIZON[2] + (GROUND[2] - HORIZON[2]) * t
    return (min(1.0, r), min(1.0, g), min(1.0, b))


def main() -> None:
    pixels = [[sky_color(x, y) for x in range(WIDTH)] for y in range(HEIGHT)]
    rng = random.Random(STAR_SEED)
    placed = 0
    while placed < STAR_COUNT:
        x = rng.randrange(WIDTH)
        y = rng.randrange(HEIGHT // 2)
        r, g, b = pixels[y][x]
        if r > 0.5:
            continue
        brightness = 0.6 + 0.4 * rng.random()
        pixels[y][x] = (brightness, brightness, min(1.0, brightness + 0.05))
        placed += 1
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "city", "night_sky.hdr")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 32 +X 64\n")
        for y in range(HEIGHT):
            scan = bytearray()
            for x in range(WIDTH):
                r, g, b = pixels[y][x]
                scan.extend(to_rgbe(r, g, b))
            f.write(encode_rle_scanline(bytes(scan)))
    print("wrote %s (%d bytes)" % (out, os.path.getsize(out)))


if __name__ == "__main__":
    main()
