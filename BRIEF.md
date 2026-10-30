# CartHold: PayPal AI Hackathon brief

Source of rules: the rules text was copied from the Devpost Official Rules page on 2026-10-28. The copy is not in this repo; `rules:N` below means line N of that copy.

## Hackathon facts (quoted from the rules text)
- Submission Period ends "Thursday Nov 12, 2026 (12:00 pm Pacific Time)" (rules:88). Judging Period "Tuesday Dec 1, 2026 (2:00 pm Pacific Time) – Tuesday Dec 15, 2026 (8:00 am Pacific Time)" (rules:89). Builder also has UGREEN R1 due Nov 15.
- What to build: "Entrants must build or update an application that integrates the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform of their choice" (rules:119). "Any AI tool works, as long as PayPal integration is central to the project." (rules:121)
- Submit: a working demo, either "clear, complete setup and run instructions in your code repository" or "A hosted demo URL" (rules:142-144); a public repo whose license is "detectable and visible at the top of the repository page (in the About section)" (rules:148); a video that "should be less than three (3) minutes" (rules:150), is "uploaded to and made publicly visible on YouTube" (rules:152) and does "not include third party trademarks, or copyrighted music or other material unless the Entrant has permission" (rules:153); "a text description" (rules:141).
- List of AI tools used: this is a field on the Devpost submission form. It does not appear in the rules text (a grep for "AI tool" finds only rules:119, 121, 180).
- Judging: "equally weighted criteria" (rules:178-179): Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation (rules:180-184). Ties go to "the highest score in the first applicable criterion listed above" (rules:187), which is Technological Implementation.
- Targets: Best Use of Agentic Commerce ($5,000, listed under Honorable Mention Prizes, rules:208, 225-226) or a Grand Prize, plus one sponsor prize: AG Grid ($5,000 / $2,000 / $1,000, rules:230-241) or Render ($1000 / $750 / $500 in Render credits, rules:255-266). The app uses AG Grid for the decision log and is meant to be hosted on Render, but only one sponsor prize can be won (rules:268).
- Prize cap: "A project can only win up to one (1) Grand Prize and one (1) Sponsor Prize OR one (1) Honorable Mention Prize and one (1) Sponsor Prize." (rules:268)

## Builder constraints
- Solo, builds with Claude Code. $0 budget: free tiers only (Gemini free tier, PayPal sandbox, Render free, AG Grid Community MIT). No Twilio, no paid APIs.
- UI must be premium: React + Tailwind, never plain HTML.
- Ask user before any GPU run / model pull. npm installs inside this repo are approved.

## Product
CartHold = spend firewall between an AI shopping agent and PayPal.
- Demo mandate: budget, merchant allowlist, per-item cap, max quantity, auto-pay limit. It is fixed on the server (`DEFAULT_MANDATE`, web/src/lib/run/session.ts:13-19; CONTRACT.md:15-17). The client cannot change it, and the UI only displays a copy (web/src/components/demo/DemoApp.tsx:19-21).
- Shopping agent (Gemini Flash-Lite) browses mock stores and proposes purchases through one `propose_order` tool. It never holds PayPal credentials.
- CartHold checks every purchase the agent proposes:
  1. Deterministic policy check (merchant allowlist, per-item cap, quantity, budget remaining, items traceable to the user's request).
  2. Page inspection: regex backstop plus Gemini inspector over the pages the agent read. An order that follows injected page text is refused.
  3. Passing orders go to PayPal as Orders v2 intent=AUTHORIZE (direct REST). Under the cumulative $25 auto-pay limit they are captured at once; above it they are held until one-tap Approve (capture) or Reject/timeout (void).
- Decision log in AG Grid (every attempted call: allowed/blocked/held, reason, sandbox order id).
- Wow demo: poisoned GiftHub page pushes a 10 x $100 gift-card bundle -> refused, injected text highlighted. Poisoned Trailhead page adds a $19 coffee kit to a $30 mug order (in budget, under every cap) -> refused on provenance + inspection. The plain $30 mug -> held, approved, captured with a visible sandbox order ID.

## Pain evidence (sourced)
- Nuvei: 61% want spending limits, 59% want human approval checkpoints, 1% want fully automated buying. https://www.nuvei.com/agentic-commerce/research
- Checkout.com: 75% merchants say real-time revocation critical. https://retail-insider.com/retail-insider/2026/06/checkout-com-report-finds-consumer-interest-in-ai-shopping-outpacing-trust-and-merchant-readiness/

## PayPal integration (decided, see SPIKE.md)
- Direct REST only: Orders v2 (create with intent=AUTHORIZE, authorize) and Payments v2 (capture, void). The PayPal agent toolkit's `create_order` hardcodes intent=CAPTURE with a buyer redirect and has no authorize/void tools, so it is not used.
- Avoid Store Sync / Agent Ready (gated, no sandbox).
