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
          exclude: [
            "apps/web/src/App.test.ts",
            "apps/web/src/components/QuestionChatActivation.test.ts",
            "apps/web/src/components/QuestionWorkspace.test.ts"
          ],
          environment: "node"
        }
      },
      {
        plugins: [svelte(), svelteTesting({ autoCleanup: false })],
        define: {
          __APP_VERSION__: JSON.stringify("test")
        },
        resolve: {
          alias: {
            "@pi-postbox/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url))
          }
        },
        test: {
          name: "svelte-dom",
          include: [
            "apps/web/src/App.test.ts",
            "apps/web/src/components/QuestionChatActivation.test.ts",
            "apps/web/src/components/QuestionWorkspace.test.ts"
          ],
          globals: true,
          environment: "jsdom"
        }
      }
    ]
  }
});
