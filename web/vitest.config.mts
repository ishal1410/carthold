import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same "@/" alias as tsconfig paths, so component tests can import UI modules.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // ponytail: parallel test files intermittently load backstop.ts with no exports
    // (looks like a vitest 4.0.5 on-disk transform-cache race on Windows). Suite runs in ~2s
    // serially; re-enable parallelism after a vitest upgrade if it stays green 10x in a row.
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
