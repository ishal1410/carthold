#!/usr/bin/env bash
# Make a public-ready copy of HEAD with NO git history (older commits leak a local path in a planning note).
# Never pushes. Usage:
#   bash scripts/publish-clean.sh --dry-run     # export + scan only, then delete the copy
#   bash scripts/publish-clean.sh [OUT_DIR]     # export + scan + one fresh local commit in OUT_DIR
set -euo pipefail

DRY=0
[ "${1:-}" = "--dry-run" ] && { DRY=1; shift; }
REPO=$(git rev-parse --show-toplevel)
OUT=${1:-$(mktemp -d)/carthold-public}
[ -e "$OUT" ] && { echo "refusing: $OUT already exists" >&2; exit 1; }
[ -n "$(git -C "$REPO" status --porcelain)" ] && echo "warning: uncommitted changes are NOT included (exporting HEAD only)" >&2

mkdir -p "$OUT"
git -C "$REPO" archive --format=tar HEAD | tar -x -C "$OUT"
echo "exported HEAD $(git -C "$REPO" rev-parse --short HEAD) -> $OUT"

# --- scan: every check must find nothing ---
fail=0
check() { # name, grep -E pattern, extra grep flags
  local hits rc=0
  hits=$(grep -rnIE $3 -e "$2" "$OUT") || rc=$?
  [ $rc -gt 1 ] && { echo "scan error in $1 (grep exit $rc)" >&2; exit 2; }
  if [ -n "$hits" ]; then echo "FAIL $1:"; echo "$hits" | head -20; fail=1; else echo "ok   $1"; fi
}
check "local paths"   "[A-Za-z]:[\\/]+Users|App[D]ata${USERNAME:+|$USERNAME}${USER:+|$USER}" -i  # [D] so this line doesn't match itself
check "private keys"  '-----BEGIN [A-Z ]*PRIVATE KEY'     ''
check "api keys"      'AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{36}|A21AA[A-Za-z0-9_-]{20,}' ''
check "secret values" '(SECRET|API_KEY|CLIENT_ID|TOKEN|PASSWORD)[A-Z_]*[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9_\-]{16,}' ''
# emails: allow placeholder/no-reply domains, plus the fictional attacker address in web/src/data/attacks/corpus.json
emails=$(grep -rnIoE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$OUT" \
  | grep -viE '@(example\.(com|org|net)|users\.noreply\.github\.com|noreply\.|giftlane-deals\.biz)' || true)
if [ -n "$emails" ]; then echo "FAIL emails:"; echo "$emails" | head -20; fail=1; else echo "ok   emails"; fi
envs=$(find "$OUT" -name '.env*' ! -name '.env.example')
if [ -n "$envs" ]; then echo "FAIL .env files:"; echo "$envs"; fail=1; else echo "ok   .env files"; fi

if [ $fail -ne 0 ]; then echo "scan FAILED; fix in the repo, commit, re-run. Copy left at $OUT"; exit 1; fi
echo "scan clean"

if [ $DRY -eq 1 ]; then rm -rf "$OUT"; echo "dry run: copy deleted, nothing committed"; exit 0; fi

# One squashed commit, same author identity as the source repo (GitHub noreply email).
NAME=$(git -C "$REPO" config user.name); EMAIL=$(git -C "$REPO" config user.email)
git -C "$OUT" init -q -b main
git -C "$OUT" add -A
git -C "$OUT" -c user.name="$NAME" -c user.email="$EMAIL" commit -q -m "CartHold: initial public release"
echo "committed $(git -C "$OUT" rev-parse --short HEAD) as $NAME <$EMAIL> in $OUT"

cat <<NEXT

Next steps (manual, nothing was pushed):
  cd "$OUT"
  git log --stat | head            # eyeball it
  gh repo create carthold --public --source . --remote origin
  git push -u origin main
Then follow docs/DEPLOY.md to connect the new repo to Render.
Keep the original private repo (or delete it) - never push its history to the public remote.
NEXT
