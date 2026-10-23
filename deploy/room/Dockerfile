# Collab room (excalidraw/excalidraw-room), built from upstream source on Node 24.
# Upstream source is pinned by commit. package.json and package-lock.json here replace
# upstream's (updated dependencies, npm instead of yarn). Upstream src/ is not patched.
FROM node:24-alpine AS build
ARG ROOM_REF=03ff435860b508d7cd9e005cfc90f7977ae2a593
RUN apk add --no-cache git
WORKDIR /src
RUN git init -q . \
 && git remote add origin https://github.com/excalidraw/excalidraw-room.git \
 && git fetch -q --depth 1 origin "$ROOM_REF" \
 && git checkout -q FETCH_HEAD \
 && rm -f yarn.lock
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /excalidraw-room
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/public ./public
USER node
EXPOSE 80
CMD ["node", "dist/index.js"]
