# Research Board Generator (demo)

Paste a research record (fixed JSON schema) → get a structured client research board, right there on the same page. Single-page app, pure static site — no backend, no build step, no API key.

## Files

- `index.html` — the whole app: a paste view and a board view live in the same document, toggled with JS
- `assets/app.js` — schema/validator + renderer + view controller + the YETI demo record
- `assets/style.css` — styles

## How it works

Paste a record matching the JSON schema (documented in the in-app "JSON schema" guide) and click Generate — the page parses it client-side and swaps the paste view for the board view (About box, Leadership grid with LinkedIn/email/source links, Milanote-style columns, color-coded decision box), no navigation, no new tab. "← New search" swaps back. The last generated board is kept in `localStorage`, so a page refresh restores it instead of dropping you back at a blank textarea.

The JSON schema is deliberately the same shape a real Airtable API response would take — see the in-app "For IT/Data" guide for the intended production architecture. The "Sync from Airtable" button simulates that call (fixed delay, loads the same YETI record) so the interaction is demonstrable before the real integration exists.

## Run locally

Needs to be served over `http://`, not opened via `file://` (it uses `localStorage`). From this folder:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Deploy to GitHub Pages

1. Push this folder's contents to a GitHub repo (either as the repo root, or under a `/docs` folder).
2. In the repo: **Settings → Pages → Build and deployment → Deploy from a branch**, pick the branch and the root (or `/docs`) folder.
3. GitHub gives you a `https://<user>.github.io/<repo>/` URL.

No secrets, no environment variables, nothing to configure.
