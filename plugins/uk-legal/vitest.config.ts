import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The source uses NodeNext `.js` import specifiers that actually point at `.ts`
 * files (e.g. `import ... from "./parsers.js"`). Vite's resolver does not remap
 * those to `.ts` on its own, so this pre-resolver does it for relative imports
 * when a sibling `.ts` exists. Package imports (node_modules `.js`) are untouched.
 */
const jsToTsResolver = {
  name: "js-to-ts-relative-resolver",
  enforce: "pre" as const,
  resolveId(source: string, importer: string | undefined) {
    if (importer && source.startsWith(".") && source.endsWith(".js")) {
      const candidate = resolvePath(dirname(importer), source.slice(0, -3) + ".ts");
      if (existsSync(candidate)) return candidate;
    }
    return null;
  },
};

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [jsToTsResolver],
  test: {
    root,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      // models.ts files are type-only (interfaces/types) — no runtime code.
      // server.ts's auto-start guard is exercised via the built binary (verify).
      exclude: ["src/**/models.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // Lines/statements/functions run ~98-100%. Branches sit ~88%: the residual
      // is defensive/unreachable fallbacks (e.g. xmldom throwing before our own
      // error-wrapper, `?? null` guards on always-present upstream fields). The
      // gate guards against regression without demanding coverage of dead branches.
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 85,
      },
    },
  },
});
