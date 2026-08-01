FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/mcp-server ./apps/mcp-server
RUN pnpm install --frozen-lockfile --filter @molt/mcp-server... \
 && pnpm --filter @molt/protocol build \
 && pnpm --filter @molt/adapters build \
 && pnpm --filter @molt/mcp-server build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
CMD ["node", "apps/mcp-server/dist/index.js"]
