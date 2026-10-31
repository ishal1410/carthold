"use client";

import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams, type RowClassRules, type RowClickedEvent } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DecisionRow } from "../../lib/guard/guard";
import { filterDecisions, formatCountdown, formatTime, formatUsd, newestFirst, statusLabel, verdictLabel } from "./format";
import { headline, plainReason } from "../demo/reasons";
import { gridTheme } from "./theme";
import { ReceiptInline } from "../demo/Receipt";
import { StatusPill, buttonClasses, cx } from "../ui";
import "./grid.css";

ModuleRegistry.registerModules([AllCommunityModule]);

export type DecisionGridProps = {
  rows: DecisionRow[];
  onSelect?: (row: DecisionRow) => void;
  height?: number;
};

// Renderers only read `data`, so the phone card list can reuse them with a bare row.
type Cell = Pick<ICellRendererParams<DecisionRow>, "data">;

const PILL = { allow: "allow", hold: "hold", block: "block" } as const;

function VerdictPill({ data }: Cell) {
  if (!data) return null;
  return <StatusPill status={PILL[data.verdict]} label={verdictLabel(data.verdict)} size="sm" />;
}

function PayPalIds({ data }: Cell) {
  return data ? <ReceiptInline row={data} /> : null;
}

function Countdown({ data }: Cell) {
  const [now, setNow] = useState(() => Date.now());
  const expiresAt = data?.status === "held" || data?.status === "awaiting_payer" ? data.expiresAt : undefined;
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return <span className="text-ink-faint">-</span>;
  const left = Date.parse(expiresAt) - now;
  return (
    <span className={`figures ${left < 30_000 ? "text-blocked" : "text-hold"}`}>{formatCountdown(left)}</span>
  );
}

// Widths sum to fit a 1104px (max-w-6xl) grid without sideways scroll; Expires only shows while a hold is open.
// The run's mode is on the run bar badge, so the grid has no Mode column (same for simulated and live runs).
const columnDefs: ColDef<DecisionRow>[] = [
  { field: "time", headerName: "Time", width: 84, valueFormatter: (p) => (p.value ? formatTime(p.value) : ""), cellClass: "figures text-ink-faint" },
  { field: "merchant", headerName: "Merchant", width: 140, filter: "agTextColumnFilter" },
  { field: "items", headerName: "Items", flex: 1, minWidth: 120, tooltipField: "items" },
  {
    field: "amountUsd", headerName: "Amount", width: 96, type: "rightAligned",
    valueFormatter: (p) => (p.value == null ? "" : formatUsd(p.value)), cellClass: "figures",
    filter: "agNumberColumnFilter",
  },
  {
    // The guard's first decision; Outcome is where the money ended up (a Hold can end Paid or Voided).
    field: "verdict", headerName: "Guard verdict", width: 116, cellRenderer: VerdictPill,
    valueFormatter: (p) => (p.value ? verdictLabel(p.value) : ""), headerTooltip: "The guard's first decision on this payment",
  },
  {
    field: "status", headerName: "Outcome", width: 100, filter: "agTextColumnFilter", enableCellChangeFlash: true,
    valueFormatter: (p) => (p.value ? statusLabel(p.value) : ""),
    // Filter on the label the user sees ("Paid"), not the raw enum ("captured").
    filterValueGetter: (p) => (p.data ? statusLabel(p.data.status) : ""),
  },
  {
    // One line per row: a single block lists 7+ reasons, which blew rows up to ~400px. Full list is in the tooltip and the reveal panel.
    field: "reasons", headerName: "Reasons", flex: 2, minWidth: 140,
    valueFormatter: (p) => {
      const r: string[] = p.value ?? [];
      // Lead with the reason that decided it, never a non-blocking "warning:".
      return r.length > 1 ? `${plainReason(headline(r))} (+${r.length - 1} more)` : r[0] ? plainReason(r[0]) : "";
    },
    tooltipValueGetter: (p) => (p.data?.reasons ?? []).join("\n"),
    cellClass: "text-ink-muted",
  },
  {
    // Chips wrap onto a second line instead of widening the grid.
    colId: "paypal", headerName: "PayPal receipt", width: 212, sortable: false, cellRenderer: PayPalIds, autoHeight: true, cellClass: "py-1.5",
    // Only used by CSV export; the cell itself renders PayPalIds.
    valueGetter: (p) => [p.data?.paypalOrderId, p.data?.authorizationId, p.data?.captureId].filter(Boolean).join(" "),
  },
];
const expiresCol: ColDef<DecisionRow> = { field: "expiresAt", headerName: "Expires", width: 84, sortable: false, cellRenderer: Countdown };

// Unknown future statuses get no class (and render their raw name via statusLabel).
const st = (p: { data?: DecisionRow }): string => p.data?.status ?? "";
const rowClassRules: RowClassRules<DecisionRow> = {
  "ag-st-pending": (p) => st(p) === "pending",
  "ag-st-blocked": (p) => st(p) === "blocked",
  "ag-st-held": (p) => st(p) === "held" || st(p) === "awaiting_payer",
  "ag-st-captured": (p) => st(p) === "captured",
  "ag-st-error": (p) => st(p) === "error" || st(p) === "unknown",
};

// Up to this many rows the grid sizes to its content (no empty band); beyond it, fixed height + inner scroll.
const AUTO_HEIGHT_MAX = 10;

function DecisionCard({ row, onSelect }: { row: DecisionRow; onSelect?: (row: DecisionRow) => void }) {
  const lead = headline(row.reasons);
  return (
    <li className={`ag-st-${row.status === "unknown" ? "error" : row.status === "awaiting_payer" ? "held" : row.status} overflow-hidden rounded-md border border-line bg-surface-1 text-sm shadow-raise`}>
      <button type="button" onClick={() => onSelect?.(row)} className="block w-full px-3.5 pt-3 pb-2.5 text-left">
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate font-medium text-ink">{row.merchant}</span>
          <span className={cx("figures shrink-0", row.status === "blocked" ? "text-ink-muted line-through decoration-blocked/60" : "text-ink")}>{formatUsd(row.amountUsd)}</span>
        </span>
        <span className="mt-0.5 block text-xs text-ink-muted [overflow-wrap:anywhere]">{row.items}</span>
        <span className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
          <VerdictPill data={row} />
          <span className="text-ink-muted">{statusLabel(row.status)}</span>
          {(row.status === "held" || row.status === "awaiting_payer") && <Countdown data={row} />}
          <span className="figures ml-auto text-2xs text-ink-faint">{formatTime(row.time)}</span>
        </span>
        {lead && (
          <span className="mt-2 block text-xs leading-snug text-ink-muted [overflow-wrap:anywhere]">
            {plainReason(lead)}
            {row.reasons.length > 1 && <span className="text-ink-faint"> (+{row.reasons.length - 1} more)</span>}
          </span>
        )}
      </button>
      {(row.paypalOrderId || row.authorizationId || row.captureId) && (
        <div className="border-t border-line px-3.5 py-1.5">
          <PayPalIds data={row} />
        </div>
      )}
    </li>
  );
}

export function DecisionGrid({ rows, onSelect, height = 420 }: DecisionGridProps) {
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
  const anyHeld = rows.some((r) => r.status === "held" || r.status === "awaiting_payer");
  const cols = useMemo(() => (anyHeld ? [...columnDefs, expiresCol] : columnDefs), [anyHeld]);
  const grid = useRef<AgGridReact<DecisionRow>>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="inline-flex flex-wrap rounded-pill border border-line bg-surface-2 p-1">
          {["all", ...statuses].map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              className={cx(
                "h-7 rounded-pill px-3 text-xs transition-colors duration-[var(--duration-base)] ease-snap",
                status === s ? "bg-surface-3 text-ink shadow-raise" : "text-ink-muted hover:text-ink",
              )}
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
          className="h-9 min-w-0 flex-1 basis-40 rounded-pill border border-line bg-surface-2 px-4 text-sm text-ink placeholder:text-ink-faint focus:border-hold/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => grid.current?.api.exportDataAsCsv({ fileName: "carthold-decisions.csv" })}
          className={buttonClasses({ variant: "ghost", size: "sm", className: "hidden sm:inline-flex" })}
        >
          Export CSV
        </button>
      </div>
      {/* Under 640px the grid needs a horizontal scroll, so phones get stacked cards (same rows, same filters). */}
      <ul className="flex flex-col gap-2 sm:hidden" aria-label="Decisions">
        {rowData.map((r) => (
          <DecisionCard key={r.id} row={r} onSelect={onSelect} />
        ))}
        {!rowData.length && <li className="py-6 text-center text-sm text-ink-faint">No decisions match.</li>}
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
          overlayNoRowsTemplate='<span style="color:var(--ink-faint)">No decisions match.</span>'
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
