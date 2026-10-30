"use client";

import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState } from "react";
import type { scoreCorpus } from "../../lib/inspector/scorecard";
import { attacksFirst, correctMark } from "./format";
import { gridTheme } from "./theme";

ModuleRegistry.registerModules([AllCommunityModule]);

export type ScorecardRow = ReturnType<typeof scoreCorpus>["rows"][number];
export type ScorecardGridProps = { rows: ScorecardRow[]; height?: number };

type LabelFilter = "all" | ScorecardRow["label"];
const FILTERS: LabelFilter[] = ["all", "attack", "benign"];

const columnDefs: ColDef<ScorecardRow>[] = [
  { field: "id", headerName: "Corpus id", width: 160, cellClass: "font-mono text-xs" },
  { field: "label", headerName: "Label", width: 96, cellClass: (p) => (p.value === "attack" ? "text-red-300" : "text-zinc-300") },
  { field: "style", headerName: "Style", width: 140, valueFormatter: (p) => p.value ?? "—" },
  // cellDataType "text": AG Grid infers booleans and renders a low-contrast checkbox otherwise (QA-11).
  {
    field: "flagged", headerName: "Flagged", width: 104, cellDataType: "text",
    valueFormatter: (p) => (p.value ? "✓ yes" : "✗ no"),
    cellClass: (p) => (p.value ? "font-medium text-amber-300" : "text-zinc-400"),
  },
  {
    field: "correct", headerName: "Correct", width: 92, cellDataType: "text", valueFormatter: (p) => correctMark(!!p.value),
    cellClass: (p) => (p.value ? "font-semibold text-emerald-400" : "font-semibold text-red-400"),
  },
  {
    field: "triggeringText", headerName: "Triggering text", flex: 1, minWidth: 260, wrapText: true, autoHeight: true,
    valueFormatter: (p) => p.value ?? "—", tooltipField: "triggeringText", cellClass: "leading-snug py-1",
  },
];

export function ScorecardGrid({ rows, height = 480 }: ScorecardGridProps) {
  const [label, setLabel] = useState<LabelFilter>("all");
  const [search, setSearch] = useState("");
  // ponytail: label filter is a plain array filter; AG Grid's set filter is Enterprise-only.
  const sorted = useMemo(() => attacksFirst(rows), [rows]);
  const rowData = useMemo(() => (label === "all" ? sorted : sorted.filter((r) => r.label === label)), [sorted, label]);
  // Under 640px the grid needs a horizontal scroll, so phones get a stacked list instead (same filters).
  const listRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rowData.filter((r) => [r.id, r.label, r.style, r.triggeringText].some((v) => v?.toLowerCase().includes(q))) : rowData;
  }, [rowData, search]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter by label" className="inline-flex rounded-md border border-zinc-800 p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={label === f}
              onClick={() => setLabel(f)}
              className={`rounded px-3 py-1 text-xs font-medium capitalize ${label === f ? "bg-emerald-500/15 text-emerald-300" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {f}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Search scorecard"
          placeholder="Search id, style, text…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none"
        />
      </div>
      <ul className="flex flex-col gap-2 sm:hidden" aria-label="Scorecard rows">
        {listRows.map((r) => (
          <li key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-mono text-xs [overflow-wrap:anywhere] text-zinc-200">{r.id}</span>
              <span className={`shrink-0 font-semibold ${r.correct ? "text-emerald-400" : "text-red-400"}`}>{correctMark(!!r.correct)} {r.correct ? "correct" : "wrong"}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">
              <span className={r.label === "attack" ? "text-red-300" : "text-zinc-300"}>{r.label}</span>
              {r.style && ` · ${r.style}`}
              {" · "}
              <span className={r.flagged ? "font-medium text-amber-300" : ""}>{r.flagged ? "flagged" : "not flagged"}</span>
            </p>
            {r.triggeringText && <p className="mt-2 text-xs leading-snug text-zinc-300 [overflow-wrap:anywhere]">{r.triggeringText}</p>}
          </li>
        ))}
        {!listRows.length && <li className="py-6 text-center text-sm text-zinc-500">No rows match.</li>}
      </ul>
      <div className="hidden sm:block" style={{ height }}>
        <AgGridReact<ScorecardRow>
          theme={gridTheme}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={{ resizable: true, sortable: true }}
          getRowId={(p) => p.data.id}
          quickFilterText={search}
          tooltipShowDelay={300}
        />
      </div>
    </div>
  );
}
