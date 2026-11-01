# Repo notes

Start with [README.md](../README.md). It describes what the app does today and how to run it.

The files in [build-log/](build-log/) are working notes from the build. We kept them on purpose as an honest build log: they show what we planned, what we checked, and what review rounds found wrong along the way. Some of what they say was true when written and is out of date now.

| File | What it is |
|---|---|
| [`SPIKE.md`](build-log/SPIKE.md) | Day-1 check of the PayPal agent toolkit and the AUTHORIZE flow, plus the verified sandbox ids. |
| [`CONTRACT.md`](build-log/CONTRACT.md) | The interface the demo screen was built against: modes, default mandate, HTTP API. |
| [`evidence/2026-10-29-live-runs.md`](evidence/2026-10-29-live-runs.md) | Every PayPal sandbox id from the logged runs, with the file and line each one comes from. |

All PayPal ids in these files are sandbox ids. No real money moved.

Line references such as `guard.ts:300` point at the commit the note was written against. Code keeps changing, so an older reference can drift; search for the quoted text if a line number no longer matches.
