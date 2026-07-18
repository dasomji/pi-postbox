import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@pi-postbox/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url))
    }
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
          exclude: ["apps/web/src/components/QuestionChatActivation.test.ts"],
          environment: "node"
        }
      },
      {
        plugins: [svelte(), svelteTesting({ autoCleanup: false })],
        resolve: {
          alias: {
            "@pi-postbox/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url))
          }
        },
        test: {
          name: "svelte-dom",
          include: ["apps/web/src/components/QuestionChatActivation.test.ts"],
          globals: true,
          environment: "jsdom"
        }
      }
    ]
  }
});
