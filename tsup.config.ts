import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/pdf/index.ts"],
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
