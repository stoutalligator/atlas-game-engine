import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "serve-nonogram",
      configureServer(server) {
        const nonogramDir = resolve(__dirname, "../../packages/engine/src/games/nonogram");
        server.middlewares.use("/nonogram", (_req, res) => {
          const puzzles = readFileSync(resolve(nonogramDir, "puzzles.js"), "utf-8");
          const html = readFileSync(resolve(nonogramDir, "index.html"), "utf-8");
          const inlined = html.replace(
            '<script src="puzzles.js"></script>',
            `<script>${puzzles}</script>`,
          );
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(inlined);
        });
      },
    },
  ],
  resolve: {
    alias: {
      // Allow the demo to consume the engine from source during dev,
      // falling back to the built package when running standalone.
      "@stoutalligator/engine": resolve(__dirname, "../../packages/engine/src/index.ts"),
    },
  },
});
