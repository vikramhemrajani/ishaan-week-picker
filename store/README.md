# Family plan store

The week picker is a static site. A browser cannot write `choices/*.json` on
deed.page or GitHub Pages, which is why sharing used to depend on pasting a
`SYNC_WEEK` payload into chat.

This folder is a small Cloudflare Worker. It is the place a save actually
goes. Reads are public. Writes need the family code, checked on the worker,
never put in the page.

Live site to keep using: https://ishaan-week-picker.deed.page/  
GitHub Pages copy: https://vikramhemrajani.github.io/ishaan-week-picker/

## What Vikram does once

1. Install nothing global. The deploy script uses `npx wrangler@4`.
2. Log in once, in a browser you control:

   ```bash
   npx wrangler@4 login
   ```

3. Create the family code if it does not already exist. This is the code
   Ishaan types into **Family code…**. It is the same file the Apps Script
   deploy reads, so there is one code for the family.

   ```bash
   umask 077
   mkdir -p ~/.config/ishaan-week-picker
   openssl rand -base64 18 > ~/.config/ishaan-week-picker/family-sync-key
   chmod 600 ~/.config/ishaan-week-picker/family-sync-key
   ```

   Open the file, copy the code, and give it to Ishaan. Do not commit it,
   paste it into `index.html`, or put it in chat logs you do not control.

4. From this folder:

   ```bash
   ./deploy.sh
   ```

   The script will:

   - refuse to run `wrangler login` itself
   - create a KV namespace called `PLANS` if `store/wrangler.toml` still has the placeholder id
   - set the Worker secret **`FAMILY_SYNC_KEY`** from the file above, without printing it
   - deploy the worker
   - write the public `https://….workers.dev` URL into `STORE_API_URL` in `index.html`

5. Commit `index.html` and `store/wrangler.toml`. The KV namespace id is not a secret. The family code is.
6. Push `main` so GitHub Pages updates.
7. Republish deed.page (the URL Ishaan actually uses). From the repo root, with `~/.config/deed-page/token` present (mode 600):

   ```bash
   node scripts/publish-deed.mjs
   ```

   Dry run, no token needed, lists the files it would send:

   ```bash
   node scripts/publish-deed.mjs --dry-run
   ```

   The publish must include `index.html` and `js/family-store.js`. The script refuses to continue if `index.html` is missing from the file map. It sends `If-Match` when deed.page reports a current version.

8. Hard-refresh https://ishaan-week-picker.deed.page/ on each browser.
9. On Ishaan’s device and on Dad’s desktop, press **Family code…** and enter the code once in the box on the page. It is stored only in that browser, as `localStorage['ishaan-family-sync-key']`. Spaces and line breaks around the code are ignored. A rejected code is not asked for again on every edit; use **Family code…** to try again.

After that, editing the week saves to the store (about a second after the change, or immediately with **Save family plan**). Another browser, including one with empty localStorage or a hard refresh, loads that save when it opens the same week. An open browser also checks every 20 seconds and when the tab is focused.

## Secret names

| Name | Where it lives | In the public page? |
| --- | --- | --- |
| `FAMILY_SYNC_KEY` | Cloudflare Worker secret, set by `./deploy.sh` from `~/.config/ishaan-week-picker/family-sync-key` | No |
| `STORE_API_URL` | `index.html`, public worker URL | Yes — it is not a secret |
| `SYNC_API_URL` | `index.html`, Apps Script URL for calendar drafts | Yes — still optional |
| `DEED_TOKEN` | `~/.config/deed-page/token`, used only by `scripts/publish-deed.mjs` | No |

Do not create a `.env` file for this. Do not add the family code to GitHub.

## Checks

```bash
node --test test/
```

Local two-browser check, without Cloudflare:

```bash
FAMILY_SYNC_KEY='a-local-code' node store/dev-server.mjs
```

Open http://127.0.0.1:8765/ , enter `a-local-code` once, save a week, then open the same URL in a second browser profile. The second profile loads the save with no pasted payload. This dev server is memory-only and is not the live store.

## API

- `GET /v1/health` — no code
- `GET /v1/weeks/YYYY-MM-DD` — no code. `404` if that Monday has not been saved
- `PUT /v1/weeks/YYYY-MM-DD` — header `X-Family-Code`. Optional `If-Match` revision
- `GET /v1/progress` / `PUT /v1/progress` — same rule

Allowed browser origins: `https://ishaan-week-picker.deed.page`, `https://vikramhemrajani.github.io`, and `http://localhost` / `http://127.0.0.1` for the dev server. A random website cannot write, because the worker rejects its `Origin` and because it does not have the family code.

Calendar drafts are not part of this store. **Send to calendar** still saves the family plan here, then uses the Apps Script popup only when `SYNC_API_URL` is set. Until that is deployed, the button says the drafts were not written. The copyable `SYNC_WEEK` payload remains a fallback for that case. It is not required for another browser to see the plan.

## If a write is refused

- `401` — the family code does not match `FAMILY_SYNC_KEY`. The page forgets the rejected code and does not ask again on every edit. Enter it again with **Family code…**.
- `503` — the Worker secret was not set. Re-run `./deploy.sh`.
- `409` — the other device saved first. **Load shared plan**, or **Save family plan** to replace it on purpose.
- The status line says the store URL is missing — `STORE_API_URL` is still empty. Finish the deploy and republish both hosts.
