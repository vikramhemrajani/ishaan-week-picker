#!/usr/bin/env bash
# Deploy the family plan store (Cloudflare Worker + KV) and write the public
# worker URL into ../index.html as STORE_API_URL.
#
# Does not git push, does not publish deed.page, and does not run wrangler login.
# The family code is read from a local file and stored as the Worker secret
# FAMILY_SYNC_KEY. It is never printed and never written into the page.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
INDEX="$REPO_ROOT/index.html"
TOML="$ROOT/wrangler.toml"
FAMILY_KEY_FILE="${HOME}/.config/ishaan-week-picker/family-sync-key"
WRANGLER=(npx --yes wrangler@4)

log() { printf '%s\n' "$*"; }
die() { printf 'store/deploy.sh: %s\n' "$*" >&2; exit 1; }

if [[ ! -f "$FAMILY_KEY_FILE" ]]; then
  die "Missing $FAMILY_KEY_FILE (mode 600). Create the family code once, for example:
  umask 077
  mkdir -p \"${HOME}/.config/ishaan-week-picker\"
  openssl rand -base64 18 > \"$FAMILY_KEY_FILE\"
  chmod 600 \"$FAMILY_KEY_FILE\"
Tell Ishaan that code. The same file is used if you later deploy apps-script."
fi

# Refuse to continue if the file is empty. Do not print the value.
if [[ ! -s "$FAMILY_KEY_FILE" ]]; then
  die "Family code file is empty: $FAMILY_KEY_FILE"
fi

if ! "${WRANGLER[@]}" whoami >/dev/null 2>&1; then
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

log "Setting Worker secret FAMILY_SYNC_KEY (value is not printed)…"
# stdin only — the code must not appear on the process command line.
"${WRANGLER[@]}" secret put FAMILY_SYNC_KEY < "$FAMILY_KEY_FILE"

log "Deploying the worker…"
set +e
DEPLOY_OUT="$("${WRANGLER[@]}" deploy 2>&1)"
DEPLOY_STATUS=$?
set -e
# Scrub the family code if a tool echoed it. The value is not printed.
DEPLOY_TMP="$(mktemp)"
chmod 600 "$DEPLOY_TMP"
printf '%s\n' "$DEPLOY_OUT" > "$DEPLOY_TMP"
set +e
python3 - "$FAMILY_KEY_FILE" "$DEPLOY_TMP" "$DEPLOY_STATUS" << 'PY'
import pathlib, sys
code = pathlib.Path(sys.argv[1]).read_text().strip()
text = pathlib.Path(sys.argv[2]).read_text()
status = int(sys.argv[3])
if code:
    text = text.replace(code, "[redacted]")
sys.stdout.write(text)
if not text.endswith("\n"):
    sys.stdout.write("\n")
sys.exit(0 if status == 0 else status)
PY
PY_STATUS=$?
set -e
rm -f "$DEPLOY_TMP"
if [[ "$PY_STATUS" -ne 0 ]]; then
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
log "Worker URL written into index.html (STORE_API_URL). It is public. The family code was not."
log "Still to do by hand:"
log "  1. Commit index.html and store/wrangler.toml (the KV id is not a secret). Do not commit the family code."
log "  2. Push main so GitHub Pages updates: https://vikramhemrajani.github.io/ishaan-week-picker/"
log "  3. Republish https://ishaan-week-picker.deed.page/ with: node scripts/publish-deed.mjs"
log "     (needs ~/.config/deed-page/token). The file map must include index.html and js/family-store.js."
log "  4. On Ishaan's browser and on Dad's desktop: open the live site, press Family code…, enter the code once."
log "  5. Change the week and wait a moment, or press Save family plan. The other browser loads it on refresh."
log "General Timetable drafts are unchanged. They still need apps-script/deploy.sh when you want them."
