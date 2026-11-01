#!/usr/bin/env python3
"""Deterministic generator for the vendored city kit meshes in assets/city/.

Emits six tiny original CC0 glTF 2.0 binary (.glb) stand-ins in the style
of Kenney's CC0 city kits (see docs/CREDITS):
  building_tower.glb, building_shop.glb, streetlamp.glb,
  neon_sign.glb, barrier.glb, street_prop.glb
Each file holds one scene/node/mesh with POSITION+NORMAL float3 accessors,
uint16 indices, and a single pbrMetallicRoughness material using
baseColorFactor plus emissiveFactor so the night district stays lit with
no new lights. Geometry is fixed tables only (boxes plus <=12-sided pole
prisms, no timestamps, no randomness), so re-runs are byte-identical.
Kept small (KBs) for repo size and offline headless imports.
"""
import json
import os
import struct

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "city")


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
    import math
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
            "generator": "Night Street Racer tools/make_city_kit.py (CC0 procedural stand-in)",
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


KITS = {
    "building_tower": {
        "boxes": [
            (0.0, 14.0, 0.0, 10.0, 28.0, 10.0),
            (0.0, 29.0, 0.0, 8.0, 2.0, 8.0),
            (0.0, 0.5, 0.0, 12.0, 1.0, 12.0),
        ],
        "prisms": [],
        "base": (0.16, 0.17, 0.24),
        "emissive": (0.55, 0.32, 0.12),
    },
    "building_shop": {
        "boxes": [
            (0.0, 2.5, 0.0, 14.0, 5.0, 10.0),
            (0.0, 4.2, 6.0, 14.5, 0.4, 3.0),
            (0.0, 5.5, 0.0, 14.0, 1.0, 10.0),
        ],
        "prisms": [],
        "base": (0.20, 0.19, 0.24),
        "emissive": (0.15, 0.55, 0.50),
    },
    "streetlamp": {
        "boxes": [
            (0.7, 5.9, 0.0, 1.6, 0.15, 0.15),
            (1.4, 5.8, 0.0, 0.7, 0.25, 0.35),
        ],
        "prisms": [(0.0, 3.0, 0.0, 0.12, 6.0, 8)],
        "base": (0.10, 0.10, 0.12),
        "emissive": (0.80, 0.62, 0.38),
    },
    "neon_sign": {
        "boxes": [
            (0.0, 2.5, 0.0, 0.3, 5.0, 0.3),
            (0.0, 5.0, 0.0, 3.0, 1.2, 0.25),
            (0.0, 5.0, 0.18, 2.6, 0.3, 0.12),
        ],
        "prisms": [],
        "base": (0.05, 0.03, 0.08),
        "emissive": (0.20, 1.00, 0.90),
    },
    "barrier": {
        "boxes": [
            (-1.1, 0.2, 0.0, 0.4, 0.4, 0.8),
            (1.1, 0.2, 0.0, 0.4, 0.4, 0.8),
            (0.0, 0.9, 0.0, 3.0, 0.6, 0.15),
            (0.0, 1.0, 0.0, 3.05, 0.18, 0.16),
        ],
        "prisms": [],
        "base": (0.50, 0.12, 0.05),
        "emissive": (0.85, 0.28, 0.04),
    },
    "street_prop": {
        "boxes": [
            (-0.8, 0.6, 0.0, 1.2, 1.2, 1.2),
            (-1.3, 0.4, 1.6, 2.0, 0.8, 0.8),
            (-1.3, 1.2, 1.6, 1.4, 0.9, 0.6),
        ],
        "prisms": [(1.2, 0.55, 0.4, 0.45, 1.1, 10)],
        "base": (0.20, 0.25, 0.22),
        "emissive": (0.08, 0.28, 0.12),
    },
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name in sorted(KITS):
        spec = KITS[name]
        path = os.path.join(OUT_DIR, name + ".glb")
        _write_glb(path, name, spec["boxes"], spec["prisms"], spec["base"], spec["emissive"])


if __name__ == "__main__":
    main()
