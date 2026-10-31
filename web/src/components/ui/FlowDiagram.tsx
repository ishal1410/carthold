"use client";

import { Ban, Bot, Check, CreditCard, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { cx } from "./cx";

export type FlowStep = "agent" | "carthold" | "hold" | "approve" | "reject";

type Hue = "info" | "ink" | "hold" | "paid" | "blocked";

interface NodeSpec {
  title: string;
  sub: string;
  icon: LucideIcon;
  hue: Hue;
}

const NODES: Record<FlowStep, NodeSpec> = {
  agent: { title: "AI agent", sub: "proposes a purchase", icon: Bot, hue: "info" },
  carthold: { title: "CartHold", sub: "policy + page text", icon: ShieldCheck, hue: "ink" },
  hold: { title: "PayPal hold", sub: "authorized, not taken", icon: CreditCard, hue: "hold" },
  approve: { title: "Approve", sub: "capture", icon: Check, hue: "paid" },
  reject: { title: "Reject", sub: "void", icon: Ban, hue: "blocked" },
};

const ORDER: FlowStep[] = ["agent", "carthold", "hold"];
const EDGES: Array<[FlowStep, FlowStep]> = [
  ["agent", "carthold"],
  ["carthold", "hold"],
  ["hold", "approve"],
  ["hold", "reject"],
];

// Autoplay script: one approved purchase, then one rejected.
const SCRIPT: FlowStep[] = ["agent", "carthold", "hold", "approve", "agent", "carthold", "hold", "reject"];

// Main-row nodes are wide enough for the longest mono subtitle ("authorized, not taken");
// the branch nodes carry one-word subtitles and stay narrower so the vertical layout fits side by side.
const W_MAIN = 188;
const W_BRANCH = 148;
const H = 60;
const width = (k: FlowStep) => (k === "approve" || k === "reject" ? W_BRANCH : W_MAIN);

interface Layout {
  viewBox: string;
  pos: Record<FlowStep, { x: number; y: number }>;
}

const HORIZONTAL: Layout = {
  viewBox: "0 0 880 240",
  pos: {
    agent: { x: 100, y: 120 },
    carthold: { x: 330, y: 120 },
    hold: { x: 560, y: 120 },
    approve: { x: 790, y: 52 },
    reject: { x: 790, y: 188 },
  },
};

const VERTICAL: Layout = {
  viewBox: "0 0 340 560",
  pos: {
    agent: { x: 170, y: 44 },
    carthold: { x: 170, y: 176 },
    hold: { x: 170, y: 308 },
    approve: { x: 86, y: 500 },
    reject: { x: 254, y: 500 },
  },
};

const stroke: Record<Hue, string> = {
  info: "stroke-info",
  ink: "stroke-ink",
  hold: "stroke-hold",
  paid: "stroke-paid",
  blocked: "stroke-blocked",
};
const fillSoft: Record<Hue, string> = {
  info: "fill-info-soft",
  ink: "fill-surface-3",
  hold: "fill-hold-soft",
  paid: "fill-paid-soft",
  blocked: "fill-blocked-soft",
};
const text: Record<Hue, string> = {
  info: "text-info",
  ink: "text-ink",
  hold: "text-hold",
  paid: "text-paid",
  blocked: "text-blocked",
};

/** Which nodes have been reached when the flow is at `step`. */
function reached(step: FlowStep | null): Set<FlowStep> {
  if (!step) return new Set();
  if (step === "approve" || step === "reject") return new Set<FlowStep>([...ORDER, step]);
  return new Set(ORDER.slice(0, ORDER.indexOf(step) + 1));
}

export interface FlowDiagramProps {
  /** Controlled step. Ignored while `autoplay` runs. null = nothing lit. */
  step?: FlowStep | null;
  /** Loop the approve-then-reject story (landing page). Off under reduced motion. */
  autoplay?: boolean;
  /** Milliseconds per autoplay step. */
  interval?: number;
  className?: string;
}

/** Agent → CartHold → PayPal hold → Approve / Reject. Horizontal from md, vertical below. */
export function FlowDiagram({ step = null, autoplay = false, interval = 1100, className }: FlowDiagramProps) {
  const reduce = useReducedMotion();
  const playing = autoplay && !reduce;
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTick((t) => (t + 1) % SCRIPT.length), interval);
    return () => window.clearInterval(id);
  }, [playing, interval]);

  // Reduced-motion autoplay shows the whole story at rest: held, waiting on a human.
  const current: FlowStep | null = playing ? SCRIPT[tick] : autoplay ? "hold" : step;
  const label =
    "Flow: the AI agent proposes a purchase, CartHold checks policy and page text, PayPal holds the authorization, then a human approves (capture) or rejects (void).";

  return (
    <div className={cx("w-full", className)} role="img" aria-label={label}>
      <Diagram layout={HORIZONTAL} current={current} reduce={Boolean(reduce)} className="hidden md:block" />
      <Diagram layout={VERTICAL} current={current} reduce={Boolean(reduce)} className="mx-auto max-w-xs md:hidden" />
    </div>
  );
}

function Diagram({
  layout,
  current,
  reduce,
  className,
}: {
  layout: Layout;
  current: FlowStep | null;
  reduce: boolean;
  className?: string;
}) {
  const lit = reached(current);
  const { pos } = layout;
  const packet = current ? pos[current] : null;
  const snap = { duration: reduce ? 0 : 0.56, ease: [0.32, 0.72, 0, 1] as const };

  return (
    <svg viewBox={layout.viewBox} className={cx("h-auto w-full overflow-visible", className)} aria-hidden>
      {EDGES.map(([a, b]) => {
        const on = lit.has(a) && lit.has(b);
        const hue = NODES[b].hue;
        return (
          <g key={`${a}-${b}`}>
            <line
              x1={pos[a].x}
              y1={pos[a].y}
              x2={pos[b].x}
              y2={pos[b].y}
              className="stroke-line-strong"
              strokeWidth={1.5}
              strokeDasharray="3 5"
            />
            <motion.line
              x1={pos[a].x}
              y1={pos[a].y}
              x2={pos[b].x}
              y2={pos[b].y}
              className={stroke[hue === "ink" ? "hold" : hue]}
              strokeWidth={2}
              strokeLinecap="round"
              initial={false}
              animate={{ pathLength: on ? 1 : 0, opacity: on ? 1 : 0 }}
              transition={snap}
            />
          </g>
        );
      })}

      {(Object.keys(NODES) as FlowStep[]).map((key) => {
        const node = NODES[key];
        const on = lit.has(key);
        const active = key === current;
        const { x, y } = pos[key];
        const Icon = node.icon;
        const W = width(key);
        return (
          <g key={key} transform={`translate(${x - W / 2} ${y - H / 2})`}>
            {/* Opaque backing so connector lines never show through the translucent tint. */}
            <rect width={W} height={H} rx={14} className="fill-canvas" />
            <motion.rect
              width={W}
              height={H}
              rx={14}
              className={cx(on ? fillSoft[node.hue] : "fill-surface-2", on ? stroke[node.hue] : "stroke-line-strong")}
              strokeWidth={active ? 1.75 : 1}
              initial={false}
              animate={{ scale: active && !reduce ? [1, 1.04, 1] : 1 }}
              transition={{ duration: 0.48, ease: [0.32, 0.72, 0, 1] }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            />
            <Icon
              x={14}
              y={H / 2 - 10}
              width={20}
              height={20}
              strokeWidth={1.5}
              className={on ? text[node.hue] : "text-ink-faint"}
            />
            <text x={44} y={H / 2 - 3} className={cx("font-display text-[15px] font-semibold", on ? "fill-ink" : "fill-ink-muted")}>
              {node.title}
            </text>
            <text x={44} y={H / 2 + 14} className="fill-ink-faint font-mono text-[10.5px]">
              {node.sub}
            </text>
          </g>
        );
      })}

      {packet && (
        <motion.circle
          r={5}
          className={cx(current ? fillDot[NODES[current].hue] : "fill-hold")}
          initial={false}
          animate={{ cx: packet.x, cy: packet.y - H / 2 }}
          transition={snap}
        />
      )}
    </svg>
  );
}

const fillDot: Record<Hue, string> = {
  info: "fill-info",
  ink: "fill-hold",
  hold: "fill-hold",
  paid: "fill-paid",
  blocked: "fill-blocked",
};
