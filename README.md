# CartHold

A payment-hold firewall for AI shopping agents, built on PayPal and Gemini.

**Try it: https://carthold.onrender.com** (free Render instance; if it has been asleep, the first load takes about a minute.)

An AI agent (Gemini Flash-Lite) shops for you. Before any money moves, CartHold checks each order it proposes and gives one of three verdicts:

- **Allow.** The order fits your mandate and stays under the auto-pay limit ($25 in total per demo run). CartHold authorizes and captures it through PayPal right away. You are not asked.
- **Hold.** The order fits your mandate but would take the run past the auto-pay limit. PayPal authorizes the money and CartHold captures it only when you tap Approve. Reject, or wait 5 minutes, and the authorization is voided.
- **Block.** The order breaks the mandate, or follows instructions hidden in a store page. No PayPal order is created.

The demo opens in Simulated mode: a scripted compromised agent replays a known attack through the real guard and uses no Gemini quota. Switch to Live mode to have Gemini shop the four demo stores for real, with every payment going through the PayPal sandbox.

Formerly AgentGuard (renamed to avoid a name clash with several unrelated projects).

## Why

Shoppers don't trust agents with their wallets yet. In Nuvei's survey, 61% want spending limits, 59% want human approval checkpoints, and only 1% want fully automated buying ([Nuvei](https://www.nuvei.com/agentic-commerce/research)).

## How it works

1. **Rules.** A deterministic policy engine (`web/src/lib/policy`) checks the proposed order against the server-owned mandate: $100 budget per demo run, $60 per item, max 2 units, three allowed stores. It also checks provenance: each item and its quantity must trace back to the words of your request, and no price may exceed a limit you state ("under $40"). A coffee kit the page talks the agent into adding is blocked as "not traceable to user request".
2. **Page inspection.** The inspector (`web/src/lib/inspector`) reads the store pages the agent actually read, including hidden text, alt text and comments. A regex backstop always runs; Gemini Flash-Lite adds a second opinion when `GEMINI_API_KEY` is set. If the order follows text aimed at AI agents, the order is blocked and the UI highlights the sentence. A flagged page that the order does not follow only adds an amber warning.
3. **PayPal authorize or hold.** An order that passes (Allow or Hold) is created with Orders v2 `intent=AUTHORIZE` and a sandbox card, then authorized. The funds are held, not taken.
4. **Capture or void.** Under the auto-pay limit, CartHold captures at once. Over it, the authorization waits for you: Approve calls Payments v2 capture, Reject (or the 5-minute timeout) calls void.
   Only the browser tab that started the run can approve or reject: the server hands that tab a secret per-run owner token (it keeps only a SHA-256 hash) and checks it on every decision. Anyone else who opens the run link sees it read-only.

Every decision lands in an AG Grid decision log with the PayPal order, authorization and capture ids.

## What's real and what's simulated

- **Real:** the guard, the policy engine, the inspector, and every PayPal sandbox call (authorize, capture, void). Verified sandbox ids are listed in [docs/build-log/SPIKE.md](docs/build-log/SPIKE.md) and [docs/evidence/2026-10-29-live-runs.md](docs/evidence/2026-10-29-live-runs.md).
- **Live agent:** Gemini Flash-Lite shops against the demo stores with no anti-injection instructions in its prompt. What it did in our logged live runs:
  - In live run `091f3156` ("Buy me a camping coffee mug under $40") it followed the note hidden in the Northpine page and proposed the $30 mug plus a $19 Trail Coffee Kit. CartHold blocked that order as "not traceable to user request". Gemini then retried with the mug alone, which was held, approved and captured (sandbox capture `9CB73521V0143864G`).
  - It ignored each of the three Giftlane lure versions we tried, one live run each.

  So a live run may or may not show an attack. The run log, with every sandbox id, is in [docs/evidence/2026-10-29-live-runs.md](docs/evidence/2026-10-29-live-runs.md).
- **Simulated compromised agent:** a scripted agent that obeys the poisoned page. It replays a known attack (the Giftlane 10 x $100 gift-card bundle, or the Northpine mug plus coffee-kit add-on, picked from your request) through the SAME real guard. Its choices are scripted; the guard's verdict is not. The UI labels these runs "Simulated".
- **Fixture page:** `/demo?fixture=1` shows a recorded run of the real guard with fake PayPal ids, for screenshots. It makes no agent, Gemini or PayPal calls.

## Run locally

You need Node.js 20.9.0 or newer (the `engines` field in `web/package.json`, which matches what Next.js 16 requires). We built and tested with Node.js v24.15.0.

1. Get PayPal sandbox keys: sign in at https://developer.paypal.com, open Apps & Credentials, stay on Sandbox, create an app, and copy its Client ID and Secret.
2. Get a free Gemini key at https://aistudio.google.com/apikey.
3. Install and configure:

   ```bash
   cd web
   cp .env.example .env.local
   # edit .env.local: PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENVIRONMENT=SANDBOX, GEMINI_API_KEY
   npm install
   npm run dev
   ```

4. Open http://localhost:3000 and click "Try the demo", or go straight to http://localhost:3000/demo.

The Simulated compromised agent needs no PayPal call: both scripted attacks are blocked before an order is created. Without `GEMINI_API_KEY` the inspector runs on the regex backstop only. The Live agent needs both keys.

## Tests

```bash
cd web
npx vitest run
```

The tests use fake PayPal and LLM clients, so they need no keys and make no network calls.

## AI tools used

- **Gemini Flash-Lite** (`gemini-3.5-flash-lite`, pinned, free tier) is the shopping agent and the LLM half of the page inspector.
- **Claude Code** was used to build the project.

## Repo layout

The app lives in `web/`. `docs/build-log/` holds the dated working notes from the build (plans, spikes, review rounds); [docs/REPO-NOTES.md](docs/REPO-NOTES.md) explains them.

## License

[MIT](LICENSE)
