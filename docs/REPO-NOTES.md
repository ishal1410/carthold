# Repo notes

Start with [README.md](../README.md). It describes what the app does today and how to run it.

The other Markdown files in the repo root are working notes from the build. We kept them on purpose as an honest build log: they show what we planned, what we checked, and what review rounds found wrong along the way. Some of what they say was true when written and is out of date now.

| File | What it is |
|---|---|
| `BRIEF.md` | Hackathon facts quoted from the rules, builder constraints, and the product idea as first scoped. |
| `PLAN.md` | Build plan, day-by-day schedule and demo video beat sheet. The schedule is the original plan, not a record of what happened on each day. |
| `SPIKE.md` | Day-1 check of the PayPal agent toolkit and the AUTHORIZE flow, plus the verified sandbox ids. |
| `NOVELTY.md` | A short prior-work check (5 web searches, listing pages only). It is not a literature review. |
| `CONTRACT.md` | The interface the demo screen was built against: modes, default mandate, HTTP API. |
| `FINDINGS.md`, `FINDINGS-2.md`, `FINDINGS-3.md`, `FINDINGS-4.md` | Review rounds 1 to 4. Each lists the bugs found and the fix list for that round. A later round says which earlier items were fixed. |
| `docs/evidence/2026-10-29-live-runs.md` | Every PayPal sandbox id from the logged runs, with the file and line each one comes from. |

All PayPal ids in these files are sandbox ids. No real money moved.

Line references such as `guard.ts:300` or `FINDINGS-3.md:12` point at the commit the note was written against. Code keeps changing, so an older reference can drift; search for the quoted text if a line number no longer matches.
