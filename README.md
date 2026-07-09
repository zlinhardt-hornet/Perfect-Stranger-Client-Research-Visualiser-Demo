# Research Board Generator (demo)

Paste research notes → get a structured client research board, right there on the same page. Single-page app, pure static site — no backend, no build step, no API key.

## Files

- `index.html` — the whole app: a paste view and a board view live in the same document, toggled with JS
- `assets/app.js` — parser + renderer + view controller
- `assets/style.css` — styles

## How it works

You paste notes and click Generate — the page parses the text client-side and swaps the paste view for the board view (About box, Leadership grid, Milanote-style columns, decision box), no navigation, no new tab. "← New search" swaps back. The last generated board is kept in `localStorage`, so a page refresh restores it instead of dropping you back at a blank textarea.

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
