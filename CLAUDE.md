# BizElevate Self-Hosted Excalidraw

This is BizElevate's private fork of [excalidraw/excalidraw](https://github.com/excalidraw/excalidraw). It tracks upstream and adds a self-hosting layer so we can run an internal collaborative whiteboard without Firebase or the Excalidraw Plus cloud.

## How this fork differs from upstream

- **`deploy/`** contains the production compose stack and runbooks:
  - `deploy/docker-compose.yml` — Traefik-fronted services for the SPA, oauth2-proxy, collab room, storage backend, and Redis.
  - `deploy/AUTH.md` — Google OAuth gating via oauth2-proxy (internal `@bizelevate.net` only).
  - `deploy/STORAGE_API.md` — HTTP storage backend API contract and required env vars.
- **Firebase replaced by self-hosted HTTP storage.** The frontend adapter in `excalidraw-app/data/httpStorage.ts` points at `alswl/excalidraw-storage-backend` (Redis-backed) instead of Firebase. Encrypted blobs are still client-side AES-GCM; the backend is a dumb KV store.
- **Google sign-in via oauth2-proxy.** The public host `excalidraw.bizelevateai.com` is proxied through oauth2-proxy before the SPA is served. Collab and storage hosts are not gated because they only see encrypted blobs tied to room keys in URL fragments.

## Deploy target

Run `deploy/docker-compose.yml` on the BizElevate VPS (external Traefik network `root_default`). Public hosts:

- `excalidraw.bizelevateai.com` — oauth2-proxied SPA
- `excalidraw-collab.bizelevateai.com` — excalidraw-room
- `excalidraw-storage.bizelevateai.com` — HTTP storage backend

Deploy steps are in `deploy/AUTH.md` and `deploy/STORAGE_API.md`.

## VITE_APP_* env vars (names only)

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
