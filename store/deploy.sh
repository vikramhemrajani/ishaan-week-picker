#!/usr/bin/env bash
# Deploy the family plan store (Cloudflare Worker + KV) and write the public
# worker URL into ../index.html as STORE_API_URL.
#
# Does not git push, does not publish deed.page, and does not run wrangler login.
# Week writes no longer use a client secret. This script does not create,
# print, rotate, or delete a family-code file.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
INDEX="$REPO_ROOT/index.html"
TOML="$ROOT/wrangler.toml"
WRANGLER=(npx --yes wrangler@4)

log() { printf '%s\n' "$*"; }
die() { printf 'store/deploy.sh: %s\n' "$*" >&2; exit 1; }

WHOAMI_OUT="$("${WRANGLER[@]}" whoami 2>&1 || true)"
if printf '%s\n' "$WHOAMI_OUT" | grep -qi 'not authenticated'; then
  die "wrangler is not logged in. Once, as Vikram: npx wrangler@4 login
Then re-run store/deploy.sh. This script will not log in for you."
fi

cd "$ROOT"

if grep -q 'REPLACE_WITH_KV_NAMESPACE_ID' "$TOML"; then
  log "Creating KV namespace PLANS…"
  set +e
  CREATE_OUT="$("${WRANGLER[@]}" kv namespace create PLANS 2>&1)"
  CREATE_STATUS=$?
  set -e
  if [[ "$CREATE_STATUS" -ne 0 ]]; then
    printf '%s\n' "$CREATE_OUT" >&2
    die "wrangler kv namespace create failed."
  fi
  KV_ID="$(printf '%s\n' "$CREATE_OUT" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -n1)"
  if [[ -z "$KV_ID" ]]; then
    printf '%s\n' "$CREATE_OUT" >&2
    die "Could not read the KV namespace id. Paste it into store/wrangler.toml as the PLANS id (it is not a secret)."
  fi
  python3 - "$TOML" "$KV_ID" << 'PY'
import pathlib, sys
path, kv_id = sys.argv[1:]
file = pathlib.Path(path)
file.write_text(file.read_text().replace("REPLACE_WITH_KV_NAMESPACE_ID", kv_id, 1))
print("Wrote KV namespace id into store/wrangler.toml")
PY
fi

log "Deploying the worker…"
set +e
DEPLOY_OUT="$("${WRANGLER[@]}" deploy 2>&1)"
DEPLOY_STATUS=$?
set -e
printf '%s\n' "$DEPLOY_OUT"
if [[ "$DEPLOY_STATUS" -ne 0 ]]; then
  die "wrangler deploy failed."
fi

URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -n1 || true)"
if [[ -z "$URL" ]]; then
  die "Deploy finished but no workers.dev URL was found. Copy it into STORE_API_URL in index.html."
fi

python3 - "$INDEX" "$URL" << 'PY'
import pathlib, sys, re
index = pathlib.Path(sys.argv[1])
url = sys.argv[2].strip().rstrip("/")
text = index.read_text()
pat = re.compile(r'(const STORE_API_URL = )(["\'])([^"\']*)\2')
if not pat.search(text):
    sys.exit("store/deploy.sh: could not find const STORE_API_URL in index.html")
new, n = pat.subn(lambda m: m.group(1) + m.group(2) + url + m.group(2), text, count=1)
if n != 1:
    sys.exit("store/deploy.sh: expected to replace exactly one STORE_API_URL")
index.write_text(new)
print("Updated STORE_API_URL in index.html")
PY

log ""
log "Worker URL written into index.html (STORE_API_URL). It is public."
log "Week saves do not use a client secret."
log "Still to do by hand:"
log "  1. Commit index.html and store/wrangler.toml (the KV id is not a secret)."
log "  2. Push main so GitHub Pages updates: https://vikramhemrajani.github.io/ishaan-week-picker/"
log "  3. Republish https://ishaan-week-picker.deed.page/ with: node scripts/publish-deed.mjs"
log "     (needs ~/.config/deed-page/token). The file map must include index.html and js/family-store.js."
log "  4. Hard-refresh the live site. Edit a week. The other browser loads it on refresh."
log "General Timetable drafts are unchanged. They still need apps-script/deploy.sh when you want them."
