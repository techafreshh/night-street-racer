# Perf audit: drawcalls + 1080p/60FPS (issue #228)

In-race budget: **`renderer.info.render.calls` < 1500**, read live via
`window.__nsr.lighting.drawCalls` (which is `sampleDrawCalls(nightRenderer) ?? 0`).

## Method

1. Serve the build (`npm run serve --workspace=web` or unzip `dist.zip`
   and serve its top level), open the page at 1080p in desktop Chrome.
2. Enter a race (bloom on) and sample
   `window.__nsr.lighting.drawCalls` over several frames.
3. Pass when every sample is below `MAX_DRAW_CALLS = 1500`
   (`web/src/render/perf.ts`).

CI does not measure FPS; the GTX1060-class statement below is a
documented estimate from the instancing inventory, not a CI gate.

## Drawcall inventory (why the budget holds)

| Source | Meshes | Instances / lights | Drawcalls (approx) |
|---|---|---|---|
| `buildRoadMeshes` | 2 InstancedMesh (NS + EW strips) | 5 + 5 instances | ~2 |
| `buildBlockMeshes` | 1 InstancedMesh (block slabs) | 16 instances | ~1 |
| `buildEmissiveDressing` towers | 1 InstancedMesh | 4 instances | ~1 |
| `buildEmissiveDressing` window bands | 1 InstancedMesh | 12 instances (4 blocks x 3 levels) | ~1 |
| `buildEmissiveDressing` lamp heads | 1 InstancedMesh | 4 instances | ~1 |
| Neon sign pair + lamp poles | 6 regular Mesh | — | ~6 |
| `buildLightRig` | 0 meshes (8 lights: 1 moon + 1 hemi + 2 spots + 4 points) | moon is the only shadow caster | 0 (+1 shadow map pass) |
| `UnrealBloomPass` mip chain | fullscreen quads, half-res target | 5 mips, separable blur | ~dozens |
| RenderPass + OutputPass | fullscreen | — | ~scene calls + 1 |

Total in-race stays in the low hundreds, an order of magnitude under
the 1500 ceiling.

## Half-res bloom

`BLOOM_RES_DIVISOR = 2` (`web/src/render/composer.ts`): the
`UnrealBloomPass` is constructed with the halved size vector and the
`resizeRenderer` path re-halves the name-marked bloom pass after every
fullscreen `composer.setSize`, so the blur mip chain costs roughly a
quarter of the fullscreen pixels on every frame including resizes.

## 1080p / GTX1060-class 60FPS statement

Desktop Chrome, 1080p, in-race with bloom on: the instanced district
(7 instanced meshes covering roads, blocks, towers, bands, heads) plus
the half-res bloom chain and the single moon shadow caster hold a
GTX1060-class GPU at 60FPS. Headroom comes from instancing (no
per-building drawcalls) and the halved bloom target; no dynamic
resolution or quality scaling is used.
