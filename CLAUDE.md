# BizElevate Self-Hosted Excalidraw

This is BizElevate's private fork of [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw). It tracks upstream and adds a self-hosting layer so we can run an internal collaborative whiteboard without Firebase or the Excalidraw Plus cloud.

## How this fork differs from upstream

- **`deploy/`** contains the production compose stack and runbooks:
  - `deploy/docker-compose.contabo.yml` — the VPS-contabo stack (SPA, oauth2-proxy, collab room, storage backend, Redis) behind the server's Caddy; site files in `deploy/caddy/`.
  - `deploy/docker-compose.yml` — the old VPS2 stack behind Traefik, kept until VPS2 is retired.
  - `deploy/AUTH.md` — Google OAuth gating via oauth2-proxy (internal `@bizelevate.net` only).
  - `deploy/STORAGE_API.md` — HTTP storage backend API contract and required env vars.
- **Firebase replaced by self-hosted HTTP storage.** The frontend adapter in `excalidraw-app/data/httpStorage.ts` points at `alswl/excalidraw-storage-backend` (Redis-backed) instead of Firebase. Encrypted blobs are still client-side AES-GCM; the backend is a dumb KV store.
- **Google sign-in via oauth2-proxy.** The public host `excalidraw.bizelevateai.com` is proxied through oauth2-proxy before the SPA is served. Collab and storage hosts are not gated because they only see encrypted blobs tied to room keys in URL fragments.

## Room and storage images (Node 24)

The collab room and storage backend are built from pinned upstream commits, not pulled as images.

- `deploy/room/` builds `excalidraw/excalidraw-room`, `deploy/storage/` builds `alswl/excalidraw-storage-backend`. Each has a Dockerfile (upstream commit in an ARG) plus its own `package.json` and `package-lock.json` that replace upstream's. Upstream `src/` is not patched.
- Images are tagged `excalidraw-room:<date>-node24` and `excalidraw-storage:<date>-node24` in `deploy/docker-compose.contabo.yml`; the `node:24-alpine` base is pinned by digest. To upgrade, bump the commit ARG, refresh the lockfile on Node 24 (`npm install --package-lock-only` in a `node:24-alpine` container), change the tag, then `docker compose build` and `up -d` for those two services. Stay on keyv 4 and @keyv/redis 2: later majors change how values are stored in Redis and old drawings would not load.
- `deploy/room/smoke.cjs` joins two clients to a room and checks a broadcast arrives: `node smoke.cjs http://127.0.0.1:<port>`.
- Do not run `redis-cli FLUSHALL`. Back up with `redis-cli SAVE` and copy the volume dump first.

## Deploy target

This stack moves from VPS2 to VPS-contabo. Until the cutover the live data is on VPS2: DNS for all three hosts points to VPS2 (72.62.64.204), which runs `deploy/docker-compose.yml` behind Traefik, and its Redis holds the drawings. The Mac mini never ran it; the mini plan in PR #1 is superseded.

On VPS-contabo the stack runs from `deploy/docker-compose.contabo.yml`. No ports are published: the server's `edge-caddy` reaches oauth2-proxy, the room and storage by container name on the external Docker network `edge`, with one site file per host in `deploy/caddy/` (copy them to the edge `sites/` folder; they `import common`). The SPA and Redis are on the internal network only, so the SPA is reachable only through the oauth2-proxy sign-in. Redis is capped at 200 MB with `noeviction`. Images are built on the server: `docker compose -f docker-compose.contabo.yml up -d --build`.

- `excalidraw.bizelevateai.com` -> `excalidraw-oauth2-proxy:4180` (Google sign-in, then the SPA)
- `excalidraw-collab.bizelevateai.com` -> `excalidraw-room:80` (websocket, `flush_interval -1`)
- `excalidraw-storage.bizelevateai.com` -> `excalidraw-storage:8080` (Caddy answers CORS for the SPA origin only)

Secrets: `deploy/env/oauth2-proxy.env` (gitignored) holds `OAUTH2_PROXY_CLIENT_ID`, `OAUTH2_PROXY_CLIENT_SECRET` and `OAUTH2_PROXY_COOKIE_SECRET`; it is rendered from Bitwarden, never edited by hand. Google OAuth setup is in `deploy/AUTH.md`, the storage API in `deploy/STORAGE_API.md`.

Redis data: Redis runs with `--appendonly yes`, so on start it reads only `appendonlydir/` and ignores a lone `dump.rdb` (the database comes up empty). To move data, copy the whole `/data` directory (AOF and RDB) with the writers stopped. To load only an RDB file, start Redis once with `--appendonly no`, run `redis-cli CONFIG SET appendonly yes`, wait for the rewrite to finish, then start normally. Both paths were tested from Redis 7.4 data into Redis 8.10.

## `VITE_APP_*` env vars (names only)

From tracked `.env.development` / `.env.production`:

- `VITE_APP_AI_BACKEND`
- `VITE_APP_BACKEND_V2_GET_URL`
- `VITE_APP_BACKEND_V2_POST_URL`
- `VITE_APP_COLLAPSE_OVERLAY`
- `VITE_APP_DEBUG_ENABLE_TEXT_CONTAINER_BOUNDING_BOX`
- `VITE_APP_DEV_DISABLE_LIVE_RELOAD`
- `VITE_APP_DISABLE_PREVENT_UNLOAD`
- `VITE_APP_ENABLE_ESLINT`
- `VITE_APP_ENABLE_PWA`
- `VITE_APP_ENABLE_TRACKING`
- `VITE_APP_FIREBASE_CONFIG`
- `VITE_APP_HTTP_STORAGE_BACKEND_URL` (production)
- `VITE_APP_LIBRARY_BACKEND`
- `VITE_APP_LIBRARY_URL`
- `VITE_APP_PLUS_APP`
- `VITE_APP_PLUS_EXPORT_PUBLIC_KEY`
- `VITE_APP_PLUS_LP`
- `VITE_APP_PORT`
- `VITE_APP_WS_SERVER_URL`

See `.env.development` and `.env.production` for values. Never commit `.env` files.

## Development commands

```bash
yarn install
yarn start              # excalidraw-app dev server
yarn test               # run app tests
yarn test:update        # update snapshots
yarn test:typecheck     # TypeScript check
yarn fix                # lint + format auto-fix
```

## Upstream-merge gotchas

- Keep our delta small. Self-host changes are committed as `feat(selfhost): ...` so they are easy to identify during rebases.
- Expect conflicts in `excalidraw-app/data/*` (Firebase adapter vs. HTTP storage), `Dockerfile`, and any file where upstream added new cloud dependencies.
- Never merge upstream breaking changes without re-reading `deploy/AUTH.md` and `deploy/STORAGE_API.md` and re-testing the compose stack end-to-end.
- After every upstream sync, verify `VITE_APP_HTTP_STORAGE_BACKEND_URL`, `VITE_APP_BACKEND_V2_GET_URL`, and `VITE_APP_BACKEND_V2_POST_URL` still point to `excalidraw-storage.bizelevateai.com`.

## Upstream coding guidelines (from upstream AGENTS.md)

- For new DOM/browser API usage, use `app.ownerDocument` and `app.ownerWindow` instead of globals; without `app`, derive them from the mounted node's `ownerDocument` and its `defaultView`.
- When overriding properties of an existing type, prefer `Merge<Base, Overrides>` from `@excalidraw/common/utility-types` over `Omit<Base, keyof Overrides> & Overrides`.
