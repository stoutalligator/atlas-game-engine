import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Uses the engine straight from source so edits hot-reload.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@stoutalligator/engine": resolve(__dirname, "../../packages/engine/src/index.ts"),
    },
  },
});
