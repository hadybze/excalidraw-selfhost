# Excalidraw Self-Hosted Storage Backend — API Reference

This document records the HTTP storage backend targeted by the frontend adapter (`excalidraw-app/data/httpStorage.ts`).

## Target Image

**`alswl/excalidraw-storage-backend`** (fork of `kiliman/excalidraw-storage-backend`).  
Both forks share the same REST API contract. The frontend adapter was validated against the alswl fork.

## API Endpoints Used by the Adapter

All paths are prefixed by `VITE_APP_HTTP_STORAGE_BACKEND_URL` (e.g. `https://excalidraw-storage.bizelevateai.com`). The backend itself mounts routes under `/api/v2` by default via `GLOBAL_PREFIX`.

| Resource | Method | Path | Body | Notes |
|---|---|---|---|---|
| **Room scene** | `GET` | `/api/v2/rooms/:roomId` | — | Returns raw bytes: 4-byte big-endian scene version + IV (12 B) + AES-GCM ciphertext. |
| **Room scene** | `PUT` | `/api/v2/rooms/:roomId` | raw bytes (same format as above) | Dumb blob store; optimistic concurrency handled client-side by comparing scene versions. |
| **File blob** | `GET` | `/api/v2/files/:fileId` | — | Returns the encrypted/compressed file blob. |
| **File blob** | `PUT` | `/api/v2/files/:fileId` | raw bytes | Stores the encrypted/compressed file blob. Prefix is ignored (flat KV). |
| **Shareable scene** | `POST` | `/api/v2/scenes/` | raw bytes | Used by `data/index.ts` (`exportToBackend`) for shareable links. |
| **Shareable scene** | `GET` | `/api/v2/scenes/:id` | — | Used by `data/index.ts` (`importFromBackend`) for shareable links. |

> **Encryption note:** The backend is a dumb blob store. All encryption (AES-GCM) and compression happen client-side, exactly as the original Firebase adapter did.

## Required Backend Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP server listening port | `8080` |
| `GLOBAL_PREFIX` | API route prefix | `/api/v2` |
| `STORAGE_URI` | Keyv connection string (e.g. `redis://host:6379`). Empty string = in-memory (non-persistent). | `""` |
| `LOG_LEVEL` | NestJS log level | `warn` |
| `BODY_LIMIT` | Max request body size | `50mb` |

## Deployment Checklist

1. Run the container (example):
   ```bash
   docker run -d -p 8080:8080 \
     -e STORAGE_URI=redis://redis:6379 \
     -e PORT=8080 \
     -e GLOBAL_PREFIX=/api/v2 \
     alswl/excalidraw-storage-backend:v2023.11.11
   ```
2. Ensure the frontend `VITE_APP_HTTP_STORAGE_BACKEND_URL` points to the same base URL + prefix (e.g. `https://excalidraw-storage.bizelevateai.com/api/v2`).
3. Ensure `VITE_APP_BACKEND_V2_GET_URL` and `VITE_APP_BACKEND_V2_POST_URL` also point to the storage backend if you want shareable links to use it (e.g. `…/api/v2/scenes/`).
