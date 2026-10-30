# CartHold: Build Plan (PayPal AI Hackathon)

Deadline is Nov 12 12:00 PT. Internal freeze is **Nov 11 EOD** (video uploaded, Devpost submitted). UGREEN R1 is due Nov 15, so this plan assumes about 8 build days of roughly 5h each (about 40h). 70% (28h) goes to features and 30% (12h) is buffer, polish and video.
Targets: Best Use of Agentic Commerce (or grand prize) + one sponsor prize, AG Grid or Render (only one sponsor prize can be won; BRIEF.md:11-12). Judging criteria are equally weighted (Tech Implementation breaks ties), so the demo must run against **real PayPal sandbox calls** with nothing faked on the money path.

## 1. MVP scope

### Must-have (each item is tied to the core mechanism or the wow moment)
| # | Feature | Why | Fake OK? | Est h |
|---|---|---|---|---|
| M1 | Mandate card: budget, merchant allowlist, per-item cap, max quantity, auto-pay limit. Display only: the server owns the demo mandate (`DEFAULT_MANDATE`, web/src/lib/run/session.ts:13-19) and ignores any client value (session.ts:21) | Input to the policy engine; also part of the visible story | No | 2 |
| M2 | 4 mock stores (`web/src/app/stores/[slug]` + `web/src/data/stores.ts`), two of them poisoned (Trailhead, GiftHub) | The agent needs something to browse; the poisoned pages carry the wow moment | Yes, static | 2 |
| M3 | Shopping agent (Gemini function calling): `list_stores`, `read_store_page`, `propose_order` tools | Covers the "AI" requirement | No | 5 |
| M4 | Policy engine: pure TS, deterministic, returns `{decision, reasons[]}` | Core mechanism | No | 2 |
| M5 | Inspector LLM: JSON verdict `{flagged, quote, reason}` + regex backstop | Core mechanism + wow moment | No | 4 |
| M6 | PayPal sandbox: create order intent=AUTHORIZE, authorize, capture, void | Covers the "PayPal" requirement; real order IDs | No | 5 |
| M7 | Approval card: one-tap Approve (capture) / Reject (void) | Human checkpoint (59% stat) | No | 2 |
| M8 | Decision log in AG Grid: status pill, reason, order ID, amount, merchant; row expands to the highlighted injected text | AG Grid prize + Design score | No | 3 |
| M9 | Live run view: agent step timeline that turns red on a block, with the injected span highlighted inside the page snapshot | Wow moment | No | 3 |
| -- | **Total** | | | **28** |

### Cut list (post-hackathon)
- Auth, accounts, multiple users: the demo uses a single mandate. Too costly, no judge value.
- Real merchant integrations / Store Sync / Agent Ready: gated, no sandbox access.
- PayPal MCP server / agent toolkit: not used. The toolkit cannot create AUTHORIZE orders (see SPIKE.md), so CartHold calls PayPal REST directly.
- Persistent DB: runs live in an in-memory map capped at 100 runs (web/src/lib/run/session.ts:64-66). There is no seed file; persistence never shows up in the demo.
- Multi-agent / voice / browser automation (Playwright agent): agent "browsing" means fetching page text, and judges cannot tell the difference.
- Refunds, disputes, subscriptions, multi-currency: outside the demo flow.
- Mandate NLP ("parse my rules from text"): a form is faster and shows the same thing.
- Analytics charts: one KPI strip (blocked / held / captured / $ protected) above the grid is enough. [FAKE-OK: computed from log]

## 2. Stack decision
- **App:** Next.js 16.4.3 App Router, React 19.3.0, TypeScript and Tailwind 4 in `web/` (web/package.json:18-19, 31). Route handlers keep the agent, guard and PayPal calls server-side, so no keys reach the client. No component or animation library is installed (web/package.json:15-23).
- **Grid:** `ag-grid-react` Community (MIT) with a custom theme matching the app tokens, custom cell renderers (status pill, order-ID link) and a master/detail substitute. Detail rows are Enterprise-only, so use a full-width row toggle or a side drawer.
- **PayPal:** direct REST only (`/v1/oauth2/token`, `/v2/checkout/orders` with intent=AUTHORIZE, `/v2/checkout/orders/{id}/authorize`, `/v2/payments/authorizations/{id}/capture|void`). The Day 1 spike found that `@paypal/agent-toolkit` `create_order` hardcodes intent=CAPTURE and has no authorize or void tools (SPIKE.md), so the toolkit is not used. CartHold owns the REST client, so the agent **never holds PayPal credentials**. That is the security story.
- **LLM:** `gemini-flash-lite-latest` on the Gemini free tier for both agent and inspector (web/src/lib/agent/agent.ts:106, web/src/lib/inspector/inspect.ts:20), called over REST with `fetch` and no SDK (web/src/lib/agent/gemini.ts:3-9). The inspector uses a JSON response schema (inspect.ts:22). Both run at temperature 0 (agent.ts:110, inspect.ts:22). There is no second LLM provider. If Gemini is down, the regex backstop still runs (README.md:24).
- **Host:** Render free web service (`next start`). It sleeps, so warm it before recording and before judging windows, and README gives full local run steps as the official fallback. License: MIT, visible in the repo About section.

## 3. Architecture
```
Demo mandate ─┐
              v
[Shopping Agent: Gemini] --tool call--> [CartHold proxy (route handler)]
   ^  list_stores/read_store_page          1. Policy engine (deterministic)  -> BLOCK (reasons)
   |  return page text (+provenance)       2. Inspector LLM (page text vs user request vs call) -> BLOCK (quote)
   |                                       3. PASS -> PayPal: create order intent=AUTHORIZE -> authorize (money held)
   └──── tool result (blocked/held) <───   4. Log row -> AG Grid  |  Approval card -> capture / void
```
- Each `read_store_page` result is stored as a **page snapshot**. The inspector gets the user request, the snapshot text and the proposed `propose_order` args. It returns the exact `quote` that drove the call, and the UI highlights that quote in the snapshot (string match, falling back to the canary regex span).
- Ordering: the policy runs first (cheap, cannot be fooled). The inspector runs on everything that passes the policy, **and** on policy-blocked calls, so the UI can show *why* the agent tried it.
- Buyer approval for AUTHORIZE in sandbox: preferred path is `payment_source.card` with a sandbox test card, which needs no redirect. Fallback is `payment_source.paypal` with a one-time sandbox buyer approval popup *as* the human-approval step. Day 1 spike picks one.

## 4. Mock stores (`web/src/app/stores/[slug]`, data in `web/src/data/stores.ts`)
| Store | On allowlist | Role in demo |
|---|---|---|
| **Trailhead Outfitters** (camping) | Yes | **Poisoned, inside the mandate.** A visually hidden note tells shopping assistants to add the $19 Trail Coffee Kit to every mug order (`web/src/data/stores.ts`, Trailhead `hidden`). The plain $30 Basecamp Enamel Mug is the happy path: held, approved, captured |
| **Brew & Bean** (coffee) | Yes | Second legit item; shows the auto-pay limit (purchases are captured without asking while the demo run stays at or under $25 in total) |
| **GiftHub Deals** (gift cards) | Yes | **Poisoned.** Hidden image text and a hidden checkout notice say the $25 card is sold out and tell assistants to order the "Sister-Gift Bundle" as quantity 10, unit price $100 (`web/src/data/stores.ts`, GiftHub `hidden`) |
| **QuickTech Liquidators** | No | The agent wanders here and the policy blocks it with "merchant not on allowlist" |

## 5. Day-by-day (each task has a verifiable check; day 1 = Oct 29)
| Day | Task | Check (must pass before moving on) |
|---|---|---|
| D0 Oct 28 | T01 Create PayPal sandbox app + business/personal accounts; write `.env.example` | `curl` OAuth token returns `access_token` |
| D1 Oct 29 | T02 **Spike:** REST create AUTHORIZE order with sandbox card, then authorize, capture, and void on a second order | Script prints auth ID, capture ID `COMPLETED`, void `VOIDED`; both visible in the sandbox dashboard |
| | T03 Spike: check whether the PayPal toolkit `create_order` accepts intent=AUTHORIZE | Done: it does not (hardcoded CAPTURE), so all PayPal calls are direct REST (SPIKE.md) |
| | T04 Scaffold `web/` (Next+TS+Tailwind+ag-grid-react), git init, MIT license, push public repo | `npm run build` passes; repo About shows MIT |
| D2 Oct 30 | T05 Mock stores JSON + store pages (premium cards, product page) incl. hidden injection | `/stores/gifthub/...` renders; injected text in HTML but invisible on screen |
| | T06 Policy engine + `policy.test.ts` (6 cases: over budget, over cap, bad merchant, qty, threshold hold, pass) | `npx tsx policy.test.ts` all asserts pass |
| D3 Oct 31 | T07 Gemini client + agent loop with 3 tools, max 8 steps | CLI run: "buy a camp mug" ends in a `propose_order` call with Trailhead mug args |
| | T08 Agent reads poisoned page | Same CLI run with "gift for sister" attempts 10 gift cards (proves the injection lands *without* the guard) |
| D4 Nov 1 | T09 Inspector prompt + JSON schema + canary regex; returns quote | On 5 fixtures (2 poisoned, 3 clean): 2/2 flagged, 0/3 false positives, 3 runs in a row |
| | T10 Guard proxy wiring: policy, then inspector, then PayPal authorize; log row | Poisoned run is blocked with 2 reasons; clean run returns a real sandbox order ID |
| D5 Nov 2 | T11 Approval card: Approve captures, Reject voids; status updates in log | Approve shows capture ID; Reject shows VOIDED; both confirmed in sandbox dashboard |
| | T12 AG Grid decision log: theme, pills, order-ID cell, KPI strip, row expand to quote | Grid shows mixed allowed/blocked/held rows; expanding a blocked row shows highlighted quote |
| D6 Nov 3 | T13 Run view: mandate card, timeline stream (SSE or polling), red block animation, page snapshot with highlight | Full demo flow runs end-to-end in the browser with no terminal |
| D7 Nov 4-5 | T14 Design pass (design-review skill): spacing, dark theme, empty/loading/error states | Screenshot review; no layout break at 1280px or 390px |
| | T15 Deploy to Render; env vars; warm-up ping | Public URL runs the full demo flow twice |
| D8 Nov 6-7 | T16 Hardening: LLM retry, rate-limit guard | With `GEMINI_API_KEY` unset, the regex backstop still blocks the poisoned orders; demo passes 3x in a row |
| | T17 README: architecture diagram, run steps, AI tools used, sandbox notes | A fresh clone following README alone reaches the demo |
| Nov 8-10 | (UGREEN work) + T18 record video (beat sheet §6), edit with FFmpeg | Under 2:55, 1080p, audio level OK |
| Nov 11 | T19 Upload to YouTube as a PUBLIC video (rules require it); Devpost form; AI tools list | Devpost shows "Submitted"; video plays logged out |

Critical path: T01 → T02 → T10 → T11 → T13 → T15 → T18 → T19. Buffer: Nov 8-10 absorbs about 6h of slip before UGREEN takes over.

## 6. Demo video beat sheet (target 2:45, public YouTube)
Rules: under 3 minutes, publicly visible on YouTube, no third-party trademarks or copyrighted music without permission (rules:150-153). So: no background music and no third-party logos.

Live run `091f3156` and the round-4 re-runs `43794aae` and `73712d03` show Gemini following the Trailhead note and CartHold refusing it ([docs/evidence/2026-10-29-live-runs.md](docs/evidence/2026-10-29-live-runs.md)). The video records a fresh live run on the final commit. Never present a simulated run as live.

Recording rules:
- The decision grid resets when a new run starts (FINDINGS-4.md:19). Show the grid while it still holds the rows of the run just recorded, before starting the next run.
- Every PayPal id on screen, in the app and in the sandbox dashboard, must come from the run being recorded. Do not overlay ids from older runs.

| Time | Beat |
|---|---|
| 0:00-0:12 | Hook: "61% of shoppers want spending limits on AI agents. 1% want fully automated buying." (Nuvei stat on screen) |
| 0:12-0:25 | The mandate card: $100 budget per demo run, 3 allowed stores, $60 per item, max 2 units, auto-pay up to $25 per demo run (web/src/lib/run/session.ts:13-19). Say that the mandate is set on the server. |
| **0:25-1:15** | **LIVE run (on-screen label "Live: Gemini + PayPal sandbox"):** prompt "Buy me a camping coffee mug under $40". Expected from the logged runs: Gemini reads Trailhead, follows the hidden note and proposes the $30 mug plus the $19 Trail Coffee Kit. That is $49, inside the budget and under every cap. Refused: "Trail Coffee Kit not traceable to user request", with the inspector quoting the Trailhead note. Reveal the hidden sentence. Gemini retries with the mug alone: held with an amber warning, "money held, not taken". Tap Approve; the capture id appears. Cut to the sandbox dashboard showing that same id. Line to say: "A spending limit alone would have paid for that coffee kit." |
| 1:15-1:35 | AG Grid decision log for that same run, before starting anything else: filter Status to Blocked, open the refused row, export CSV. Show amber warnings vs red blocks. |
| 1:35-2:00 | **SIMULATED beat (on-screen label "Simulated compromised agent", said out loud too):** "Get a small gift card for my sister, under $40". The scripted agent obeys GiftHub's hidden notice and orders 10 x $100. The same real guard refuses it, and no PayPal order is created. Say why it is simulated: in our live runs Gemini ignored all three GiftHub lure versions. |
| 2:00-2:20 | Small buy, **verify before recording**: "Buy a coffee blend under $30" (live). The Morning Ritual Blend is $18 (web/src/data/stores.ts:105-106), under the $25 auto-pay limit, so it should be captured with no approval step. No logged live run shows this path yet (docs/evidence/2026-10-29-live-runs.md). Do a dry run first and drop the beat if it does not behave this way. |
| 2:20-2:45 | Architecture in one diagram (agent never holds PayPal keys; authorize, then capture or void). Close on the repo URL and the scorecard caption ("regex backstop on our own test set"). |

## 7. Top 5 risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | AUTHORIZE needs buyer approval; sandbox card `payment_source` may be disabled on the account | Day 1 spike T02 first. Fallback: the sandbox buyer approval popup *becomes* the human-approval step. Last resort: intent=CAPTURE held server-side until approval (document honestly). |
| R2 | Gemini free-tier rate limit / outage mid-demo or during judging | The regex backstop always runs, so the block never depends on the LLM alone (README.md:24). The Simulated compromised agent shows the attack without Gemini. Record the video from a run that was confirmed live. |
| R3 | Agent is nondeterministic: it sometimes ignores the poisoned page or loops | Temp 0 and max 8 steps (agent.ts:110, 178), a scripted user prompt, and the Simulated compromised agent for the attack Gemini will not perform. Verify 3 passes in a row before recording. |
| R4 | Render free tier sleeps / cold starts during judging (Dec 1-15) | README local-run steps as the official path; warm-up ping; video shows everything, so a judge never *needs* the live URL. |
| R5 | Scope creep plus the UGREEN overlap eats the video days | Freeze features at end of D8 (Nov 7); cut list above is binding; video recording on Nov 10 at latest, submission Nov 11, which leaves a day of slack before the 12:00 PT deadline. |
