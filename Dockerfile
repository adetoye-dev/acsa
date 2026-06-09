# Copyright 2026 Achsah Systems
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# ==========================================
# Stage 1: Build the Rust Engine (acsa-core)
# ==========================================
FROM rust:1.90-bookworm AS builder
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy workspace cargo definitions
COPY Cargo.toml Cargo.lock ./
COPY core/Cargo.toml ./core/Cargo.toml

# Create dummy source files to pre-compile and cache dependencies
RUN mkdir -p core/src && echo "fn main() {}" > core/src/main.rs && echo "fn main() {}" > core/build.rs
RUN cargo build --release --locked -p acsa-core

# Remove the dummy files to compile the actual source code
RUN rm -rf core/src core/build.rs
COPY core ./core

# Trigger build of our actual source
RUN touch core/src/main.rs core/build.rs
RUN cargo build --release --locked -p acsa-core

# ==========================================
# Stage 2: Minimal Production Runtime
# ==========================================
FROM debian:bookworm-slim AS runtime
WORKDIR /app

# Install runtime dependencies (ca-certificates for API outbound calls, sqlite3 for health check, tini, python3, pip)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    sqlite3 \
    tini \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install required python libraries globally for process connectors
RUN pip3 install --break-system-packages --no-cache-dir gspread google-auth defusedxml

# Create dedicated data directory for SQLite persistent database
RUN mkdir -p /data /app/workflows

# Copy compiled engine binary
COPY --from=builder /app/target/release/acsa-core /usr/local/bin/acsa-core

# Copy default workflows and connectors into the image
COPY workflows /app/workflows
COPY connectors /app/connectors

# Configure default runtime environment variables
ENV PORT=8080
ENV ACSA_DB_PATH=/data/acsa.db
ENV ACSA_WORKFLOWS_DIR=/app/workflows

# Expose server port
EXPOSE 8080

# Expose a light healthcheck using sqlite3 to query database integrity
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD sqlite3 /data/acsa.db "SELECT 1;" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["acsa-core", "serve", "/app/workflows", "--db", "/data/acsa.db", "--host", "0.0.0.0", "--port", "8080"]
