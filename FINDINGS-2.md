Note: the project was renamed from AgentGuard to CartHold on 2026-10-30; this file keeps the old name as a build log.

# Round 2 verification — 2026-10-29 (4 skill agents re-checked round-1 fixes)

Baseline (lead, fresh): 124/124 tests, tsc 0, lint 0, build 0.
Live sandbox (QA, real): approve → order 1E943314CU814705W capture 01K348840S099210H; reject → auth 9PV35600E0696470Y voided.

## Confirmed FIXED (independent repro / browser evidence)
Mandate override (all variants) · sourceSlug mismatch · order splitting · DECLINED/DENIED · rounding · capture-fail void ·
reveal highlights all 3 segments · pending state (no red flash) · landing links · 70s hang · double-click approve · refresh restore ·
inspector reasons first · truthful HELD text · double Run · Simulated labels · fixture banner · AG Grid filters/flash/rowClass/CSV ·
scorecard contrast · first paint · mobile order · 415/403/413/400 · headers + CSP (no violations) · no stack traces · slug traversal.

## R2-P0 — regressions & money holes (fix first, test-first)
A. Page TAINT regression: inspecting every page read blocks ALL later orders after GiftHub is read (CR-3, DD #2, QA new 2/4/5).
   Live: honest gift card can never succeed; earbuds card headlined with GiftHub reasons. → Make inspection ORDER-aware:
   block only if the order is driven by a flagged page (merchant page flagged, or order items/merchant/qty match the injected instruction);
   otherwise attach a warning, not a block. Backstop page-level verdict must not by itself block a purchase that traces to the user request.
B. LLM inspector false "drift" vs wrong page / wrong order (QA new 1/3): mug blocked comparing against Brew & Bean; reasons describe a different order.
   → Inspector must receive the exact merchant page + the exact proposed order; verify quote belongs to that page.
C. Network error / PENDING on create+authorize leaves money held, uncounted, never voided (CR-1, DD #7). → void-or-unknown on that step too.
D. "unknown" rows never resolve; run with unknown can be evicted (CR-2). → resolve via getOrder/auth status poll; never evict runs with unknown.
E. Throwing SSE listener kills agent run (session push no try/catch) (CR-4).
F. Unbounded body buffering before 16KB check: 400MB chunked → 1.4GB RSS (SEC new 1). → streaming byte counter.
G. XFF spoof bypasses per-IP limit (SEC). → trust only platform header (Render: true client IP header) / socket; document.

## R2-P1
- Catalog check: item names/prices must match stores data (CR-5).
- Cumulative threshold UX: copy says "Ask me above $25" but now holds any order over $25 minus committed (CR-6, DD Q5). Decide + align copy + fixtures.
- Copy vs code: "nothing captured until you approve" false (auto-capture under threshold); "every tool call"; "intent drift"; scorecard = regex only (DD).
- Redteam replay ignores typed request (QA 29).
- Trace lags hold card ~30s (QA new 6); stale final text after Reject (QA new 7); refresh doesn't restore request text (QA new 8); earbuds run no closing message (QA new 9); REFUSED text cut off (QA new 11).
- SSE streams never close after end; no stream cap; holds endpoint no rate limit (SEC new 3/6).
- PayPal error text (paths/ids) to client (SEC/DD #24).
- @paypal/agent-toolkit unused but in deps → 11 high npm audit (SEC/DD #25); still claimed in BRIEF/PLAN/NOVELTY (DD #26).
- Fixture shows flows real guard refuses (CR-8, DD).
- Order-sensitive line-merge key (CR-7/DD #4).

## Still-open round-1 items (honesty / submission)
#27 in-mandate poisoned purchase · #28 document Gemini resisted · #30 public repo · #31 README · #32 rename · #33 scorecard labelling ·
#36 video plan ($100 not $150; public YouTube).

## Process lesson
Two agents shared one gstack browser daemon → one drove the other's tab and started an unintended LIVE run (no money moved).
Rule: one browser per agent (BROWSE_STATE_FILE + BROWSE_PORT) or one browser agent at a time. Gemini free tier 15 RPM shared → 429s.
