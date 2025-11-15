import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import obfuscatorPlugin from "vite-plugin-javascript-obfuscator";
import { obfuscatorOptions, terserOptionsLight } from "./vite.config.shared";

// This config uses aggressive obfuscation - use only if you need strong code protection
export default defineConfig({
  plugins: [dts({ insertTypesEntry: true, outDir: "lib" }), obfuscatorPlugin(obfuscatorOptions)],
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
    sourcemap: false,
    emptyOutDir: true,
    minify: "terser",
    terserOptions: terserOptionsLight,
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
