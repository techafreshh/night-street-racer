import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { defineConfig } from "vite";

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
  plugins: [healthPlugin()],
  preview: {
    port: Number(process.env.PORT ?? DEFAULT_PORT),
    host: true,
    strictPort: true,
  },
});
