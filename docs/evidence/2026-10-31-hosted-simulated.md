# Hosted Simulated runs, 2026-10-31 (public commit 2f01fad)

The default Simulated run (scripted compromised agent, regex inspector only, real PayPal sandbox) on https://carthold.onrender.com:

- Run `cd9b6339`: row d1 "Basecamp Enamel Mug + Trail Coffee Kit" $49 blocked (inspector quote of the hidden Northpine note, not traceable). Row d2 mug $30 held: order `6V807237T7886145S`, authorization `0WT19176CG022501X`. Left undecided to exercise the 5-minute auto-void.
- Run `af8525a3`: same block, then d2 held and approved with the owner token: order `4A157966EJ9983231`, authorization `52932134RR4719937`, capture `7US41528DU284244U`.

## Approve with PayPal, hosted app (public commit 131d234), 2026-10-31 23:07Z

Default Simulated mug run on https://carthold.onrender.com/demo: the $49 hijacked order was blocked, the clean $30 mug order waited for PayPal approval, a sandbox buyer approved it in the PayPal sandbox popup, CartHold authorized it, and the owner clicked Release.
Confirmed through the PayPal API (not the UI): order `09G61688HE9076328` COMPLETED, payment_source `paypal`, payer `sb-pdvv053579478@personal.example.com` (sandbox personal account), authorization `6RL97719569903517`, capture `4854706228667701D` COMPLETED $30.00 USD, webhook event `WH-82670432NR243183U-11M2746516512733B`.

Pre-deploy hold check: authorization `46F94815H01103225` (run `50ce39e7`) was VOIDED at 22:55:32Z, one second after its own 5-minute expiry, so the old instance's timer voided it. The SIGTERM shutdown void is still not proven live.

## Note on the inspector (2026-11-01)

Since public commit `796d21c` ("Gemini inspector on the default demo"), Simulated runs call the Gemini inspector and fall back to the regex inspector if Gemini fails (`web/src/lib/run/session.ts` line 232, test "m9/S1" in `run.test.ts`). The agent itself is still scripted. The "regex inspector only" wording at the top of this file describes the runs on earlier commits (`2f01fad`, `131d234`).

## Video take (2026-11-01)

The PayPal capture from the v2 video take, checked on 2026-11-01 with read-only GETs against the PayPal sandbox API (`/v2/payments/captures/{id}` and `/v2/checkout/orders/{id}`), not read off the UI:

- Capture `5YF9590079513694P` (the take used in the final video, recorded 2026-11-01 ~03:29 local): COMPLETED, $30.00 USD, created 2026-11-01T08:29:39Z; order `5PD267708S917934F` COMPLETED, intent AUTHORIZE, authorization CAPTURED. Checked 2026-11-01 with read-only GETs.
- Capture `0KD47588Y6087961C`: COMPLETED, $30.00 USD, created 2026-11-01T07:07:57Z.
- Order `6NY58843E6166480D`: COMPLETED, intent AUTHORIZE, $30.00 USD, payment_source `paypal`, payer `sb-pdvv053579478@personal.example.com` (sandbox personal account).
- Authorization `0DX83959LE132832S`: CAPTURED. The capture's related ids point back to this order and authorization.
