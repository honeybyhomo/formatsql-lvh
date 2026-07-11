# formatsql-lvh

Browser SQL formatter for Google Sheets — live at **formatsql.lvh.dev**.

Paste a query, toggle transforms (compact / variabilize `{{ref|fmt}}` / simplify
`DATE_FORMAT`), click the output to copy. Runs entirely client-side.

## Layout

- `web/` — the Vue 3 + Vite app (see [`web/README.md`](web/README.md) for dev/build)
- `tools/prettify-sql.mjs` — CLI version (reads/writes the macOS clipboard);
  shares the pure logic with the web app via `web/src/lib/prettify.js`

## Deploy

Deployed as a Dockhand Git stack (build context = `web/`) behind Traefik at
`formatsql.lvh.dev`. See `web/compose.yaml`.
