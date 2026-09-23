// Import a TypeScript module from the app in a test (transpiled with the
// project's own `typescript`, no extra tooling). Only for self-contained
// modules without "@/..." imports.
import ts from "typescript";
import { readFileSync } from "node:fs";

export async function importTs(path) {
  const source = readFileSync(path, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
