import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { defineConfig } from "vitest/config";

// Health payload served on GET /health; single source of truth for the
// contract value asserted by scripts/smoke.mjs and the scenario probes.
export const HEALTH_PAYLOAD = '{"status":"ok"}';

// Default serve port; honors the PORT environment variable so the
// harness can pick an ephemeral port per run.
export const DEFAULT_PORT = 8080;

function sendHealth(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  if (req.method === "GET" && req.url === "/health") {
    res.setHeader("content-type", "application/json");
    res.end(HEALTH_PAYLOAD);
    return;
  }
  next();
}

function healthPlugin(): Plugin {
  return {
    name: "health",
    configureServer(server: ViteDevServer): void {
      server.middlewares.use(sendHealth);
    },
    configurePreviewServer(server: PreviewServer): void {
      server.middlewares.use(sendHealth);
    },
  };
}

export default defineConfig({
  // Portable subpath-or-root serving: Pages project sites mount
  // under /<repo>/ while an unzipped dist.zip is served from /,
  // so every built URL stays document-relative (./assets/...).
  base: "./",
  plugins: [healthPlugin()],
  test: {
    // Playwright specs live beside vitest suites; the default vitest
    // glob would execute *.spec.ts, so pin the include to *.test.ts.
    include: ["tests/**/*.test.ts"],
  },
  build: {
    // Portable static deploy (issue #228): dist/ is the Pages artifact
    // and the zip root, so the out dir is pinned and always emptied.
    // assetsInlineLimit 0 keeps every imported byte as a same-origin
    // file under ./assets (no inline data URIs, no CDN fetch).
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    // Loading-budget ceiling (issue #226): the entry chunk stays lean
    // via code-split screens in main.ts; the two heavy static imports
    // split into vendor chunks. assetsInlineLimit is 0 (see above),
    // which is safe here because the -compat WASM is already
    // base64-embedded same-origin with zero fetch.
    chunkSizeWarningLimit: 15000,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id: string): string | undefined {
          if (id.includes("node_modules/three/")) {
            return "vendor-three";
          }
          if (id.includes("@dimforge/rapier3d-compat")) {
            return "vendor-rapier";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    host: true,
    strictPort: true,
  },
  preview: {
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    host: true,
    strictPort: true,
  },
});
