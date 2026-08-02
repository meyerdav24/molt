# Reference Tab Authority (Next.js standalone output)
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @molt/web... \
 && pnpm --filter @molt/protocol build \
 && pnpm --filter @molt/web build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# the /docs/spec page renders the protocol document at request time
COPY SPEC.md ./SPEC.md
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
