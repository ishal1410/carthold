// Loads web/ env the same way `next dev` does, then runs the sandbox authorize spike.
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
await import("../../spike/authorize-flow.ts");
