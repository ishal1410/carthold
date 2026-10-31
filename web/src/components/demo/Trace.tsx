"use client";
import { FileText, ListChecks, ShoppingCart, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { AgentEvent } from "@/lib/agent/agent";
import type { DecisionRow } from "@/lib/guard/guard";
import { StatusPill, StreamItem, cx, type Tone } from "@/components/ui";
import { headline, plainReason, reasonTags, refusedText } from "./reasons";
import { Tags, usd } from "./Verdicts";

type Phase = "idle" | "starting" | "running" | "done" | "error";

const TOOL: Record<string, { label: string; icon: LucideIcon }> = {
  list_stores: { label: "Listed stores", icon: ListChecks },
  read_store_page: { label: "Read store page", icon: FileText },
  propose_order: { label: "Proposed a payment", icon: ShoppingCart },
};

function summarizeArgs(name: string, args: Record<string, unknown>) {
  if (name === "read_store_page") return String(args.slug ?? "");
  if (name === "propose_order") {
    const items = Array.isArray(args.items) ? (args.items as { name?: string; quantity?: number; unitPriceUsd?: number }[]) : [];
    return `${args.merchant ?? "?"}: ${items.map((i) => `${i.quantity} x ${i.name} @ $${i.unitPriceUsd}`).join(", ")}`;
  }
  return "";
}

/** Hold outcomes that happened after the agent's last word, so its final text is never left stale. */
function holdUpdates(rows: DecisionRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.verdict !== "hold") continue;
    const what = `the ${usd(r.amountUsd)} hold at ${r.merchant}`;
    if (r.reasons.includes("rejected by user")) out.push(`You rejected ${what}. Authorization voided, nothing was charged.`);
    else if (r.reasons.some((x) => /^auto-voided/.test(x))) out.push(`${what.charAt(0).toUpperCase()}${what.slice(1)} timed out. Authorization voided, nothing was charged.`);
    else if (r.status === "captured") out.push(`You approved ${what}. PayPal captured it.`);
    else if (r.status === "error" || r.status === "unknown")
      out.push(`${what.charAt(0).toUpperCase()}${what.slice(1)} did not settle cleanly (${r.status === "unknown" ? "PayPal outcome unclear" : "PayPal error"}). Check the decision log.`);
  }
  return out;
}

/** The guard's answer to one propose_order, as a pill plus the few words that matter. */
function GuardResult({ result, rows }: { result: string; rows: DecisionRow[] }) {
  if (result.startsWith("REFUSED")) {
    const row = rows.find((r) => `REFUSED by CartHold: ${r.reasons.join("; ")}` === result);
    const lead = row ? plainReason(headline(row.reasons)) : "Refused by CartHold";
    const tags = row ? reasonTags(row.reasons) : [];
    return (
      <div className="mt-2 space-y-2">
        <p className="flex flex-wrap items-center gap-2">
          <StatusPill status="block" label="Refused" size="sm" />
          <span className="text-sm text-ink">{lead}</span>
        </p>
        <Tags tags={tags.filter((t) => t !== "followed hidden text" || !/^Followed/.test(lead))} />
        <details className="text-xs">
          <summary className="w-max cursor-pointer text-ink-faint hover:text-ink">What the agent was told</summary>
          <p className="figures mt-1.5 rounded-sm bg-surface-2 p-2.5 text-2xs leading-relaxed whitespace-pre-wrap text-ink-muted [overflow-wrap:anywhere]">
            {refusedText(result, rows)}
          </p>
        </details>
      </div>
    );
  }
  const [status, label] = result.startsWith("HELD")
    ? (["hold", "Held for you"] as const)
    : result.startsWith("Paid")
      ? (["captured", "Paid"] as const)
      : (["unknown", "Unclear"] as const);
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2">
      <StatusPill status={status} label={label} size="sm" />
      {status === "unknown" && <span className="text-xs text-ink-muted [overflow-wrap:anywhere]">{result}</span>}
    </p>
  );
}

export function Trace({ events, phase, mode, rows, className }: { events: AgentEvent[]; phase: Phase; mode: "live" | "redteam"; rows: DecisionRow[]; className?: string }) {
  const done = events.find((e) => e.type === "done") as Extract<AgentEvent, { type: "done" }> | undefined;
  const updates = done ? holdUpdates(rows) : [];
  const last = events.at(-1);
  const announce =
    !last ? "" : last.type === "tool_call" ? `Agent calls ${last.name}` : last.type === "tool_result" && last.name === "propose_order" ? refusedText(last.result, rows) : last.type === "done" ? "Agent finished" : "";

  // Events present on first paint (a replay or the recording) stagger in; later live events land at once.
  const [batch, setBatch] = useState(0);
  if (events.length && !batch) setBatch(events.length);
  if (!events.length && batch) setBatch(0);
  const idx = (i: number) => (i < batch ? i : 0);

  // Keep the newest event in view if the list scrolls, unless the reader scrolled up.
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, updates.length]);

  // Results render under their call, so only calls, model text and steps become rows.
  const items: { e: AgentEvent; result?: Extract<AgentEvent, { type: "tool_result" }>; i: number }[] = [];
  events.forEach((e, i) => {
    if (e.type === "tool_result") {
      const call = [...items].reverse().find((x) => x.e.type === "tool_call" && x.e.name === e.name && !x.result);
      if (call) call.result = e;
      else items.push({ e, i });
    } else if (e.type === "tool_call" || e.type === "model_text") items.push({ e, i });
  });

  return (
    <section aria-labelledby="trace-h" className={cx("flex min-h-0 flex-col", className)}>
      <div className="flex items-baseline justify-between gap-3 pb-3">
        <h2 id="trace-h" className="font-display text-xl font-semibold tracking-tight">
          Agent trace
        </h2>
        <span className="text-xs text-ink-faint">{mode === "redteam" ? "Simulated compromised agent" : "Live Gemini agent"}</span>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      {!events.length ? (
        <div className="space-y-3 rounded-lg border border-line p-5">
          {phase === "starting" || phase === "running" ? (
            <>
              <p className="text-sm text-ink-muted">Starting the agent</p>
              {[70, 50, 85].map((w) => (
                <div key={w} className="h-3 animate-shimmer rounded-xs bg-surface-2" style={{ width: `${w}%` }} />
              ))}
            </>
          ) : (
            <p className="text-sm text-ink-faint">Each step the agent takes shows up here.</p>
          )}
        </div>
      ) : (
        <ol
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="relative min-h-0 flex-1 overflow-y-auto pr-1 before:absolute before:top-4 before:bottom-4 before:left-[3px] before:w-px before:bg-line"
        >
          {items.map(({ e, result, i }) => {
            if (e.type === "model_text")
              return (
                <StreamItem key={i} index={idx(i)} tone="neutral" time={`step ${e.step}`} title={<span className="font-normal text-ink-muted">{e.text}</span>} className="[&>span>span]:bg-line-strong" />
              );
            if (e.type === "tool_call") {
              const t = TOOL[e.name] ?? { label: e.name, icon: Wrench };
              const order = e.name === "propose_order";
              const waiting = !done && order && !result;
              const tone: Tone = !order ? "info" : !result ? "hold" : result.result.startsWith("REFUSED") ? "blocked" : result.result.startsWith("HELD") ? "hold" : result.result.startsWith("Paid") ? "paid" : "warning";
              const arg = summarizeArgs(e.name, e.args);
              return (
                <StreamItem
                  key={i}
                  index={idx(i)}
                  tone={tone}
                  title={
                    <span className="inline-flex items-center gap-1.5 text-ink">
                      <t.icon aria-hidden strokeWidth={1.5} className="size-3.5 text-ink-faint" />
                      {t.label}
                    </span>
                  }
                >
                  {arg && <span className={cx("figures text-xs [overflow-wrap:anywhere]", order ? "text-ink" : "text-ink-muted")}>{arg}</span>}
                  {waiting && <span className="mt-1 block animate-shimmer text-xs text-hold">CartHold is checking this payment</span>}
                  {result && order && <GuardResult result={result.result} rows={rows} />}
                  {result && !order && (
                    <details className="mt-1 text-xs">
                      <summary className="w-max cursor-pointer text-ink-faint hover:text-ink">Show result ({result.result.length.toLocaleString()} chars)</summary>
                      <pre className="figures mt-1.5 max-h-48 overflow-auto rounded-sm bg-surface-2 p-2.5 text-2xs whitespace-pre-wrap text-ink-muted">{result.result}</pre>
                    </details>
                  )}
                </StreamItem>
              );
            }
            return (
              <StreamItem key={i} index={idx(i)} tone="neutral" title={e.type === "tool_result" ? `Result from ${e.name}` : ""}>
                {e.type === "tool_result" && <GuardResult result={e.result} rows={rows} />}
              </StreamItem>
            );
          })}
          {!done && phase === "running" && events.length > 0 && last?.type === "step" && (
            <li className="py-2.5 pl-5 text-xs text-ink-faint">
              <span className="animate-shimmer">Thinking</span>
            </li>
          )}
          {done && (
            <StreamItem
              index={idx(events.length - 1)}
              tone={done.reason === "error" ? "warning" : "neutral"}
              title={done.reason === "error" ? "Agent stopped" : done.reason === "max_steps" ? "Agent hit its step limit" : "Agent finished"}
            >
              {done.reason === "error" ? done.error : done.reason === "final_answer" ? done.text : null}
              {updates.map((u) => (
                <span key={u} className="mt-2 block rounded-sm border border-line bg-surface-2 px-3 py-2 text-ink">
                  {u}
                </span>
              ))}
            </StreamItem>
          )}
        </ol>
      )}
    </section>
  );
}
