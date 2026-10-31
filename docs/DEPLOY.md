# Deploying CartHold

The public repo is [ishal1410/carthold](https://github.com/ishal1410/carthold) and the Render service is `carthold`
(https://carthold.onrender.com).

There are two steps: publish a clean public repo, then deploy it to Render's free plan from `render.yaml`.
Nothing in this repo pushes or deploys on its own. You run every step below yourself.

## 1. Publish a clean public repo

Older commits contain a local file path in a planning note. That path is removed in HEAD but is still in the history,
so never push this repo's history to a public remote. Publish a copy of HEAD with no history instead:

```bash
bash scripts/publish-clean.sh --dry-run        # export HEAD and scan it, then delete the copy
bash scripts/publish-clean.sh ../carthold-public
```

The script exports `HEAD` with `git archive`, so uncommitted changes are left out. It then scans the copy for local
paths (Windows user-profile and app-data folders, the Windows username), email addresses, key-shaped strings and `.env` files, and exits
with an error if it finds any. If the scan is clean, it makes a single commit using your existing git identity (the GitHub noreply
email). It does not push. The script prints the next steps:

```bash
cd ../carthold-public
gh repo create carthold --public --source . --remote origin
git push -u origin main
```

## 2. Deploy on Render (free plan)

1. Go to https://dashboard.render.com, choose **New**, then **Blueprint**, and connect the public repo. Render reads `render.yaml`
   (rootDir `web`, `npm ci && npm run build`, `npm start`, Node 22).
2. Render asks for the `sync: false` values. Paste these:
   - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`: sandbox app at https://developer.paypal.com/dashboard/applications/sandbox
   - `GEMINI_API_KEY`: https://aistudio.google.com/apikey
   - `PUBLIC_ORIGIN`: leave it empty for now.

   These values are set by the Blueprint: `PAYPAL_ENVIRONMENT=SANDBOX`, `CLIENT_IP_HEADER=true-client-ip`, `TRUSTED_PROXY_HOPS=1`,
   `LIVE_RUNS_PER_DAY=60`, `SIMULATED_RUNS_PER_DAY=200`.

   `CLIENT_IP_HEADER=true-client-ip` is required on Render. Cloudflare sits in front of Render and sets `True-Client-IP`
   to the real client address. Render only appends to `X-Forwarded-For`, so a value the client sent survives there
   (a live check on 2026-10-30 got seven `201`s from seven spoofed `X-Forwarded-For` values). `TRUSTED_PROXY_HOPS` is
   only a fallback for when the named header is missing (see `clientIp` in `web/src/lib/run/limits.ts`).
3. Click **Apply** and wait for the first deploy. Then note the URL. With the service name `carthold` from `render.yaml` it is `https://carthold.onrender.com`
   (Render adds a suffix if that name is taken).
4. Open the service's **Environment** page, set `PUBLIC_ORIGIN` to that exact URL (https, no trailing slash) and save.
   Render redeploys. After that, POST routes accept only browser requests whose Origin equals this value.

### Verify

```bash
URL=https://carthold.onrender.com
curl -s -o /dev/null -w "%{http_code}\n" $URL/          # expect 200 (the first request after sleep can take ~1 min)
```

**Client IP check.** The limit is 6 runs per IP per 10 minutes. Send 7 simulated runs, each with a different
spoofed `X-Forwarded-For`:

```bash
for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w "%{http_code} " -X POST $URL/api/runs \
  -H "content-type: application/json" -H "x-forwarded-for: 10.0.0.$i" \
  -d '{"userRequest":"buy a mug","mode":"redteam"}'; done; echo
```

- The result should be `201 201 201 201 201 201 429`. The spoofed header was ignored and your real IP was rate-limited.
- If you get seven `201`s, the spoofed header is being trusted. Check that `CLIENT_IP_HEADER` is set to
  `true-client-ip` on the service's **Environment** page. Without it, the app falls back to `X-Forwarded-For`, which
  Render does not clean.
- `redteam` runs use a scripted agent and count against `SIMULATED_RUNS_PER_DAY`, not `LIVE_RUNS_PER_DAY`. A run
  starts as soon as it is created, and the clean mug retry makes real PayPal sandbox calls (no Gemini calls). The 6
  accepted runs cost that much.
- This test uses up your own run limit for 10 minutes.

Finally, open the site in a browser and run one **live** run end to end.

## Operating notes

- **Warm-up.** Free services sleep after about 15 minutes without traffic, and the next request takes about a minute to
  wake the service. Before a demo or a judging window, open the URL a minute or two ahead.
- **Quota.** `LIVE_RUNS_PER_DAY` caps Live runs (the Gemini agent plus PayPal sandbox calls) across all users per UTC
  day. After the cap is hit, users see a 429 and are offered the simulated run. `SIMULATED_RUNS_PER_DAY` (default 200)
  caps Simulated runs the same way, since each one can authorize a real sandbox order; past it, users are pointed
  to the recorded run at `/demo?fixture=1`. The counter is held in memory, so it resets when the service
  sleeps or redeploys. Lower the value if your Gemini free-tier quota is tight.
- **Single instance.** The rate limits are in-process, so keep the service at one instance.
- **Rollback.** In the Render dashboard, open **Events**, pick a previous deploy and choose **Rollback**. To take the app offline,
  open **Settings** and choose **Suspend**.
- **Rotating keys.** Change the value on the **Environment** page and Render redeploys. Never commit `.env.local`.
