# Node 22 LTS: current maintained release with prebuilt sqlite3 binaries, so no
# C/C++ toolchain is needed at install time.
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Install dependencies first so this layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Tailwind lives in devDependencies, so build the CSS with a throwaway install
# rather than shipping the toolchain in the final image.
RUN npm install --no-save tailwindcss@^3.4.19 \
 && npx tailwindcss -i ./src/styles.css -o ./public/styles.css --minify \
 && npm uninstall --no-save tailwindcss \
 && npm cache clean --force

# Persisted data (SQLite, encryption key, replays, media) lives here.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME ["/app/data"]

USER node
EXPOSE 3000

ENV PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node index.js` directly (not `npm start`) so SIGTERM reaches the app and the
# graceful shutdown handler runs.
CMD ["node", "index.js"]
