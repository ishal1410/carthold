// SIGTERM (Render redeploy / spin-down): void held PayPal authorizations, then exit. render.yaml sets
// NEXT_MANUAL_SIG_HANDLE=1, so Next skips its own exit (next/dist/server/lib/start-server.js) and this owns it.
// session.ts publishes the sweep on globalThis when it loads; if it never loaded there are no runs to void.
// ponytail: crash / SIGKILL still orphans holds (PayPal's auth expiry is the backstop); persisted holds are the fix.
export function registerSigterm() {
  const g = globalThis as unknown as { __cartholdSigterm?: boolean; __cartholdVoidAll?: () => Promise<unknown> };
  if (g.__cartholdSigterm) return;
  g.__cartholdSigterm = true;
  process.once("SIGTERM", () => {
    void Promise.resolve().then(() => g.__cartholdVoidAll?.()).catch(() => {}).finally(() => process.exit(143));
  });
}
