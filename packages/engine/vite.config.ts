import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    react(),
    dts({
      include: ["src"],
      exclude: ["src/**/__tests__/**"],
      outDir: "dist",
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        catalog: resolve(__dirname, "src/catalog-entry.ts"),
        server: resolve(__dirname, "src/server-entry.ts"),
      },
      formats: ["es", "cjs"],
      fileName: (format, entry) => `${entry}.${format === "es" ? "js" : "cjs"}`,
      cssFileName: "styles",
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react-dom"],
      output: {
        // The main entry is all client components; the catalog and server
        // entries stay server-safe.
        banner: (chunk) => (chunk.isEntry && chunk.name === "index" ? '"use client";' : ""),
      },
    },
  },
});
