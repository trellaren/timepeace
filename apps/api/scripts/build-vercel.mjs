/**
 * Builds the API as a single Vercel Function using the Build Output API (.vercel/output).
 *
 * 1. esbuild bundles src/vercel.ts with our workspace packages (@timepeace/*, the generated Prisma
 *    client) compiled in; npm dependencies stay external.
 * 2. @vercel/nft traces which node_modules files the bundle needs at runtime, and those are copied
 *    next to it, so the function contains exactly what was traced.
 * 3. Every route is sent to that one function.
 */
import { nodeFileTrace } from "@vercel/nft";
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const apiDir = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(apiDir, "../..");
const outDir = path.join(apiDir, ".vercel/output");
const funcDir = path.join(outDir, "functions/index.func");
const bundle = path.join(apiDir, "dist/index.mjs");

await rm(path.join(apiDir, "dist"), { recursive: true, force: true });
await rm(outDir, { recursive: true, force: true });

await build({
  entryPoints: [path.join(apiDir, "src/vercel.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: "linked",
  logLevel: "warning",
  // Bundled CommonJS helpers expect these in ESM output.
  banner: {
    js: [
      'import { createRequire as __cr } from "node:module";',
      'import { fileURLToPath as __fu } from "node:url";',
      'import { dirname as __dn } from "node:path";',
      "const require = __cr(import.meta.url);",
      "const __filename = __fu(import.meta.url);",
      "const __dirname = __dn(__filename);",
    ].join("\n"),
  },
  plugins: [
    {
      name: "externalize-npm",
      setup(b) {
        // Bare imports are npm packages (external) unless they are our workspace packages.
        b.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith("@timepeace/") || args.path.startsWith("node:")) return null;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});

const { fileList, warnings } = await nodeFileTrace([bundle], { base: repoRoot });
for (const w of warnings) if (!String(w.message).includes("Failed to resolve dependency")) console.warn("nft:", w.message);

await mkdir(funcDir, { recursive: true });
let count = 0;
for (const rel of fileList) {
  await cp(path.join(repoRoot, rel), path.join(funcDir, rel), { recursive: false, dereference: true, force: true }).catch(async (err) => {
    if (err.code === "ERR_FS_EISDIR" || err.code === "EISDIR") return;
    throw err;
  });
  count++;
}

const handler = path.relative(repoRoot, bundle);
await writeFile(
  path.join(funcDir, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler, launcherType: "Nodejs", shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 60 }, null, 2),
);
await writeFile(path.join(outDir, "config.json"), JSON.stringify({ version: 3, routes: [{ src: "/(.*)", dest: "/index" }] }, null, 2));
console.log(`Built ${path.relative(apiDir, funcDir)}: handler ${handler}, ${count} traced files`);
