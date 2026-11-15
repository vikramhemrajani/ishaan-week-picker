#!/usr/bin/env bash
# Deploy the Ishaan week picker Apps Script web app and write SYNC_API_URL
# into ../index.html. Does not git push, does not publish to deed.page, and
# does not run clasp login.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
INDEX="$REPO_ROOT/index.html"
CLASPRC="${HOME}/.clasprc.json"
FAMILY_KEY_FILE="${HOME}/.config/ishaan-week-picker/family-sync-key"
DEED_TOKEN_FILE="${HOME}/.config/deed-page/token"

log() { printf '%s\n' "$*"; }
die() { printf 'deploy.sh: %s\n' "$*" >&2; exit 1; }

if [[ ! -f "$CLASPRC" ]]; then
  die "No ~/.clasprc.json — run 'clasp login' once as Vikram, then re-run this script. This script will not log clasp in."
fi

if ! command -v clasp >/dev/null 2>&1; then
  die "clasp is not on PATH. Install with: npm install -g @google/clasp"
fi

if [[ ! -f "$FAMILY_KEY_FILE" ]]; then
  die "Missing family key file at $FAMILY_KEY_FILE (mode 600). Generate one before deploy."
fi
if [[ ! -f "$DEED_TOKEN_FILE" ]]; then
  die "Missing deed token at $DEED_TOKEN_FILE (mode 600)."
fi
if ! command -v gh >/dev/null 2>&1; then
  die "gh is not on PATH; needed to read an already-available GitHub token. Do not mint a new PAT."
fi

# Read secrets into variables without printing them.
FAMILY_SYNC_KEY="$(tr -d '[:space:]' < "$FAMILY_KEY_FILE")"
DEED_TOKEN="$(tr -d '[:space:]' < "$DEED_TOKEN_FILE")"
# Already-available gh token only — never mint a new PAT here.
GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
if [[ -z "$FAMILY_SYNC_KEY" || -z "$DEED_TOKEN" || -z "$GITHUB_TOKEN" ]]; then
  die "One or more secrets were empty after reading local files / gh auth token."
fi

cd "$ROOT"

if [[ ! -f .clasp.json ]]; then
  die ".clasp.json is missing. Run: clasp create --title \"Ishaan week picker sync\" --type webapp --rootDir .   then re-run deploy.sh. Commit the resulting .clasp.json (it is not a secret)."
fi

log "Pushing Apps Script project…"
clasp push --force

# Script Properties are set below via clasp run. Values are not printed.
log "Setting Script Properties via clasp run (values are not printed)…"
# Temporary runner file is already in the pushed project: installPropertiesFromPayload_
# We pass properties through a local 600 file read by a node/python helper that
# calls clasp run without putting secrets on the argv of ps listings where possible.
export FAMILY_SYNC_KEY DEED_TOKEN GITHUB_TOKEN
python3 - << 'PY'
import json, os, subprocess, tempfile, pathlib, sys
payload = {
    "FAMILY_SYNC_KEY": os.environ["FAMILY_SYNC_KEY"],
    "DEED_TOKEN": os.environ["DEED_TOKEN"],
    "GITHUB_TOKEN": os.environ["GITHUB_TOKEN"],
}
# clasp run --params takes JSON. Write it to a mode-600 temp file and pass
# the file contents as a single argument without echoing.
fd, name = tempfile.mkstemp(prefix="ishaan-props-", suffix=".json")
os.close(fd)
path = pathlib.Path(name)
path.write_text(json.dumps([payload]))
path.chmod(0o600)
try:
    # --non-interactive if supported; ignore unknown flags via a plain run first.
    cmd = ["clasp", "run", "installPropertiesFromPayload_", "--params", path.read_text()]
    proc = subprocess.run(cmd, cwd=os.environ.get("PWD"), capture_output=True, text=True)
    # Redact anything that might have bounced back.
    def scrub(s):
        out = s or ""
        for v in payload.values():
            if v:
                out = out.replace(v, "[redacted]")
        return out
    sys.stdout.write(scrub(proc.stdout))
    if proc.returncode != 0:
        sys.stderr.write(scrub(proc.stderr))
        sys.stderr.write(
            "\nclasp run could not set Script Properties automatically.\n"
            "Set them by hand in the Apps Script editor (Project Settings → Script properties)\n"
            "from the local secret files listed in README.md, then re-run deploy.sh or continue with clasp deploy.\n"
        )
        # Do not fail the whole deploy — properties can be set manually.
        sys.exit(0)
finally:
    try:
        path.unlink()
    except OSError:
        pass
PY

log "Deploying web app (execute as you, access Anyone)…"
# Prefer modern clasp flags; fall back to a documented manual step.
DEPLOY_OUT=""
if DEPLOY_OUT="$(clasp deploy --description "Ishaan week picker sync" 2>&1)"; then
  printf '%s\n' "$(printf '%s\n' "$DEPLOY_OUT" | sed -E 's/([A-Za-z0-9_-]{20,})/[id]/g')"
else
  log "clasp deploy reported a problem. Create the web-app deployment in the Apps Script editor:"
  log "  Deploy → New deployment → Type: Web app"
  log "  Execute as: Me"
  log "  Who has access: Anyone"
  log "Then paste the web-app URL into SYNC_API_URL in index.html (the clearly marked constant)."
  exit 1
fi

# Resolve the /exec URL
WEB_URL="$(clasp deployments 2>/dev/null | grep -Eo 'https://script.google.com/macros/s/[^/[:space:]]+/exec' | tail -n1 || true)"
if [[ -z "$WEB_URL" ]]; then
  WEB_URL="$(printf '%s\n' "$DEPLOY_OUT" | grep -Eo 'https://script.google.com/macros/s/[^/]+/exec' | tail -n1 || true)"
fi
if [[ -z "$WEB_URL" ]]; then
  die "Could not determine the web-app URL. Copy it from the Apps Script deployments list into SYNC_API_URL in index.html."
fi

# Patch the clearly marked constant in index.html. Do not touch anything else.
python3 - "$INDEX" "$WEB_URL" << 'PY'
import pathlib, sys, re
index = pathlib.Path(sys.argv[1])
url = sys.argv[2].strip()
text = index.read_text()
pat = re.compile(r'(const SYNC_API_URL = )(["\'])([^"\']*)\2')
if not pat.search(text):
    sys.exit("deploy.sh: could not find the SYNC_API_URL constant in index.html")
new, n = pat.subn(lambda m: m.group(1) + m.group(2) + url + m.group(2), text, count=1)
if n != 1:
    sys.exit("deploy.sh: expected to replace exactly one SYNC_API_URL")
index.write_text(new)
print("Updated SYNC_API_URL in index.html")
PY

log ""
log "Deploy steps that finished: clasp push, Script Properties (if clasp run succeeded), clasp deploy, SYNC_API_URL patch."
log "Still to do by hand (this script will not do them):"
log "  1. Authorise Calendar + external-request scopes if this is the first deploy."
log "  2. Confirm the web app is 'Execute as: Me' and 'Who has access: Anyone'."
log "  3. Publish the updated index.html to https://ishaan-week-picker.deed.page/ (complete file map)."
log "  4. Commit and push main so GitHub Pages stays in sync."
log "  5. Optional: add a time-driven trigger for scheduledRefreshLocks."
log "Web-app URL written into index.html (SYNC_API_URL)."
