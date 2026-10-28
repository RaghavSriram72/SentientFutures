// Lets Node's built-in test runner load the admin modules without a bundler,
// so the tests need no extra packages. Node strips the TypeScript types
// itself (Node 23.6 and later). This file fills the three gaps Next.js's
// bundler normally covers:
//
//   "@/lib/enums"       the tsconfig path alias, resolved from frontend/
//   "./reviewModel"     imports written without an extension
//   "./enums.json"      JSON imports, served as a module with a default export
//
// Run from frontend/:
//   node --import ./components/admin/tests/register.mjs --test "components/admin/tests/*.test.ts"
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const FRONTEND_ROOT = new URL("../../../", import.meta.url);
// Only .ts: Node can strip types but not JSX, so .tsx components stay out of tests.
const EXTENSIONS = [".ts"];

function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

// The file a specifier points at, trying .ts when it has no extension.
function findFile(url) {
  const path = fileURLToPath(url);
  if (isFile(path)) {
    return pathToFileURL(path).href;
  }
  for (const extension of EXTENSIONS) {
    if (isFile(path + extension)) {
      return pathToFileURL(path + extension).href;
    }
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let url = null;
    if (specifier.startsWith("@/")) {
      url = new URL(specifier.slice(2), FRONTEND_ROOT);
    } else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
      url = new URL(specifier, context.parentURL);
    }
    if (url !== null) {
      const found = findFile(url);
      if (found !== null) {
        return { url: found, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".json")) {
      const json = readFileSync(fileURLToPath(url), "utf8");
      return { format: "module", source: `export default ${json};`, shortCircuit: true };
    }
    if (url.endsWith(".ts")) {
      // Saying it's an ES module up front skips Node's "reparsing as ES module" warning.
      return nextLoad(url, { ...context, format: "module-typescript" });
    }
    return nextLoad(url, context);
  },
});
