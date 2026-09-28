# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Thunder SMS is a real-time chat app template for Cloudflare Workers. Each chat room is a [Durable Object](https://developers.cloudflare.com/durable-objects/) instance, addressed by a room ID in the URL. Users share a room URL to chat together; messages persist via the Durable Object SQL Storage API and are synchronized over WebSockets using [PartyKit](https://www.partykit.io/) (`partyserver` on the server, `partysocket` on the client).

## Commands

- `npm run dev` — start the local dev server (`wrangler dev`)
- `npm run check` — typecheck client (`src/client`) and server (`src/server`) separately, then do a `wrangler deploy --dry-run`; run this before considering a change complete
- `npm run deploy` — deploy to Cloudflare (`wrangler deploy`)
- `npm run types` — regenerate `src/server/worker-configuration.d.ts` from `wrangler.json` bindings (run after changing bindings in `wrangler.json`)

There is no test suite and no linter configured in this repo — `check` (typecheck + dry-run deploy) is the correctness gate.

The client bundle is not built by a normal npm script directly; it's built via the `build.command` in `wrangler.json` (esbuild), which `wrangler dev`/`deploy` invoke automatically: `esbuild src/client/index.tsx --bundle --splitting --format=esm --platform=browser --outdir=public/dist`.

## Architecture

The project has two independently-typechecked TypeScript programs sharing one file:

- `src/server/index.ts` — the Worker entrypoint and the `Chat` Durable Object class (extends `Server` from `partyserver`). Its own `tsconfig.json` includes Cloudflare Workers types and the generated `worker-configuration.d.ts`.
- `src/client/index.tsx` — the React SPA entrypoint, rendered into `public/index.html`'s `#root`. Its own `tsconfig.json` sets `jsx: react` and DOM libs.
- `src/shared.ts` — types and constants (`ChatMessage`, the `Message` discriminated union, and the `names` list used for random usernames) imported by both client and server. Both sub-tsconfigs extend the root `tsconfig.json`, which only includes this file.

Both `src/client/tsconfig.json` and `src/server/tsconfig.json` extend the root `tsconfig.json` — that's why `npm run check` typechecks them as two separate `tsc --project` invocations rather than one.

### Message flow

1. Client connects via `usePartySocket({ party: "chat", room })`, routed to the `Chat` Durable Object for that room name by `routePartykitRequest` in the Worker's `fetch` handler (falls back to `env.ASSETS.fetch` for static files/SPA routing).
2. On connect, `Chat.onConnect` sends the full message history as a `{ type: "all", messages }` payload.
3. Sending a message: the client optimistically appends it locally, then sends `{ type: "add", ...chatMessage }` over the socket.
4. `Chat.onMessage` rebroadcasts the raw message to all other connections, then persists `add`/`update` messages to the `messages` SQLite table via `saveMessage` (also updates the in-memory `messages` array, using message `id` to detect create vs. update).
5. Other clients receive the broadcast and reconcile it into their local `messages` state by `id` (add if not found, replace if found).

The `Message` union in `shared.ts` (`add` | `update` | `all`) is the entire wire protocol between client and server — when changing message shape, update it there and both `onMessage` handlers stay in sync via shared types.

### Cloudflare configuration (`wrangler.json`)

- `durable_objects.bindings` + `migrations.new_sqlite_classes` register the `Chat` class as a SQLite-backed Durable Object — the class name must match here and in `src/server/index.ts`.
- `assets` serves `./public` as static assets with SPA fallback (`not_found_handling: single-page-application`), so client-side routing (`react-router`'s `/:room` route) works on refresh/direct navigation.
- Uses `--experimental-json-config` (JSON wrangler config, not TOML) — always pass this flag when invoking `wrangler` directly outside the npm scripts.
