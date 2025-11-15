import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [dts({ insertTypesEntry: true, outDir: "lib" })],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "postbridge",
      fileName: (format) => (format === "iife" ? "postbridge.min.js" : "postbridge.js"),
      formats: ["es", "iife"],
    },
    rollupOptions: {
      external: [],
      output: {
        dir: "lib",
      },
    },
    sourcemap: true,
    emptyOutDir: true,
  },
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "bridge-worker.js",
      },
    },
  },
});
