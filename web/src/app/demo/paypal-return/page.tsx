"use client";
// PayPal's return_url / cancel_url for "Approve with PayPal" holds. PayPal appends token=<order id>. This page holds no
// secrets and calls no API: it hands {run,row,orderId} to the /demo tab that owns the run, which asks the server
// (with its owner token) to authorize. Popup: postMessage to the opener + BroadcastChannel, then close. Same tab
// (popup was blocked): stash the message in sessionStorage and go back to the saved /demo URL.
import { useEffect, useState } from "react";
import { PAYER_BACK_KEY, PAYER_CHANNEL, PAYER_RETURN_KEY, parsePayerReturn } from "./payer";

type View = "working" | "bad" | "done";

export default function PayPalReturn() {
  const [view, setView] = useState<View>("working");
  const [back, setBack] = useState("/demo");
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    const m = parsePayerReturn(window.location.search);
    let next: View = "bad";
    if (m) {
      const demo = `/demo?${new URLSearchParams({ run: m.run })}`;
      // Same-tab fallback: this tab started the run, so it goes back and the demo picks the message up.
      let saved: { run?: string; url?: string } | null = null;
      try {
        saved = JSON.parse(sessionStorage.getItem(PAYER_BACK_KEY) ?? "null");
      } catch {}
      if (saved?.run === m.run) {
        try {
          sessionStorage.removeItem(PAYER_BACK_KEY);
          sessionStorage.setItem(PAYER_RETURN_KEY, JSON.stringify(m));
        } catch {}
        const url = saved.url && new URL(saved.url, window.location.origin).origin === window.location.origin ? saved.url : demo;
        window.location.replace(url);
        return;
      }
      try {
        window.opener?.postMessage(m, window.location.origin);
      } catch {}
      try {
        const ch = new BroadcastChannel(PAYER_CHANNEL);
        ch.postMessage(m);
        ch.close();
      } catch {}
      window.close(); // only works for a script-opened popup; otherwise the message below stays
      next = "done";
      queueMicrotask(() => {
        setBack(demo);
        setCancelled(m.cancelled);
      });
    }
    queueMicrotask(() => setView(next));
  }, []);

  return (
    <main id="main" className="mx-auto flex min-h-[60dvh] w-full max-w-md flex-col justify-center px-4 py-16 text-center text-ink">
      <h1 className="font-display text-2xl font-semibold tracking-tight">
        {view === "bad" ? "This is not a CartHold PayPal return" : cancelled ? "PayPal approval cancelled" : view === "done" ? "Approved in PayPal" : "Returning to CartHold"}
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        {view === "bad"
          ? "The link is missing the run or order details."
          : view === "done"
            ? cancelled
              ? "Nothing was authorized. Go back to the CartHold tab to try again or cancel the payment."
              : "Go back to the CartHold tab: it authorizes the payment, then you release or cancel it."
            : "One moment."}
      </p>
      {view !== "working" && (
        <a href={back} className="mt-6 text-sm text-info underline-offset-4 hover:underline">
          Back to the demo
        </a>
      )}
    </main>
  );
}
