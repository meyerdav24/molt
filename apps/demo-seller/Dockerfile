FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/demo-seller ./apps/demo-seller
RUN pnpm install --frozen-lockfile --filter @molt/demo-seller... \
 && pnpm --filter @molt/protocol build \
 && pnpm --filter @molt/demo-seller build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
EXPOSE 4021
CMD ["node", "apps/demo-seller/dist/index.js"]
