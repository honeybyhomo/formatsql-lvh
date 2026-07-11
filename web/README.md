# FormatSQL

Browser UI for the SQL prettifier at **formatsql.lvh.dev**. Paste a query on
the left, choose your layout / alignment / case / alias / variable options,
click the output to copy.

Shares its pure transform logic with the CLI — both import `src/lib/prettify.js`.

## Develop

```bash
cd web
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # outputs static files to dist/
npm run preview  # serve the production build locally
```

## Deploy

Deployed as a Dockhand Git stack (build context = this directory) behind
Traefik at `formatsql.lvh.dev`. See `compose.yaml`.

## Font

Uses a monospace font stack (see `src/styles.css`). To use a self-hosted Nerd
Font, drop its `.woff2` in `src/assets/`, add an `@font-face` block in
`src/styles.css`, and put its family name first in `--font-mono`.
