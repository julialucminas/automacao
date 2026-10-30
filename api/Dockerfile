FROM node:22-alpine AS build
# ferramentas para compilar o better-sqlite3 caso não haja binário pronto
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm test && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production BANCO=/dados/faturas.db PORTA=3333
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3333
CMD ["node", "dist/servidor.js"]
