# syntax=docker/dockerfile:1.7
# Multi-stage image for a Node 20 workspace service (services/api, services/call-engine).
# Build from the repository root:
#   docker build -f infra/docker/service.Dockerfile --build-arg PACKAGE=@tasalli/api --build-arg PACKAGE_DIR=services/api -t tasalli-api .
# The service must have a `build` script that emits to `dist/`, and start with
# `node dist/main.js` (override with --build-arg ENTRY=dist/other.js).

ARG NODE_IMAGE=node:20-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# ---- deps + build -------------------------------------------------------
FROM base AS build
ARG PACKAGE
ARG PACKAGE_DIR
RUN test -n "$PACKAGE" && test -n "$PACKAGE_DIR" || (echo "PACKAGE and PACKAGE_DIR build args are required" && exit 1)
COPY . .
# Frozen install when the lockfile matches; otherwise fall back (see lockfile policy).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "${PACKAGE}..." \
    || pnpm install --no-frozen-lockfile --filter "${PACKAGE}..."
# Build the service and every workspace package it depends on.
RUN pnpm --filter "${PACKAGE}..." --if-present run build
# Self-contained production folder: package.json, prod node_modules, workspace deps.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter "${PACKAGE}" deploy --prod /out \
    && rm -rf /out/dist && cp -r "${PACKAGE_DIR}/dist" /out/dist

# ---- runtime ------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG ENTRY=dist/main.js
ENV NODE_ENV=production TZ=UTC ENTRY=${ENTRY}
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "exec node \"$ENTRY\""]
