import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Uses the engine straight from source so edits hot-reload.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@stoutalligator\/engine\/server$/,
        replacement: resolve(__dirname, "../../packages/engine/src/server-entry.ts"),
      },
      {
        find: /^@stoutalligator\/engine$/,
        replacement: resolve(__dirname, "../../packages/engine/src/index.ts"),
      },
    ],
  },
});
