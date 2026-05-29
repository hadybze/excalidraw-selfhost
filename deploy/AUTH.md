# Google OAuth Sign-In (oauth2-proxy)

The self-hosted Excalidraw frontend (`https://excalidraw.bizelevateai.com`) is
gated behind Google sign-in. Only `@bizelevate.net` Workspace accounts can load
the app. Enforced two ways:

1. **OAuth consent screen = Internal** in Google Cloud → only org users can even
   complete the Google login.
2. **oauth2-proxy `OAUTH2_PROXY_EMAIL_DOMAINS=bizelevate.net`** → rejects any
   token whose email is not on that domain.

## Architecture

oauth2-proxy runs as a **reverse proxy** (not forwardAuth), so it is the public
entrypoint for the frontend host and issues the Google redirect natively — no
dependency on Traefik's `errors`/`statusRewrites` behavior.

```
browser ──► Traefik (websecure) ──► oauth2-proxy ──► excalidraw-frontend
                  [router: excalidraw]      │              (internal, traefik.enable=false)
                                            ▼
                                   Google OAuth (project: bizelevate-sheets)
```

- The `excalidraw` Traefik router points at the oauth2-proxy service (port 4180).
- Unauthenticated browser request → oauth2-proxy returns 302 to Google.
- After login, oauth2-proxy sets a cookie and proxies all traffic to
  `http://excalidraw-frontend:80`. `/oauth2/*` is handled by oauth2-proxy itself.
- The frontend container is no longer exposed to Traefik (`traefik.enable=false`);
  it is only reachable internally via service-name DNS on `root_default`.
- The collab (`excalidraw-collab.*`) and storage (`excalidraw-storage.*`) hosts
  are **not** gated — they only ever see AES-GCM E2E-encrypted blobs, so they are
  useless without the room key (which lives in the URL fragment and never reaches
  the server). Gating the SPA is sufficient to keep strangers out of the app.

## One-time setup in Google Cloud Console

Project: **bizelevate-sheets**. Do these once.

### 1. OAuth consent screen (Internal)
- Console → APIs & Services → OAuth consent screen.
- User type: **Internal** → Create.
- App name: `Excalidraw (BizElevate)`, support email: `hady@bizelevate.net`.
- Scopes: default (`openid`, `email`, `profile`) — no extra scopes needed.
- Save.

### 2. OAuth 2.0 Client ID (Web application)
- Console → APIs & Services → Credentials → Create Credentials → OAuth client ID.
- Application type: **Web application**.
- Name: `excalidraw-oauth2-proxy`.
- Authorized JavaScript origins: `https://excalidraw.bizelevateai.com`
- Authorized redirect URIs: `https://excalidraw.bizelevateai.com/oauth2/callback`
- Create → copy the **Client ID** and **Client secret**.

### 3. Fill secrets
On the VPS (or locally before rsync), create `deploy/oauth2-proxy.env` from the
example and fill in the three values:

```bash
cp deploy/oauth2-proxy.env.example deploy/oauth2-proxy.env
# edit: OAUTH2_PROXY_CLIENT_ID, OAUTH2_PROXY_CLIENT_SECRET, OAUTH2_PROXY_COOKIE_SECRET
# generate cookie secret:
python3 -c 'import secrets,base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'
```

`deploy/oauth2-proxy.env` is gitignored — never commit it.

## Deploy

```bash
cd /root/excalidraw/deploy
docker compose up -d
docker builder prune -f
```

## Managing access

- Add/remove users = add/remove them from the `bizelevate.net` Workspace. No
  redeploy needed.
- To allow a specific outside Gmail too: switch the consent screen to External
  (Testing) and add the address as a Test user, then add it via
  `OAUTH2_PROXY_AUTHENTICATED_EMAILS_FILE` or widen `OAUTH2_PROXY_EMAIL_DOMAINS`.
- Sign out: visit `https://excalidraw.bizelevateai.com/oauth2/sign_out`.
