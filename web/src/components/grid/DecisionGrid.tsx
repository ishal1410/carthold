"use client";

import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams, type RowClassRules, type RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DecisionRow } from "../../lib/guard/guard";
import { filterDecisions, formatCountdown, formatTime, formatUsd, newestFirst, statusLabel, VERDICT_CLASS } from "./format";
import { headline } from "../demo/reasons";
import { gridTheme } from "./theme";
import "./grid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

export type DecisionGridProps = {
  rows: DecisionRow[];
  onSelect?: (row: DecisionRow) => void;
  height?: number;
  /** Rows came from the scripted compromised-agent replay, not a live model. */
  simulated?: boolean;
};

// Renderers only read `data`, so the phone card list can reuse them with a bare row.
type Cell = Pick<ICellRendererParams<DecisionRow>, "data">;

function VerdictPill({ data }: Cell) {
  if (!data) return null;
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide ring-1 ring-inset ${VERDICT_CLASS[data.verdict]}`}>
      {data.verdict}
    </span>
  );
}

function CopyId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  return (
    <button
      type="button"
      data-copy
      title={`Copy ${label} id ${value}`}
      onClick={copy}
      className="block max-w-full truncate text-left font-mono text-xs text-zinc-400 hover:text-emerald-300 focus-visible:text-emerald-300 focus-visible:outline-none"
    >
      <span className="text-zinc-600">{label} </span>
      {copied ? "copied" : value}
    </button>
  );
}

function PayPalIds({ data }: Cell) {
  if (!data) return null;
  const ids: [string, string | undefined][] = [
    ["order", data.paypalOrderId],
    ["auth", data.authorizationId],
    ["capture", data.captureId],
  ];
  const present = ids.filter((e): e is [string, string] => !!e[1]);
  if (!present.length) return <span className="text-zinc-600">—</span>;
  return (
    <div className="flex flex-col gap-0.5 py-1 leading-tight">
      {present.map(([l, v]) => (
        <CopyId key={l} label={l} value={v} />
      ))}
    </div>
  );
}

function Countdown({ data }: Cell) {
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = data?.status === "held" ? data.expiresAt : undefined;
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return <span className="text-zinc-600">—</span>;
  const left = Date.parse(expiresAt) - now;
  return (
    <span className={`font-mono tabular-nums ${left < 30_000 ? "text-red-300" : "text-amber-300"}`}>{formatCountdown(left)}</span>
  );
}

const columnDefs: ColDef<DecisionRow>[] = [
  { field: "time", headerName: "Time", width: 96, valueFormatter: (p) => (p.value ? formatTime(p.value) : ""), cellClass: "font-mono tabular-nums" },
  { field: "merchant", headerName: "Merchant", width: 170, filter: "agTextColumnFilter" },
  { field: "items", headerName: "Items", flex: 1, minWidth: 180, tooltipField: "items" },
  {
    field: "amountUsd", headerName: "Amount", width: 108, type: "rightAligned",
    valueFormatter: (p) => (p.value == null ? "" : formatUsd(p.value)), cellClass: "font-mono tabular-nums",
    filter: "agNumberColumnFilter",
  },
  { field: "verdict", headerName: "Verdict", width: 100, cellRenderer: VerdictPill },
  {
    field: "status", headerName: "Status", width: 120, filter: "agTextColumnFilter", enableCellChangeFlash: true,
    valueFormatter: (p) => (p.value ? statusLabel(p.value) : ""),
    // Filter on the label the user sees ("Paid"), not the raw enum ("captured").
    filterValueGetter: (p) => (p.data ? statusLabel(p.data.status) : ""),
  },
  {
    // One line per row: a single block lists 7+ reasons, which blew rows up to ~400px. Full list is in the tooltip and the reveal panel.
    field: "reasons", headerName: "Reasons", flex: 2, minWidth: 220,
    valueFormatter: (p) => {
      const r: string[] = p.value ?? [];
      // Lead with the reason that decided it, never a non-blocking "warning:".
      return r.length > 1 ? `${headline(r)} (+${r.length - 1} more)` : (r[0] ?? "");
    },
    tooltipValueGetter: (p) => (p.data?.reasons ?? []).join("\n"),
    cellClass: "leading-snug py-1",
  },
  {
    colId: "paypal", headerName: "PayPal ids", width: 220, autoHeight: true, sortable: false, cellRenderer: PayPalIds,
    // Only used by CSV export; the cell itself renders PayPalIds.
    valueGetter: (p) => [p.data?.paypalOrderId, p.data?.authorizationId, p.data?.captureId].filter(Boolean).join(" "),
  },
  { field: "expiresAt", headerName: "Expires", width: 92, sortable: false, cellRenderer: Countdown },
];

const modeCol: ColDef<DecisionRow> = {
  colId: "mode", headerName: "Mode", width: 112, sortable: false,
  valueGetter: () => "Simulated",
  cellRenderer: () => (
    <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium text-amber-200 ring-1 ring-inset ring-amber-400/40">Simulated</span>
  ),
};

// Unknown future statuses get no class (and render their raw name via statusLabel).
const st = (p: { data?: DecisionRow }): string => p.data?.status ?? "";
const rowClassRules: RowClassRules<DecisionRow> = {
  "ag-st-pending": (p) => st(p) === "pending",
  "ag-st-blocked": (p) => st(p) === "blocked",
  "ag-st-held": (p) => st(p) === "held",
  "ag-st-captured": (p) => st(p) === "captured",
  "ag-st-error": (p) => st(p) === "error" || st(p) === "unknown",
};

// Up to this many rows the grid sizes to its content (no empty band); beyond it, fixed height + inner scroll.
const AUTO_HEIGHT_MAX = 10;

function DecisionCard({ row, simulated, onSelect }: { row: DecisionRow; simulated: boolean; onSelect?: (row: DecisionRow) => void }) {
  const lead = headline(row.reasons);
  return (
    <li className={`ag-st-${row.status === "unknown" ? "error" : row.status} rounded-lg border border-zinc-800 bg-zinc-900/60 text-sm`}>
      <button
        type="button"
        onClick={() => onSelect?.(row)}
        className="block w-full rounded-t-lg px-3 pt-3 pb-2 text-left focus-visible:outline-2 focus-visible:outline-emerald-400"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate">
            <span className="font-mono text-xs tabular-nums text-zinc-500">{formatTime(row.time)}</span>{" "}
            <span className="font-medium text-zinc-100">{row.merchant}</span>
          </span>
          <span className="shrink-0 font-mono tabular-nums text-zinc-100">{formatUsd(row.amountUsd)}</span>
        </span>
        <span className="mt-1 block text-xs text-zinc-300 [overflow-wrap:anywhere]">{row.items}</span>
        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <VerdictPill data={row} />
          <span className="text-zinc-300">{statusLabel(row.status)}</span>
          {row.status === "held" && <Countdown data={row} />}
          {simulated && <span className="rounded px-2 py-0.5 font-medium text-amber-200 ring-1 ring-inset ring-amber-400/40">Simulated</span>}
        </span>
        {lead && (
          <span className="mt-2 block text-xs leading-snug text-zinc-400 [overflow-wrap:anywhere]">
            {lead}
            {row.reasons.length > 1 && <span className="text-zinc-600"> (+{row.reasons.length - 1} more)</span>}
          </span>
        )}
      </button>
      {(row.paypalOrderId || row.authorizationId || row.captureId) && (
        <div className="border-t border-zinc-800 px-3 pb-2">
          <PayPalIds data={row} />
        </div>
      )}
    </li>
  );
}

export function DecisionGrid({ rows, onSelect, height = 420, simulated = false }: DecisionGridProps) {
  const [statusPick, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const sorted = useMemo(() => newestFirst(rows), [rows]);
  const statuses = useMemo(
    () => [...new Set(rows.map((r) => r.status))].sort((a, b) => statusLabel(a).localeCompare(statusLabel(b))),
    [rows],
  );
  // A held row that gets paid drops its chip; fall back to "all" rather than show an empty list.
  const status = statuses.includes(statusPick as DecisionRow["status"]) ? statusPick : "all";
  const rowData = useMemo(() => filterDecisions(sorted, status, search), [sorted, status, search]);
  const autoHeight = rowData.length <= AUTO_HEIGHT_MAX;
  const cols = useMemo(() => (simulated ? [columnDefs[0], modeCol, ...columnDefs.slice(1)] : columnDefs), [simulated]);
  const grid = useRef<AgGridReact<DecisionRow>>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="inline-flex flex-wrap rounded-md border border-zinc-800 p-0.5">
          {["all", ...statuses].map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={`rounded px-3 py-1 text-xs font-medium ${status === s ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {s === "all" ? "All" : statusLabel(s)}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Search decisions"
          placeholder="Search merchant, items, reasons…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 basis-40 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => grid.current?.api.exportDataAsCsv({ fileName: "carthold-decisions.csv" })}
          className="hidden rounded-md border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-white/25 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-emerald-400 sm:block"
        >
          Export CSV
        </button>
      </div>
      {/* Under 640px the grid needs a horizontal scroll, so phones get stacked cards (same rows, same filters). */}
      <ul className="flex flex-col gap-2 sm:hidden" aria-label="Decisions">
        {rowData.map((r) => (
          <DecisionCard key={r.id} row={r} simulated={simulated} onSelect={onSelect} />
        ))}
        {!rowData.length && <li className="py-6 text-center text-sm text-zinc-500">No decisions match.</li>}
      </ul>
      <div className="hidden sm:block" style={autoHeight ? undefined : { height }}>
        <AgGridReact<DecisionRow>
          ref={grid}
          theme={gridTheme}
          rowData={rowData}
          columnDefs={cols}
          rowClassRules={rowClassRules}
          defaultColDef={{ resizable: true, sortable: true }}
          domLayout={autoHeight ? "autoHeight" : "normal"}
          getRowId={(p) => p.data.id}
          animateRows
          tooltipShowDelay={300}
          overlayNoRowsTemplate='<span style="color:#71717a">No decisions match.</span>'
          rowClass="cursor-pointer"
          onRowClicked={(e: RowClickedEvent<DecisionRow>) => {
            // ponytail: copy buttons live inside the row; a copy click is not a selection.
            if ((e.event?.target as Element | null)?.closest("[data-copy]")) return;
            if (e.data) onSelect?.(e.data);
          }}
        />
      </div>
    </div>
  );
}
