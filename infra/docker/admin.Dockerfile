# syntax=docker/dockerfile:1.7
# Multi-stage image for the admin console (apps/admin, Next.js).
# Build from the repository root:
#   docker build -f infra/docker/admin.Dockerfile -t tasalli-admin .
# Runs `next start` on port 3002. Expects apps/admin to have a `build` script (`next build`).

ARG NODE_IMAGE=node:20-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG PACKAGE=@tasalli/admin
ARG PACKAGE_DIR=apps/admin
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "${PACKAGE}..." \
    || pnpm install --no-frozen-lockfile --filter "${PACKAGE}..."
RUN pnpm --filter "${PACKAGE}..." --if-present run build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter "${PACKAGE}" deploy --prod /out \
    && rm -rf /out/.next && cp -r "${PACKAGE_DIR}/.next" /out/.next \
    && if [ -d "${PACKAGE_DIR}/public" ]; then rm -rf /out/public && cp -r "${PACKAGE_DIR}/public" /out/public; fi

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production TZ=UTC NEXT_TELEMETRY_DISABLED=1 PORT=3002
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
EXPOSE 3002
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start -p \"$PORT\""]
