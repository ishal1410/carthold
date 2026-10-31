# Step 3 contract (demo screen): all agents build against this

Source types (do not change): `DecisionRow`, `GuardState`, `RowStatus` in web/src/lib/guard/guard.ts;
`AgentEvent`, `AgentOrder`, `Persona` in web/src/lib/agent/agent.ts; `Mandate` in web/src/lib/policy/policy.ts;
`scoreCorpus` rows in web/src/lib/inspector/scorecard.ts; `stores`, `getPageText` in web/src/data/stores.ts.

## Modes
- `live`: real Gemini agent (runAgent, persona "realistic") + real guard + real PayPal sandbox.
- `redteam`: "Simulated compromised agent". A deterministic replay that emits real-shaped AgentEvents and obeys a
  poisoned page's hidden note. Scenarios live in web/src/lib/redteam/redteam.ts (`giftlane-bundle`: the 10 x $100
  Giftlane bundle; `northpine-addon`: mug plus the $19 Trail Coffee Kit), picked from the typed request.
  Flow: list_stores, read_store_page (real getPageText), propose_order, then the guard's REFUSED string, then done.
  Goes through the SAME real guard (so the block is real). UI must label it clearly as simulated.

## Default demo mandate (server-owned, not settable by the client; budget and auto-pay limit are per demo run)
{ userRequest: <from UI>, budgetUsd: 100, perItemCapUsd: 60, approvalThresholdUsd: 25,
  merchantAllowlist: ["Northpine Outfitters", "Brew & Bean", "Giftlane Deals"], maxQuantity: 2 }

## HTTP API (Next.js route handlers, runtime nodejs)
- POST /api/runs  body { userRequest: string (1-300 chars), mode: "live"|"redteam" } → 201 { runId }
  The mandate is server-owned (DEFAULT_MANDATE in web/src/lib/run/session.ts). Any client "mandate" field is stripped and ignored.
- GET  /api/runs/:runId/stream  → text/event-stream. Each SSE `data:` is JSON StreamMsg:
    type StreamMsg =
      | { kind: "agent"; event: AgentEvent }
      | { kind: "guard"; state: GuardState }          // sent on every guard change + once on connect
      | { kind: "end" }                                // agent loop finished (holds may still be pending)
  Replays all past messages on connect (late subscribers see full history).
  Closes once the run is settled (`isSettled` in web/src/lib/run/session.ts: agent ended, no pending hold, no row with
  unknown money state). Before closing it sends `retry: 86400000` and a final `{ kind: "end" }`, so EventSource does not
  reconnect and replay (web/src/app/api/runs/[runId]/stream/route.ts).
- POST /api/runs/:runId/holds/:rowId  body { action: "approve"|"reject" } → 200 { state: GuardState } | 404/409 { error }
- 429 limits (web/src/lib/run/limits.ts, in-process, one instance):
    POST /api/runs: 6 per IP per 10 minutes; live mode also counts against a global daily cap, LIVE_RUNS_PER_DAY (default 60, UTC day).
    POST /api/runs/:runId/holds/:rowId: 30 per IP per minute.
    GET  /api/runs/:runId/stream: 20 open streams per IP and 10 per run.
    Client IP is the x-forwarded-for entry TRUSTED_PROXY_HOPS (default 1) from the right.
- GET  /api/scorecard → 200 { attacksBlocked, falsePositives, total, rows } (scoreCorpus over corpus.json)
- GET  /api/stores/:slug/text → 200 { slug, merchant, text } (getPageText), used to show the page with triggeringText highlighted.

## UI
- Route /demo. Dark premium (Tailwind v4), matches landing page (zinc/emerald). Panels:
  mandate card · request input + mode toggle (Live / Simulated compromised agent) · live agent trace ·
  hold approval card (Approve / Reject, countdown to expiresAt) · amount-at-risk counter · AG Grid decision log ·
  "Injection revealed" panel: page text with row.triggeringText highlighted in red.
- /demo/scorecard (or a tab): AG Grid of scorecard rows + headline numbers.
