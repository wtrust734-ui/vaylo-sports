import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { webcrypto } from "node:crypto";

/** Execute edge modules locally without importing Deno's remote dependencies. */
export function edgeHarness(dependencies: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const cache = new Map<string, Record<string, unknown>>();
  function load<T>(file: string): T {
    const path = resolve(file);
    if (cache.has(path)) return cache.get(path) as T;
    const exports = {};
    cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, {
      exports, console, Request, Response, TextEncoder, TextDecoder, crypto: webcrypto,
      Deno: { env: { get: () => "synthetic" } }, ...globals,
      require: (specifier: string) => {
        if (specifier in dependencies) return dependencies[specifier];
        if (specifier.startsWith(".")) return load(resolve(dirname(path), specifier));
        throw new Error(`Unmocked edge dependency: ${specifier}`);
      },
    }, { filename: path });
    return exports as T;
  }
  return { load };
}
