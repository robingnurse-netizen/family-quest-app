// Import a TypeScript module from the app in a test (transpiled with the
// project's own `typescript`, no extra tooling). Relative ("./", "../") and
// "@/..." imports are followed and loaded the same way, so modules may share
// small helpers; type-only imports vanish in transpiling. Keep tested
// modules free of React / browser-only imports.
import ts from "typescript";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cache = new Map();

function resolveTs(spec, fromDir) {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : resolve(fromDir, spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  throw new Error(`importTs: can't resolve "${spec}" from ${fromDir}`);
}

/** The module's code as a data: URL, with its local imports rewritten. */
async function toDataUrl(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = (async () => {
    const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    });
    let code = outputText;
    const specs = [...code.matchAll(/\bfrom\s+["']((?:\.{1,2}\/|@\/)[^"']+)["']/g)].map((m) => m[1]);
    for (const spec of new Set(specs)) {
      const url = await toDataUrl(resolveTs(spec, dirname(path)));
      code = code.replaceAll(`"${spec}"`, `"${url}"`).replaceAll(`'${spec}'`, `'${url}'`);
    }
    return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  })();
  cache.set(path, promise);
  return promise;
}

export async function importTs(path) {
  return import(await toDataUrl(path));
}
