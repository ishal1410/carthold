// SIGTERM (Render redeploy / spin-down): void held PayPal authorizations, then exit. render.yaml sets
// NEXT_MANUAL_SIG_HANDLE=1, so Next skips its own exit (next/dist/server/lib/start-server.js) and this owns it.
// session.ts publishes the sweep on globalThis when it loads; if it never loaded there are no runs to void.
// ponytail: crash / SIGKILL skips this; the next process voids such orphans on its first run (session.ts kickOrphanSweep,
// via PayPal webhook-event history), and PayPal's own authorization expiry is the last backstop.
export function registerSigterm() {
  const g = globalThis as unknown as { __cartholdSigterm?: boolean; __cartholdVoidAll?: () => Promise<unknown> };
  if (g.__cartholdSigterm) return;
  g.__cartholdSigterm = true;
  process.once("SIGTERM", () => {
    // Logged so Render's log shows whether shutdown ran at all (2026-10-31: two live holds survived a deploy).
    console.error("[carthold] SIGTERM: voiding held authorizations before exit");
    void Promise.resolve()
      .then(() => g.__cartholdVoidAll?.())
      .then((r) => console.error("[carthold] SIGTERM sweep done:", JSON.stringify(r ?? null)), (e) => console.error("[carthold] SIGTERM sweep failed:", e))
      .finally(() => process.exit(143));
  });
}
