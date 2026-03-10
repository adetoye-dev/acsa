FROM rust:1-bookworm AS engine-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY core ./core
RUN cargo build --release --locked -p acsa-core

FROM node:22-bookworm-slim AS ui-builder
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV ACSA_ENGINE_HOST=127.0.0.1
ENV ACSA_ENGINE_PORT=3001
ENV ACSA_WORKFLOWS_DIR=/app/workflows
ENV ACSA_DB_PATH=/app/data/acsa.db
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=engine-builder /app/target/release/acsa-core /usr/local/bin/acsa-core
COPY --from=ui-builder /app/ui/.next/standalone /app/ui
COPY --from=ui-builder /app/ui/.next/static /app/ui/.next/static
COPY --from=ui-builder /app/ui/public /app/ui/public
COPY deploy/docker/start.sh /usr/local/bin/acsa-start
RUN chmod +x /usr/local/bin/acsa-start \
    && mkdir -p /app/workflows /app/data
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["acsa-start"]
