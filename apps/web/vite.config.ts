import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

// `npm run dev` (scripts/dev.mjs) sets POSTBOX_DEV_API_PORT to the backend port it
// picked; default to 3000 for a standalone `vite` run.
const backend = `http://127.0.0.1:${process.env.POSTBOX_DEV_API_PORT ?? "3000"}`;
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8")) as {
  version: string;
};

// When exposed through `lizardtail postbox --dev`, lizardtail injects the
// Tailscale DNS name(s) here so Vite's dev-server host check allows them.
const allowedHosts = (process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  plugins: [svelte()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    // Fixed port so `lizardtail postbox --dev` can deterministically expose it;
    // fail loudly rather than silently drifting to another port.
    port: 5173,
    strictPort: true,
    allowedHosts,
    proxy: {
      "/healthz": backend,
      "/api": {
        target: backend,
        changeOrigin: true,
        // The backend rejects state-changing requests whose Origin does not match
        // its Host. changeOrigin rewrites Host but not Origin, so strip Origin for
        // the proxied dev requests; no-Origin requests pass the backend's check.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.removeHeader("origin"));
        }
      }
    }
  }
});
