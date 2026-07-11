# AGENTS.md — Guide for AI Coding Agents

## Project Overview

**formatsql-lvh** is a small browser-based SQL formatter for the Google Sheets
query integration in the [`lvh-etl`](https://github.com/honeybyhomo/lvh-etl)
repo. Paste a query, toggle transforms, click the output to copy.

- **Live:** https://formatsql.lvh.dev
- **Type:** static SPA (Vue 3) — **no backend**, runs entirely client-side.
- **Why it exists:** the GS query sheets use `{{ref|fmt}}` placeholders and
  single-cell multi-statement queries (see `lvh-etl` →
  `docs/13 GOOGLE_SHEETS_QUERY_API.md`). This tool compacts/varibalizes/
  simplifies those queries.

## Tech Stack & Key Decisions

- **Vue 3** with `<script setup>`, **plain JavaScript** (no TypeScript yet —
  adopt later if the app grows). No extra UI framework.
- **Vite 6** for dev/build. Output is static files in `web/dist/`.
- **Caddy** (`caddy:alpine`) serves the static files on `:80` (plain HTTP).
  **Traefik** terminates TLS in front. Caddy's own auto-HTTPS is intentionally
  not used (`:80` site address) — Traefik owns TLS.
- **Independence from US vendors** is a hard constraint → self-hosted on the NAS
  (no Cloudflare Pages / Vercel / Netlify). Cloudflare is used for **DNS only**
  (gray cloud / DNS-only), so Traefik's Let's Encrypt challenge isn't intercepted.
- **Naming convention:** `xxx-lvh` → repo/stack/container/service/image are all
  `formatsql-lvh`. The hostname is `formatsql.lvh.dev`.
- **One Caddy per static site** (each site is its own repo + Dockhand stack).
  Backend services (like ETL) serve themselves and need no Caddy.

## Repo Layout

```
formatsql-lvh/
  AGENTS.md             this file
  README.md
  web/                  the Vue app (Dockhand build context)
    src/
      App.vue            main UI (two panes + options + click-to-copy)
      lib/prettify.js    PURE transform logic (shared with the CLI) ← single source of truth
      main.js            Vue bootstrap
      styles.css         theme + --font-mono stack
    index.html
    vite.config.js
    package.json
    Dockerfile           node:22 build stage -> caddy:alpine runtime
    Caddyfile            :80 { root /srv; try_files SPA fallback; file_server }
    compose.yaml         Dockhand stack (Traefik labels -> formatsql.lvh.dev)
    .dockerignore / .gitignore
  tools/
    prettify-sql.mjs     CLI: reads/writes macOS clipboard; imports ../web/src/lib/prettify.js
```

## The Transform Logic (`web/src/lib/prettify.js`)

Pure functions, no Node-specific imports → safe for the browser. Shared by the
Vue app and the CLI. **Change transforms here once; both surfaces update.**

- `splitStatements(sql)` — quote-aware split on `;`.
- `compactStatement(stmt)` — collapse whitespace (quote-aware), one line.
- `simplifyDateFormat(stmt)` — `DATE_FORMAT(x,'%Y-%m-%d')` → `DATE(x)`
  (paren/quote-aware, word-boundary guarded; only the exact `%Y-%m-%d` format).
- `variabilize(statements, threshold)` — hoist `{{ref|fmt}}` used ≥ threshold
  times into `SET @var = …;` (snake_case var name from the ref).
- `prettify(sql, opts)` — orchestrator. `opts: { compact, variabilize,
  variabilizeAll, simplifyDateFormat }`. Note: locals are named `do*` to avoid
  shadowing the transform functions of the same name.

All transforms are quote- **and** paren-aware, so `;`, `DATE_FORMAT`, and
whitespace inside string literals are never touched.

## Build / Dev Commands

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # outputs static files to web/dist/
npm run preview    # serve the production build locally
```

CLI (clipboard in/out):

```bash
node tools/prettify-sql.mjs --all        # compact + variabilize + simplify-dateformat
node tools/prettify-sql.mjs --compact    # just compact
```

## Verification (before marking work done)

- `cd web && npm run build` succeeds and produces `dist/`.
- `node --check` on any changed `.js`/`.mjs`.
- Exercise the transforms via the CLI on a sample containing `{{x|date}}` twice
  + a `DATE_FORMAT(...)`, plus edge cases (string literals, `XDATE_FORMAT(`
  word boundary, non-`%Y-%m-%d` formats must be left alone).

## UI Conventions (for upcoming options)

The user plans to add many more options. Follow this control-per-type pattern:

- **Checkboxes** → independent on/off transforms (`compact`, `variabilize`, …).
- **Radio buttons / dropdown** → mutually-exclusive *styles* (e.g. output mode).
- **Buttons** → one-shot actions and presets (`All`, `Reset`, `Copy`).
- Group options with section headers; persist selection + last input to
  `localStorage` (already implemented for the current set).
- Transform runs **live** (debounced `watch` on input + options).

## Font

Currently a generic monospace stack (`--font-mono` in `web/src/styles.css`). To
use a self-hosted Nerd Font: drop the `.woff2` in `web/src/assets/`, add an
`@font-face` block in `styles.css`, and put its family name first in
`--font-mono`. (Compare fonts at programmingfonts.org — a Nerd Font is just the
base font + icon glyphs, so pick by base letterform.)

## Deployment

Deployed as a **Dockhand git stack** (not created via API; use the Dockhand UI):

- **Repo:** `honeybyhomo/formatsql-lvh`
- **Compose path:** `web/compose.yaml`
- **Build on deploy:** Yes
- **Push webhook:** GitHub `push` → `https://dockhand.cloudbyhomo.dk/api/git/stacks/<ID>/webhook`

Infrastructure facts:

- External network `traefik` (shared with ETL and other `*.lvh.dev` services).
- Traefik router rule `Host(\`formatsql.lvh.dev\)` on `websecure`, TLS via the
  `letencrypt-lvh` cert resolver, load-balancer port `80` (Caddy).
- DNS `formatsql.lvh.dev` → `91.229.203.132` (NAS) on Cloudflare, **DNS-only**.

> **Webhook 504 timeouts are expected** for build-on-deploy stacks (GitHub's
> 10s window); the build runs asynchronously regardless. Verify via the Dockhand
> deploy job, not the webhook delivery status.

## Workflow

- **Work on a feature branch**, not `main` (PR-based workflow).
- Keep commits conventional (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).
- The pure transform logic stays in one place (`web/src/lib/prettify.js`); do
  not duplicate it between the app and the CLI.
