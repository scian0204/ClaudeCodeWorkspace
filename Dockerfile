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
# DATA_DIR defaults to the documented mount point. Without it the app resolves `./data` against the
# workspace cwd (/app/server/data), so a `docker run -v claudecode-workspace_data:/data` deploy that
# does not pass DATA_DIR writes every byte of state into the container layer while the named volume
# stays empty: state is lost on the next recreate, and the code-server / sandbox containers — which
# mount that volume with a subpath taken from DATA_DIR — fail with "no such file or directory".
ENV NODE_ENV=production \
    DATA_DIR=/data
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
