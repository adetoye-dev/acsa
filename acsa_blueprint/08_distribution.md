# Phase 8: Distribution and Self‑Hosting

This phase covers how to package Acsa for end users.  The goal is to
distribute a **single, lightweight binary** that can run workflows anywhere,
as well as optional Docker images and installation scripts.  Clear
installation instructions reduce friction and encourage adoption.

## 1. Compiling the Rust Binary

1. **Static linking.**  Configure `core/Cargo.toml` with `crate-type =
   ["bin"]` and enable static linking for Linux builds.  Use `musl` if
   targeting alpine environments.  For example:

   ```toml
   [profile.release]
   lto = true
   codegen-units = 1
   panic = "abort"
   strip = true
   ```

   Compile with:

   ```sh
   cargo build --release --locked --target x86_64-unknown-linux-musl
   ```

2. **Cross compilation.**  Use `cross` or `cargo-zigbuild` to build for
   multiple architectures (x86_64, aarch64) and operating systems
   (Linux, macOS, Windows).  Generate artifacts like `acsa-core-x86_64-linux`.

3. **Binary size.**  Use `strip` to remove debug symbols and `upx` (optional)
   to compress the binary further.  Aim for a binary under 30 MB.  Document
   the expected size and memory usage in the release notes.

4. **Version metadata.**  Embed the version number and git commit hash into
   the binary using environment variables and build scripts.  Expose a `--version`
   flag in the CLI to display this information.

## 2. Packaging the UI

1. **Build assets.**  Run `npm run build` or `pnpm build` in the `ui/` folder
   to produce a static site in `.next/` or `dist/`.  Configure Next.js to
   output a static export if possible.

2. **Serve locally.**  For local development, run the UI with `npm run dev`.
   For production, consider using `serve` or a minimal Node.js server that
   hosts the static files.  Alternatively, bundle the UI into a Docker
   container.

## 3. Docker Image

1. **Dockerfile.**  Create a multi‑stage Dockerfile:

   ```Dockerfile
   # Stage 1: build binary
   FROM rust:1.75-alpine AS builder
   RUN apk add --no-cache musl-dev pkgconfig
   WORKDIR /app
   COPY . ./
   RUN cargo build --release --locked --target x86_64-unknown-linux-musl

   # Stage 2: build UI
   FROM node:18-alpine AS ui-builder
   WORKDIR /app/ui
   COPY ui/package.json ui/package-lock.json ./
   RUN npm install --silent --progress=false
   COPY ui/ .
   RUN npm run build

   # Final Stage
   FROM alpine:latest
   RUN apk add --no-cache ca-certificates
   WORKDIR /app
   COPY --from=builder /app/target/x86_64-unknown-linux-musl/release/acsa-core ./acsa
   COPY --from=ui-builder /app/ui/.next/standalone ./ui
   EXPOSE 3000
   CMD ["./acsa"]
   ```

   Adjust paths based on your build output.  The final image contains the
   compiled engine and the prebuilt UI.  Set entrypoints to run both
   processes or use a process supervisor if necessary.

2. **Image size.**  Keep the final Docker image small (≤ 200 MB).  Use
   Alpine base images and multi‑stage builds to minimize footprint.

## 4. Installation Scripts

1. **Shell installer.**  Provide a shell script (e.g., `install.sh`) that
   downloads the correct binary for the user’s OS/arch, verifies its
   checksum, and places it into `/usr/local/bin` (or `~/.local/bin` for
   unprivileged users).  The script should detect the platform using
   `uname -s` and `uname -m`, fetch the latest release from GitHub, and
   verify the SHA256 checksum before installation.

2. **Homebrew formula.**  Create a Homebrew formula for macOS users so they
   can install Acsa via `brew install achsah/acsa/acsa`.  Maintain the
   formula in its own tap.

3. **Scoop manifest.**  For Windows, provide a scoop manifest so users can
   run `scoop install acsa`.

## 5. Self‑Hosting Guide

1. **Quick start.**  Document how to run the binary locally:

   ```sh
   ./acsa --workflows ./workflows --db ./data/acsa.db --port 8080
   ```

   Explain each flag: where workflows live, where to store the SQLite
   database, and which port to listen on.  Provide examples for triggers and
   running workflows manually.

2. **Docker run.**  Provide a one‑line `docker run` command to start Acsa
   with workflows mounted as a volume:

   ```sh
   docker run -v $(pwd)/workflows:/app/workflows -p 8080:8080 achsah/acsa:latest
   ```

3. **Kubernetes deployment.**  Offer Kubernetes manifests (Deployment and
   Service) for users who want to run Acsa in a cluster.  Include resource
   requests/limits and a PersistentVolumeClaim for the SQLite database.  This
   can be a separate `deploy/` directory.

## 6. Release Process

1. **Tag and build.**  On each release, tag the repository (`git tag vX.Y.Z`)
   and push to GitHub.  Trigger CI to build binaries for all targets and
   publish them as release assets.

2. **Generate checksums.**  Create a `SHA256SUMS` file and sign it with a
   maintainers’ GPG key.  Publish the signature and include instructions on
   verifying downloads.

3. **Publish Docker image.**  Push the built Docker image to a container
   registry (e.g., GitHub Container Registry or Docker Hub) tagged with the
   release version.

4. **Update installers.**  Update the Homebrew formula and scoop manifest to
   point at the new version.

5. **Write release notes.**  Summarise new features, bug fixes, and breaking
   changes.  Include upgrade instructions and highlight any migrations.

Packaging Acsa carefully ensures that users can adopt it with minimal effort
and that the project gains traction beyond the development community.
