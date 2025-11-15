import path from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import obfuscatorPlugin from "vite-plugin-javascript-obfuscator";
import {
  obfuscatorOptions,
  terserOptionsLight,
  hashedOutputOptions,
  hashedWorkerOptions,
} from "./vite.config.shared";

// CDN build with content hashing and obfuscation
export default defineConfig({
  plugins: [
    dts({ insertTypesEntry: true, outDir: "lib" }),
    obfuscatorPlugin(obfuscatorOptions),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "postbridge",
      fileName: (format) =>
        format === "iife" ? "[name].[hash].min.js" : "[name].[hash].js",
      formats: ["es", "iife"],
    },
    rollupOptions: {
      external: [],
      output: hashedOutputOptions,
    },
    sourcemap: false,
    emptyOutDir: true,
    minify: "terser",
    terserOptions: terserOptionsLight,
  },
  worker: hashedWorkerOptions,
});

