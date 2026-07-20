# ---------- web build stage ----------
FROM node:22-slim AS webbuild
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && apt-get clean
COPY package.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm install --workspaces --include-workspace-root
COPY web web
COPY server server
RUN npm run build -w web

# ---------- runtime stage ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y python3 make g++ ca-certificates git && apt-get clean
COPY package.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install -w server --omit=dev=false && npm cache clean --force
RUN npm install -g @anthropic-ai/claude-code
COPY server server
COPY --from=webbuild /app/web/dist web/dist
EXPOSE 3000
CMD ["npm","run","start","-w","server"]
