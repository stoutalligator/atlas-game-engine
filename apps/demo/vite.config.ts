import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Allow the demo to consume the engine from source during dev,
      // falling back to the built package when running standalone.
      "@stoutalligator/engine": resolve(__dirname, "../../packages/engine/src/index.ts"),
    },
  },
});
