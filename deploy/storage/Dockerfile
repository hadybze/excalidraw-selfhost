# HTTP storage backend (alswl/excalidraw-storage-backend), built from upstream source on Node 24.
# Upstream source is pinned by commit. package.json and package-lock.json here replace
# upstream's (NestJS 10, current dependencies, no axios). Upstream src/ is not patched.
FROM node:24-alpine AS build
ARG STORAGE_REF=8e64f108b6c18bc3e7ddb7404199cf1a0ba8e602
RUN apk add --no-cache git python3 make g++
WORKDIR /app
RUN git init -q . \
 && git remote add origin https://github.com/alswl/excalidraw-storage-backend.git \
 && git fetch -q --depth 1 origin "$STORAGE_REF" \
 && git checkout -q FETCH_HEAD \
 && rm -f package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# Only these suites pass upstream; the three controller specs fail on a module path in upstream's jest config.
RUN npx jest storage.service raw-parser
RUN npx nest build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 8080
CMD ["node", "dist/main"]
