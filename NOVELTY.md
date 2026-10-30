Note: the project was renamed from AgentGuard to CartHold on 2026-10-30; this file keeps the old name as a build log.

# AgentGuard: scoring and prior-work check

Date: 2026-10-28. Skill used: `hackathon-idea-scoring` (1-5 per axis, weight 1.0 each, penalties per rubric).
Prior-work check: 5 web searches (the maximum allowed). Search results were secondary listings (PyPI, glama, lablab, vendor blogs). I opened no repos or primary network docs, so the overlap notes below come from the listing text only.

## 1. Scoring (5 equally weighted criteria)

| Axis | Score | Notes |
|---|---|---|
| Technological Implementation (tiebreaker) | 4 | Real PayPal sandbox Orders via direct REST (AUTHORIZE, then capture or void), deterministic policy with provenance checks, and an LLM inspector over a regex backstop. The PayPal agent toolkit is not used: its `create_order` hardcodes CAPTURE (SPIKE.md). |
| Design | 4 | React + Tailwind + AG Grid decision log, plus a red/amber/green verdict UI with the injected text highlighted. The 4 depends on doing the premium polish. |
| Potential Impact | 4 | Survey data shows the demand: 61% want limits, 59% want approval checkpoints (Nuvei). But Visa, Mastercard, and Stripe already put limits at the network/token layer (see below), so judges may ask why this needs to be a separate layer. |
| Innovation / Idea | 3 | Spend caps plus approval are crowded. Prompt-injection detection plus spend caps also exists (CogniWall). What remains open is the combination on PayPal: authorize-hold, then human capture, with injection provenance. |
| Presentation | 5 | Strong demo: a poisoned page tries "buy 10 gift cards" and gets blocked with the text highlighted, then a normal $30 order goes authorize, approve, capture with a visible sandbox order ID. It fits in under 3 minutes. |

Penalties: feasibility 0 (TS/React/LLM APIs are within the builder's skills). Time 0, because it ships by Nov 12 if scope holds, but see the risks.
**Total: 20 / 25.** Recommendation: proceed, but only with the differentiators in section 3. Without them the Innovation score falls to 2.

Risk flags:
- The UGREEN R1 deadline (Nov 15) overlaps the build window, so the solo builder's time is split.
- Resolved on day 1: the toolkit has no AUTHORIZE support, so all PayPal calls are direct REST.
- **Name collision:** an "AgentGuard Spend" plugin already exists for the Hermes agent (found in search 1). Rename before submitting, e.g. "HoldFast" or "Escrow-for-Agents".
- An LLM inspector can produce false positives and add latency in the live demo. Cache a deterministic fallback.

## 2. Prior work

| Name | URL | Overlap | What AgentGuard does differently |
|---|---|---|---|
| CogniWall | https://pypi.org/project/cogniwall/0.1.0/ | Deterministic checks + LLM checks, prompt injection, spend caps. The closest match. | A library, not tied to PayPal. AgentGuard adds the authorize-hold/capture/void money flow and a per-call decision ledger. |
| SpendShield | https://pypi.org/project/spendshield/ , https://enterprisedna.co/directories/mcp/felixpg13-glitch-spendshield , https://aiindigo.com/blog/spendshield-deep-dive-technical-review | ALLOW/APPROVAL/DENY, budgets, merchant lists, sits between the agent and the gateway. | No injection inspector is listed and it isn't PayPal-specific. AgentGuard holds funds through a PayPal authorization instead of just blocking. |
| razorpay-mcp-guard | https://dev.to/junter1989kai/a-stranger-on-reddit-suggested-a-guardrail-for-my-payment-mcp-servers-it-shipped-to-30-countries-26en | MCP middleware in front of a PSP's MCP tools: caps, category allowlist, approval over threshold, hash-chained audit log. Architecturally almost the same pattern. | Razorpay, not PayPal. No LLM injection check. |
| SpendVeto | https://glama.ai/mcp/servers/a0pkyog7vk | Policy + human approval + budget caps + kill switch + burst detector. | Built for paid endpoints/x402, no shopping-agent injection check. |
| SpendNod | https://skillselion.com/mcp/tool/io.github.gstack-ds/spendnod | Hosted MCP spend limits, blocklists, mobile approval. | Hosted/paid. No injection provenance. |
| Fidacy | https://hunted.space/product/fidacy | MCP server checks payments against a signed mandate before money moves. | Mandate only. No content-injection inspector, no PayPal hold. |
| Sardis | https://pypi.org/project/sardis/ | Policy firewall validates each transaction. | Generic; no PayPal authorize flow. |
| @deepfirstsearch/agent-pay | https://socket.dev/npm/package/@deepfirstsearch/agent-pay | Policy outside the model + prompt-injection guards. | x402/crypto, not PayPal. |
| AgentGuard Spend (Hermes plugin) | named in search 1 results; exact URL not isolated (search returned https://www.producthunt.com/posts/1179521 among others, unverified which) | Same name. Local spend caps + signed audit logs. | Name clash; rename. |
| Agent Control | https://mcpservers.org/de/servers/agent-control-net-llms-txt | Approval inbox for over-limit payments. | Crypto wallets only. Search notes say it can be bypassed if the agent skips the check. |
| AEGIS Guardrails (lablab hackathon) | https://lablab.ai/ai-hackathons/agentic-commerce-on-arc/blockbears/aegis-guardrails-for-agentic-commerce | Hackathon entry: per-tx/daily caps, approve/reject, audit trail. | On-chain vault. No injection inspector, no PayPal. |
| Countersign (lablab hackathon) | https://lablab.ai/ai-hackathons/nativebuilder-build-without-limits/countersign/countersign | Dual limits (operator + card network); auto-approve only when both agree, otherwise human. | No injection detection. |
| Allowance (YC) | https://www.ycombinator.com/launches/QS4-allowance-virtual-cards-for-ai-agents | One-time virtual cards with limits and merchant restrictions. | Card-issuing product; no content inspection. |
| Mastercard Agent Pay | https://eco.com/support/en/articles/14845483-mastercard-agent-pay-explained | Agentic Tokens with per-session and per-merchant limits at the network level. | AgentGuard is the app/agent layer: it catches injected intent before any token is used. |
| Visa Intelligent Commerce | https://www.digitalcommerce360.com/2025/05/06/visa-mastercard-ai-agentic-commerce/ , https://stellagent.ai/insights/visa-openai-agentic-commerce-partnership | User-set spending limits, allowed merchant categories, approval requirements. | Network rules can't tell whether a $30 in-limit purchase came from a poisoned page. AgentGuard checks provenance. |
| Stripe ACP / Shared Payment Tokens, Stripe agent toolkit | https://www.mindstudio.ai/blog/stripe-agentic-commerce-suite-ai-agent-payments , https://growwstacks.com/blog/teach-ai-agents-to-pay-with-agentic-commerce-protocol/ , https://www.deeplearning.ai/the-batch/stripe-builds-ecommerce-agent-toolkit-for-ai-to-securely-spend-money | Tokens carry max amount, currency, expiry. | Stripe, not PayPal; amount-scoped only. |
| Nevermined spend mandates | https://nevermined.ai/blog/ai-agent-card-delegation | "Spend mandate" per user for agents. | Third-party platform; no PayPal hold or injection check. |
| PayPal | (no primary source found in 5 searches) | Unknown whether PayPal's Agent Toolkit or agentic-commerce products ship built-in spend mandates. | **Gap in this check.** Read PayPal developer docs for agent toolkit/agentic commerce before claiming that PayPal lacks this. |

### Verdict: **partially explored, leaning crowded**
- Spend caps, allowlists, human approval, and audit logs for agents are **crowded**. There are 10+ small MCP/OSS projects plus network-level controls from Visa, Mastercard, and Stripe.
- Prompt injection plus spend caps in one tool exists (CogniWall, agent-pay).
- I found nothing combining (a) a PayPal Orders authorize-hold with capture or void on human tap and (b) an injection inspector that cites the source text. That is absence of evidence from 5 searches, not proof. Do **not** call it "novel" in the pitch. Say "first PayPal-native…" only after checking PayPal docs.

## 3. Differentiators to add

1. **Provenance taint, not just an LLM judge.** Tag every token of fetched page/tool content as untrusted. Block (deterministically) any payment argument (merchant, amount, quantity, item) that can't be traced to the user's own request. The LLM inspector becomes a second opinion. In the UI, show the exact span the bad argument came from. This answers "Visa limits already exist": a $30 in-limit purchase triggered by a poisoned page still passes network limits but fails here.
2. **"Money held, not moved": PayPal authorize-hold as the safety primitive.** Every allowed purchase is an AUTHORIZE order with a live "$X at risk / $0 captured" counter. It auto-voids on reject or timeout, and one tap captures it. No listed competitor uses PSP authorization holds as the approval mechanism; they block or issue cards.
3. **Measured red-team scorecard in AG Grid.** Ship a corpus of about 15 poisoned pages (hidden text, alt-text, review injection, unicode-smuggled, price-bait) and about 20 benign tasks. Run the agent with and without the guard and show "attacks blocked X/15, false holds Y/20, median added latency Z ms" as a sortable AG Grid table in the app and video. Hard numbers help with the Technological Implementation tiebreaker and the AG Grid sponsor prize.
