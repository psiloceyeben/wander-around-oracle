import { defineConfig } from "vite";
import path from "node:path";

// Vite config for the Wander Around frontend.
//
// The engine source lives one level up (../src/). We alias `@engine` to it
// so frontend code imports engine modules without messy relative paths.
//
// Electron wraps the production build (dist/) as a static asset. Dev mode
// runs on port 5173 and is bound 0.0.0.0 so Box C can serve it over the LAN.

export default defineConfig({
  root: path.resolve(__dirname),
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@engine": path.resolve(__dirname, "../src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    target: "es2022",
    minify: "esbuild",
    sourcemap: true,
  },
});
