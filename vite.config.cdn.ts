import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { terserOptions, hashedOutputOptions, hashedWorkerOptions } from "./vite.config.shared";

// CDN build with content hashing for cache busting
export default defineConfig({
  plugins: [dts({ insertTypesEntry: true, outDir: "lib" })],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "postbridge",
      fileName: (format) => (format === "iife" ? "[name].[hash].min.js" : "[name].[hash].js"),
      formats: ["es", "iife"],
    },
    rollupOptions: {
      external: [],
      output: hashedOutputOptions,
    },
    sourcemap: true,
    emptyOutDir: true,
    minify: "terser",
    terserOptions,
  },
  worker: hashedWorkerOptions,
});
