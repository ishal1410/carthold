Note: the project was renamed from AgentGuard to CartHold on 2026-10-30; this file keeps the old name as a build log.

# End-to-end review — 2026-10-28 (4 skill agents, cite-or-delete)

Sources: code-review-and-quality (CR), security-and-hardening (SEC), qa-only browser E2E (QA), doubt-driven-development rules audit (DD).
Verified by lead: SEC-1, SEC-4/CR-1, toolkit-unused (grep), DD-6 is FALSE (live sandbox verified 2026-10-28:
capture 7VE43424H86013848, void 9S0542931V850621T, guard hold→capture order 8HC52952RT288635L; QA live run:
order 0WW91005W72065834 capture 12543692F1954200M, reject→void auth 6KP64629H7699140C).

## P0 — guard can be bypassed / money state wrong (fix first, test-first)
1. Client overrides mandate → no approval (SEC-1). session.ts:24,70. Fix: server-owned mandate, ignore body.mandate.
2. Agent-chosen sourceSlug picks inspected page; unknown slug → "" → paid (CR-1, SEC-4). guard.ts:79,82. Fix: page from merchant; block on mismatch/unknown; inspect all pages actually read.
3. Order splitting bypasses approval threshold (CR-2). policy.ts:95. Fix: cumulative committed + amount > threshold → hold.
4. Repeated line items bypass maxQuantity + provenance qty (CR-3). policy.ts:77-86. Fix: sum qty per normalized item.
5. Capture/void failure leaves money held but untracked/unvoidable (CR-4, CR-8 listener throw). guard.ts:245-258,164-171. Fix: void on capture fail; keep row at-risk on failure; try/catch listeners.
6. PayPal DECLINED/DENIED treated as success (CR-5). orders.ts toResult, guard.ts. Fix: require CREATED/AUTHORIZED and COMPLETED.
7. Ambiguous capture error drops spend from budget ($120 vs $100) (CR-6). Fix: "unknown" status counted in committed.
8. Rounding mismatch policy vs PayPal (CR-7). Fix: whole-cent prices only / one cents function.

## P1 — demo-breaking UI/flow (QA)
9. Reveal highlights wrong hidden line (QA-1). Highlight ALL hidden segments + the inspector quote.
10. Live hold flashes red "Blocked" ~2.5s before "Held" (QA-2) — row starts status "blocked" before PayPal auth. Add "pending/authorizing" status.
11. Landing page / has no links to /demo (QA-3).
12. Agent hangs ~71s then "fetch failed" after refusal (QA-4). Add Gemini fetch timeout + clean stop message.
13. Double-click Approve → capture + 409 error banner (QA-5). Disable on first click.
14. Refresh loses run + pending hold (QA-6). Put runId in URL, reconnect.
15. Inspector reason hidden behind "and 4 more" on blocked card (QA-7). Show inspector reason first.
16. Live agent final text says "successfully placed" when only held, raw **, duplicated (QA-8).
17. Double Run same tick → two runs interleave (QA-10).

## P1 — public-demo security (SEC)
18. No rate limit / auth on POST /api/runs → quota burn (SEC-2, SEC-11 text/plain CSRF). Per-IP + daily live cap; require application/json + same Origin.
19. FIFO eviction kills runs with pending holds (SEC-3, CR-9). Skip runs with pending holds.
20. Inspector prompt delimiter breakout (SEC-5). Random delimiter / separate part.
21. No body size / array caps (SEC-6). 16KB cap (moot after #1).
22. Non-idempotent PayPal-Request-Id (SEC-8). Derive per row+step.
23. Security headers missing (SEC-10). CSP, frame-ancestors, nosniff, poweredByHeader false.
24. Upstream error bodies streamed to client (SEC-12).
25. npm audit 11 high — all from @paypal/agent-toolkit which runtime never imports (SEC-9).

## P1 — submission / honesty / judging (DD)
26. @paypal/agent-toolkit NOT on runtime path (DD-1, verified). Either wire real toolkit call into runtime or remove all toolkit claims (BRIEF.md:21, PLAN.md:35).
27. Wow beat only proves a budget cap (DD-3). Add in-mandate poisoned purchase blocked only by provenance/inspector.
28. "Gemini resisted 3/3" undocumented; video plan implies live hijack (DD-4). Document in README + on screen; rewrite beat.
29. Simulated labelling missing in README/grid rows; redteam text ignores typed request; fixture has no banner (DD-5).
30. Not public; UI/API uncommitted (DD-2). Commit + public GitHub + license in About.
31. README mostly TODO; no hosted URL; no run/creds instructions (DD-7).
32. Name "AgentGuard" collides with 7+ projects (DD-10). Rename before public.
33. Scorecard is regex-only on own corpus; Giftlane real lure not in "demo page" row (DD-9, QA-9). Label honestly; add LLM column.
34. AG Grid usage basic (DD-15): add column filters, cell flash, status row classes, CSV export.
35. Regex backstop page-level, blocks legit Giftlane buys (DD-13).
36. BRIEF misquotes rules (DD-12). Video must be public YouTube (DD-8).

## Low
Scorecard checkbox contrast (QA-11), 0.5s black first paint (QA-12), mobile hold card far down (QA-13), one-keyword provenance (CR-10), guarded-tools dead code (CR-11), tests only cover happy path (CR-12).

## Scorecard now (DD): Tech 3 · Design 3 · Impact 3 · Innovation 2-3 · Presentation 1
