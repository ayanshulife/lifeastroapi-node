import { defineConfig } from "tsup";

export default defineConfig({
  // Named entries: dist/index, dist/pdf/index, dist/pdf-html (the React Native / browser-safe HTML renderers).
  entry: { index: "src/index.ts", "pdf/index": "src/pdf/index.ts", "pdf-html": "src/pdf/html.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "node18",
  // puppeteer is an optional peer dependency, loaded dynamically — never bundle it.
  external: ["puppeteer"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
