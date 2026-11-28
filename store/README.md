# Family plan store

The week picker is a static site. A browser cannot write `choices/*.json` on
deed.page or GitHub Pages, which is why sharing used to depend on pasting a
`SYNC_WEEK` payload into chat.

This folder is a small Cloudflare Worker. It is the place a save actually
goes. Reads and writes are public. On 28 Nov 2026 Vikram chose that after
being told anyone who can reach the worker address can overwrite a week.
The page does not ask for a code. A random website still cannot write,
because the worker checks the browser `Origin`.

Live site to keep using: https://ishaan-week-picker.deed.page/  
GitHub Pages copy: https://vikramhemrajani.github.io/ishaan-week-picker/

## What Vikram does once

1. Install nothing global. The deploy script uses `npx wrangler@4`.
2. Log in once, in a browser you control:

   ```bash
   npx wrangler@4 login
   ```

3. From this folder:

   ```bash
   ./deploy.sh
   ```

   The script will:

   - refuse to run `wrangler login` itself
   - create a KV namespace called `PLANS` if `store/wrangler.toml` still has the placeholder id
   - deploy the worker
   - write the public `https://….workers.dev` URL into `STORE_API_URL` in `index.html`
   - not create or print a client secret

4. Commit `index.html` and `store/wrangler.toml`. The KV namespace id is not a secret.
5. Push `main` so GitHub Pages updates.
6. Republish deed.page (the URL Ishaan actually uses). From the repo root, with `~/.config/deed-page/token` present (mode 600):

   ```bash
   node scripts/publish-deed.mjs
   ```

   Dry run, no token needed, lists the files it would send:

   ```bash
   node scripts/publish-deed.mjs --dry-run
   ```

   The publish must include `index.html` and `js/family-store.js`. The script refuses to continue if `index.html` is missing from the file map. It sends `If-Match` when deed.page reports a current version.

7. Hard-refresh https://ishaan-week-picker.deed.page/ on each browser.

Editing the week saves to the store (about a second after the change, or immediately with **Save family plan**). Another browser, including one with empty localStorage or a hard refresh, loads that save when it opens the same week. An open browser also checks every 20 seconds and when the tab is focused. No code is entered.

## Secret names

| Name | Where it lives | In the public page? |
| --- | --- | --- |
| `STORE_API_URL` | `index.html`, public worker URL | Yes — it is not a secret |
| `SYNC_API_URL` | `index.html`, Apps Script URL for calendar drafts | Yes — still optional |
| `DEED_TOKEN` | `~/.config/deed-page/token`, used only by `scripts/publish-deed.mjs` | No |

Do not create a `.env` file for this. Week saves do not use a client secret.

## Checks

```bash
node --test test/
```

Local two-browser check, without Cloudflare:

```bash
node store/dev-server.mjs
```

Open http://127.0.0.1:8765/ , change a week, then open the same URL in a second browser profile. The second profile loads the save with no pasted payload and no code. This dev server is memory-only and is not the live store.

## API

- `GET /v1/health` — `writes` is true when the database is attached
- `GET /v1/weeks/YYYY-MM-DD` — public. `404` if that Monday has not been saved
- `PUT /v1/weeks/YYYY-MM-DD` — no client secret. Optional `If-Match` revision
- `GET /v1/progress` / `PUT /v1/progress` — same rule

Allowed browser origins: `https://ishaan-week-picker.deed.page`, `https://vikramhemrajani.github.io`, and `http://localhost` / `http://127.0.0.1` for the dev server. A random website cannot write, because the worker rejects its `Origin`. A direct request to the worker address can.

Calendar drafts are not part of this store. **Send to calendar** still saves the family plan here, then uses the Apps Script popup only when `SYNC_API_URL` is set. Until that is deployed, the button says the drafts were not written. The copyable `SYNC_WEEK` payload remains a fallback for that case. It is not required for another browser to see the plan.

## If a write is refused

- `403` — the browser origin is not one of the family sites.
- `409` — the other device saved first. **Load shared plan**, or **Save family plan** to replace it on purpose.
- The status line says the store URL is missing — `STORE_API_URL` is still empty. Finish the deploy and republish both hosts.
