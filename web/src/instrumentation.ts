// Node-only code lives in instrumentation-node.ts so the Edge compile of this file never sees process APIs.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./instrumentation-node")).registerSigterm();
}
