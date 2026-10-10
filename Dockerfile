FROM node:24-bookworm-slim AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci
COPY index.html ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca,required=false if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci --omit=dev && npm cache clean --force
COPY requirements.txt ./
RUN --mount=type=secret,id=proxy_ca,required=false if [ -f /run/secrets/proxy_ca ]; then export PIP_CERT=/run/secrets/proxy_ca; fi; python3 -m venv .venv && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt
COPY scripts ./scripts
RUN --mount=type=secret,id=proxy_ca,required=false if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; python3 scripts/setup_models.py
COPY server ./server
COPY src/platforms.js ./src/platforms.js
COPY --from=web-build /app/dist ./dist
RUN chmod -R a+rX /app && mkdir -p /app/runtime-data && chown node:node /app/runtime-data
ENV NODE_ENV=production PUBLIC_MODE=1 PORT=10000 STOCK_DATA_DIR=/app/runtime-data UPSCALE_THREADS=1
USER node
EXPOSE 10000
CMD ["node", "--use-env-proxy", "server/index.mjs", "--production"]
