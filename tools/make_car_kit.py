#!/usr/bin/env python3
"""Deterministic generator for the four vendored tuner car bodies.

Emits four tiny original CC0 glTF 2.0 binary (.glb) stand-ins:
  assets/cars/coupe/coupe.glb (grip coupe)
  assets/cars/hatch/hatch.glb (drifty hatch)
  assets/cars/sedan/sedan.glb (balanced sedan)
  assets/cars/awd/awd.glb (AWD rally)
Each file holds one scene/node/mesh with POSITION+NORMAL float3 accessors,
uint16 indices, and a single pbrMetallicRoughness material using
baseColorFactor plus a small emissiveFactor so the bodies read at night
with no new lights. Geometry is fixed tables only (boxes plus small
vertical prisms for antennae/trim, no timestamps, no randomness), so
re-runs are byte-identical. Every body fits the shared rig footprint
(1.8 wide x 4.2 long, base at y 0) and the proven collision shape
(BoxShape3D 1.8 x 0.5 x 4.2). Kept small (KBs) for repo size and
offline headless imports. Design references (no file vendored) are
credited in docs/CREDITS: Sketchfab/Grab3D CC0 car pages.
"""
import json
import math
import os
import struct

OUT_BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "cars")


def _add_box(verts, norms, idxs, cx, cy, cz, sx, sy, sz):
    hx, hy, hz = sx / 2.0, sy / 2.0, sz / 2.0
    faces = [
        ((1.0, 0.0, 0.0), [
            (cx + hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz - hz),
            (cx + hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz + hz)]),
        ((-1.0, 0.0, 0.0), [
            (cx - hx, cy - hy, cz - hz), (cx - hx, cy - hy, cz + hz),
            (cx - hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz - hz)]),
        ((0.0, 1.0, 0.0), [
            (cx - hx, cy + hy, cz + hz), (cx + hx, cy + hy, cz + hz),
            (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz)]),
        ((0.0, -1.0, 0.0), [
            (cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
            (cx + hx, cy - hy, cz + hz), (cx - hx, cy - hy, cz + hz)]),
        ((0.0, 0.0, 1.0), [
            (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
            (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]),
        ((0.0, 0.0, -1.0), [
            (cx + hx, cy - hy, cz - hz), (cx - hx, cy - hy, cz - hz),
            (cx - hx, cy + hy, cz - hz), (cx + hx, cy + hy, cz - hz)]),
    ]
    for normal, quad in faces:
        base = len(verts)
        for v in quad:
            verts.append(v)
            norms.append(normal)
        idxs.extend((base, base + 1, base + 2, base, base + 2, base + 3))


def _add_prism(verts, norms, idxs, cx, cy, cz, radius, height, sides):
    hy = height / 2.0
    for i in range(sides):
        a0 = 2.0 * math.pi * i / sides
        a1 = 2.0 * math.pi * (i + 1) / sides
        am = 2.0 * math.pi * (i + 0.5) / sides
        n = (math.cos(am), 0.0, math.sin(am))
        b0 = (cx + radius * math.cos(a0), cy - hy, cz + radius * math.sin(a0))
        b1 = (cx + radius * math.cos(a1), cy - hy, cz + radius * math.sin(a1))
        t0 = (cx + radius * math.cos(a0), cy + hy, cz + radius * math.sin(a0))
        t1 = (cx + radius * math.cos(a1), cy + hy, cz + radius * math.sin(a1))
        base = len(verts)
        verts.extend((b0, t0, t1, b1))
        norms.extend((n, n, n, n))
        idxs.extend((base, base + 1, base + 2, base, base + 2, base + 3))
    top_c = (cx, cy + hy, cz)
    bot_c = (cx, cy - hy, cz)
    for i in range(sides):
        a0 = 2.0 * math.pi * i / sides
        a1 = 2.0 * math.pi * (i + 1) / sides
        t0 = (cx + radius * math.cos(a0), cy + hy, cz + radius * math.sin(a0))
        t1 = (cx + radius * math.cos(a1), cy + hy, cz + radius * math.sin(a1))
        b0 = (cx + radius * math.cos(a0), cy - hy, cz + radius * math.sin(a0))
        b1 = (cx + radius * math.cos(a1), cy - hy, cz + radius * math.sin(a1))
        base = len(verts)
        verts.extend((top_c, t1, t0))
        norms.extend(((0.0, 1.0, 0.0),) * 3)
        idxs.extend((base, base + 1, base + 2))
        base = len(verts)
        verts.extend((bot_c, b0, b1))
        norms.extend(((0.0, -1.0, 0.0),) * 3)
        idxs.extend((base, base + 1, base + 2))


def _write_glb(path, name, boxes, prisms, base_color, emissive):
    verts, norms, idxs = [], [], []
    for b in boxes:
        _add_box(verts, norms, idxs, *b)
    for p in prisms:
        _add_prism(verts, norms, idxs, *p)
    assert len(verts) < 65536, "too many verts for uint16 indices"
    assert len(idxs) % 3 == 0, "index count must be a triangle multiple"
    pos = b"".join(struct.pack("<3f", *v) for v in verts)
    nor = b"".join(struct.pack("<3f", *n) for n in norms)
    ind = b"".join(struct.pack("<H", i) for i in idxs)
    xs = [v[0] for v in verts]
    ys = [v[1] for v in verts]
    zs = [v[2] for v in verts]
    doc = {
        "asset": {
            "version": "2.0",
            "generator": "Night Street Racer tools/make_car_kit.py (CC0 procedural stand-in)",
            "copyright": "CC0-1.0",
        },
        "scene": 0,
        "scenes": [{"name": name, "nodes": [0]}],
        "nodes": [{"name": name, "mesh": 0}],
        "meshes": [{
            "name": name,
            "primitives": [{
                "attributes": {"POSITION": 0, "NORMAL": 1},
                "indices": 2,
                "material": 0,
            }],
        }],
        "materials": [{
            "name": name + "_mat",
            "pbrMetallicRoughness": {
                "baseColorFactor": [base_color[0], base_color[1], base_color[2], 1.0],
                "metallicFactor": 0.0,
                "roughnessFactor": 0.9,
            },
            "emissiveFactor": [emissive[0], emissive[1], emissive[2]],
        }],
        "accessors": [
            {
                "bufferView": 0, "byteOffset": 0, "componentType": 5126,
                "count": len(verts), "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            },
            {
                "bufferView": 1, "byteOffset": 0, "componentType": 5126,
                "count": len(norms), "type": "VEC3",
            },
            {
                "bufferView": 2, "byteOffset": 0, "componentType": 5123,
                "count": len(idxs), "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos)},
            {"buffer": 0, "byteOffset": len(pos), "byteLength": len(nor)},
            {"buffer": 0, "byteOffset": len(pos) + len(nor), "byteLength": len(ind)},
        ],
        "buffers": [{"byteLength": len(pos) + len(nor) + len(ind)}],
    }
    js = json.dumps(doc, separators=(",", ":")).encode("ascii")
    while len(js) % 4:
        js += b" "
    blob = pos + nor + ind
    while len(blob) % 4:
        blob += b"\x00"
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = bytearray()
    out += b"glTF" + struct.pack("<II", 2, total)
    out += struct.pack("<I", len(js)) + b"JSON" + js
    out += struct.pack("<I", len(blob)) + b"BIN\x00" + blob
    with open(path, "wb") as f:
        f.write(bytes(out))
    tris = len(idxs) // 3
    print("wrote %s (%d bytes, %d tris)" % (path, os.path.getsize(path), tris))


# Front of the car faces -Z (WheelFL/WheelFR sit at z -1.35).
# Every spec stays inside |x| <= 0.9, |z| <= 2.1 with base at y 0.
CARS = {
    "coupe": {
        # Low long-nose grip coupe: slab, tapered nose, set-back cabin, tail spoiler.
        "boxes": [
            (0.0, 0.30, 0.0, 1.70, 0.60, 4.00),
            (0.0, 0.35, -1.75, 1.60, 0.30, 0.70),
            (0.0, 0.85, 0.30, 1.40, 0.50, 1.80),
            (0.0, 0.75, 1.85, 1.60, 0.15, 0.50),
            (0.0, 0.10, -1.95, 1.70, 0.20, 0.30),
        ],
        "prisms": [
            (0.50, 1.25, 0.80, 0.03, 0.30, 6),
        ],
        "base": (0.10, 0.25, 0.80),
        "emissive": (0.05, 0.10, 0.30),
    },
    "hatch": {
        # Tall drifty hatch: short tail, upright cabin, stepped tailgate, hood scoop.
        "boxes": [
            (0.0, 0.30, 0.10, 1.70, 0.60, 3.80),
            (0.0, 0.95, -0.10, 1.50, 0.70, 2.20),
            (0.0, 0.80, 1.15, 1.50, 0.40, 0.60),
            (0.0, 0.65, -1.60, 1.60, 0.20, 0.80),
        ],
        "prisms": [
            (-0.50, 1.40, -0.60, 0.03, 0.30, 6),
        ],
        "base": (0.85, 0.30, 0.08),
        "emissive": (0.30, 0.10, 0.02),
    },
    "sedan": {
        # Balanced three-box sedan: hood, cabin, trunk deck.
        "boxes": [
            (0.0, 0.30, 0.0, 1.70, 0.60, 4.00),
            (0.0, 0.65, -1.50, 1.60, 0.25, 1.20),
            (0.0, 0.90, -0.10, 1.45, 0.55, 1.60),
            (0.0, 0.70, 1.45, 1.60, 0.30, 1.20),
        ],
        "prisms": [
            (0.50, 1.30, -0.40, 0.03, 0.30, 6),
        ],
        "base": (0.55, 0.57, 0.60),
        "emissive": (0.10, 0.12, 0.15),
    },
    "awd": {
        # Boxy AWD rally car: tall slab, upright cabin, roof scoop, bullbar, rear wing.
        "boxes": [
            (0.0, 0.35, 0.0, 1.75, 0.70, 4.10),
            (0.0, 1.00, 0.20, 1.50, 0.60, 2.00),
            (0.0, 1.35, 0.20, 0.50, 0.15, 0.80),
            (0.0, 0.45, -2.00, 1.60, 0.30, 0.20),
            (0.0, 1.00, 1.90, 1.60, 0.12, 0.40),
        ],
        "prisms": [
            (-0.60, 0.55, -2.00, 0.05, 0.60, 8),
            (0.60, 0.55, -2.00, 0.05, 0.60, 8),
        ],
        "base": (0.08, 0.45, 0.18),
        "emissive": (0.02, 0.15, 0.05),
    },
}


def main():
    for name in sorted(CARS):
        spec = CARS[name]
        folder = os.path.join(OUT_BASE, name)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name + ".glb")
        _write_glb(path, name, spec["boxes"], spec["prisms"], spec["base"], spec["emissive"])


if __name__ == "__main__":
    main()
