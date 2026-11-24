# syntax=docker/dockerfile:1.7
# Image for a Node 20 workspace service (services/api, services/call-engine).
# Build from the repository root:
#   docker build -f infra/docker/service.Dockerfile --build-arg PACKAGE=@tasalli/api --build-arg PACKAGE_DIR=services/api -t tasalli-api .
#
# The services run TypeScript directly (the API with @swc-node/register, the call engine with tsx) and the
# workspace packages they use (@tasalli/contracts, scripts, integrations) point at their .ts sources. So the
# image installs the service and its workspace dependencies and runs the package's own `start` script, exactly
# as `pnpm --filter <package> start` does locally. There is no compile step and no dist/ folder.

ARG NODE_IMAGE=node:20-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# ---- install --------------------------------------------------------------
FROM base AS deps
ARG PACKAGE
ARG PACKAGE_DIR
RUN test -n "$PACKAGE" && test -n "$PACKAGE_DIR" || (echo "PACKAGE and PACKAGE_DIR build args are required" && exit 1)
COPY . .
# Frozen install when the lockfile matches; otherwise fall back (see lockfile policy).
# The service and every workspace package it depends on; dev dependencies stay (tsx / swc run the sources).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "${PACKAGE}..." \
    || pnpm install --no-frozen-lockfile --filter "${PACKAGE}..."
# Fail the build now, not at start-up, if the service's TypeScript does not compile.
RUN pnpm --filter "${PACKAGE}" --if-present run typecheck

# ---- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG PACKAGE_DIR
ENV NODE_ENV=production TZ=UTC
RUN apk add --no-cache tini
COPY --from=deps --chown=node:node /repo /repo
WORKDIR /repo/${PACKAGE_DIR}
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# The package's own start script (node -r @swc-node/register src/main.ts, or tsx src/main.ts).
CMD ["npm", "run", "--silent", "start"]
