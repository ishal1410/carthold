Note: the project was renamed from AgentGuard to CartHold on 2026-10-30; this file keeps the old name as a build log.

# Round 4 verification — 2026-10-30 (commit 7660dd3; 4 skill agents)

Lead baseline: 217/217 tests (keys removed, network disabled), tsc/lint/build 0, npm audit 0.
Correctness: approve-with-changes, no P0 regressions (R3 items 1,2,3,4,6,11,13 FIXED by repro; 5 PARTIAL).
Security: all prior blocks hold; PUBLIC_ORIGIN works (Host spoof → 403 when set).
QA live (real Gemini + sandbox): Gemini followed the Trailhead injection in 2/2 mug runs on HEAD; refused; mug held; Reject → voided, Approve → captured (ids in docs/evidence). Earbuds blocked by allowlist. All UI checks PASS.

## R4 fix list
1. [Med] Allow-path order whose capture failed and that the SYSTEM voided (void failed → unknown) gets re-armed as approvable HOLD by resolver (guard.ts voidOrUnknown sets no decision). Approve → captured, counted as auto-paid. Fix: decision "system-voided" → resolver only retries void.
2. [Med] Unknown rows WITH order id poll forever when getOrder 404s / returns PENDING (try counter only on no-id branch). Fix: count tries on every branch → unresolvable.
3. [Med] Rate-limit map full → global lockout of new IPs (runs AND holds). takeIpSlot runs before validation (empty {} bodies fill it, 10k in 7.9s locally); holds share the map; holds slot taken before Origin/content-type check. Fix: validate first, then rate-limit; separate hold map; hold slot after readJsonPost.
4. [Low] Invented LLM drift → false "page contains text aimed at AI agents" warning on a clean page (inspect.ts flagged from mismatch). Fix: warn only if regex flagged or quote verified.
5. [Low] dictatedPrices misses "$100 each" / "price $100" (needs "unit price"). 
6. [Design] LLM mismatch path never changes a verdict — document that the LLM's blocking role is verified quotes from hidden text only (or remove).
7. [Med UX] Closing "Refused:" summary lists the held mug as refused ("Basecamp Enamel Mug, 16 oz, Trail Coffee Kit (not what you asked for)") and omits the injection reason; earbuds refusal listed twice (merchant + item).
8. [Low] Simulated narration reason order differs from card; gift inspector quotes first injected sentence rather than the one the agent followed.
9. [Med UX] 390px decision log needs in-grid horizontal scroll for Amount/Verdict/Status; ~300px empty grid. Fix: card list on mobile (as scorecard) or autoHeight.
10. [Low] Scorecard "All" ordering (2 attacks after benign).
11. [Docs] PLAN.md stale (Next 15, Groq, seed.json, old tool names/paths, M1 input panel); video beat order (grid beat must come before a new run — grid resets per run); BRIEF.md:3 exposes local path; BRIEF:11 range, :21 stale; evidence log line cites; session.ts:151 agent prompt "over $25" not cumulative; api/runs error says "red-team mode" (UI: "Simulated compromised agent").
12. [Low] PARTIALLY_CAPTURED keeps full amount; Origin falls back to Host when PUBLIC_ORIGIN unset (set it on Render).

## Then: submission
Rename → CartHold (no exact collision; tagline must say "payment hold"; coupled string "REFUSED by AgentGuard: " across code+tests+fixture) · scrub docs for public repo · public GitHub + MIT in About · Render deploy (PUBLIC_ORIGIN, TRUSTED_PROXY_HOPS=1, LIVE_RUNS_PER_DAY) · fresh live runs on final commit · video (<3:00, public YouTube) · Devpost text.
