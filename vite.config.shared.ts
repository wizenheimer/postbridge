import type { BuildOptions } from "vite";

// Shared Terser configuration for minification
export const terserOptions: BuildOptions["terserOptions"] = {
  compress: {
    drop_console: false,
    drop_debugger: true,
    passes: 3,
    pure_funcs: ["console.debug", "console.trace"],
    inline: 2,
    dead_code: true,
    evaluate: true,
    collapse_vars: true,
    reduce_vars: true,
    join_vars: true,
  },
  mangle: {
    toplevel: true,
    properties: {
      regex: /^_/,
    },
    reserved: ["postbridge", "connect", "close", "remote"],
  },
  format: {
    comments: false,
    ecma: 2020,
    semicolons: false,
  },
};

// Lighter Terser configuration for obfuscated builds (less aggressive since obfuscation does heavy lifting)
export const terserOptionsLight: BuildOptions["terserOptions"] = {
  compress: {
    drop_console: false,
    drop_debugger: true,
    passes: 2,
  },
  mangle: {
    toplevel: true,
    reserved: ["postbridge"],
  },
  format: {
    comments: false,
  },
};

// Shared obfuscator configuration
export const obfuscatorOptions = {
  include: ["src/**/*.ts"],
  exclude: [/node_modules/],
  apply: "build" as const,
  options: {
    stringArray: true,
    stringArrayEncoding: ["base64" as const],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayThreshold: 0.75,

    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,

    identifierNamesGenerator: "hexadecimal" as const,
    identifiersDictionary: [],
    identifiersPrefix: "",
    renameGlobals: false,
    renameProperties: false,
    renamePropertiesMode: "safe" as const,

    selfDefending: true,
    disableConsoleOutput: false,

    domainLock: [],
    domainLockRedirectUrl: "about:blank",

    numbersToExpressions: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,

    debugProtection: false,
    debugProtectionInterval: 0,

    seed: 0,
    target: "browser" as const,
    log: false,
  },
};

// Shared rollup output configuration for content hashing
export const hashedOutputOptions = {
  dir: "lib",
  entryFileNames: "[name].[hash].js",
  chunkFileNames: "[name].[hash].js",
  assetFileNames: "[name].[hash][extname]",
  hashCharacters: "hex" as const,
};

// Shared worker configuration for content hashing
export const hashedWorkerOptions = {
  format: "es" as const,
  rollupOptions: {
    output: {
      entryFileNames: "[name].[hash].js",
      chunkFileNames: "[name].[hash].js",
      hashCharacters: "hex" as const,
    },
  },
};

