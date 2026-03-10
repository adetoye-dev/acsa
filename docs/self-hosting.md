# Self-Hosting

## Binary install

Install the latest published binary from GitHub releases:

```bash
./scripts/install.sh
```

Optional environment overrides:

- `ACSA_VERSION=v0.1.0`
- `ACSA_INSTALL_DIR=$HOME/.local/bin`
- `ACSA_INSTALL_REPO=achsah-systems/acsa`

After installation:

```bash
acsa-core --version
ACSA_WEBHOOK_SECRET=change-me acsa-core serve ./workflows --db ./data/acsa.db --host 127.0.0.1 --port 3001
```

## Docker

Build and run locally:

```bash
docker compose -f deploy/docker-compose.yml up --build
```

The container:

- runs the Rust engine on `127.0.0.1:3001`
- serves the Next.js standalone UI on `0.0.0.0:3000`
- expects workflows in `/app/workflows`
- persists SQLite data in `/app/data`

Important environment variables:

- `ACSA_WEBHOOK_SECRET`
- `ACSA_DB_PATH`
- `ACSA_WORKFLOWS_DIR`
- `PORT`
- `ACSA_LOG_PAYLOADS`
- `ACSA_LOG_FILE_PATH`
- `ACSA_LOG_RETENTION_DAYS`
- `ACSA_RUN_RETENTION_DAYS`

## Kubernetes

Base manifests live under `deploy/kubernetes/`:

- `persistent-volume-claim.yaml`
- `workflows-configmap.yaml`
- `deployment.yaml`
- `service.yaml`

Apply them with:

```bash
kubectl apply -f deploy/kubernetes/persistent-volume-claim.yaml
kubectl apply -f deploy/kubernetes/workflows-configmap.yaml
kubectl apply -f deploy/kubernetes/deployment.yaml
kubectl apply -f deploy/kubernetes/service.yaml
```

Before applying:

- replace the placeholder `acsa-workflows` ConfigMap with your workflow YAML files or a mounted volume
- create the `acsa-secrets` Secret with `webhook-secret`
- adjust resource requests and storage size for your workload

## Release artifacts

Create a local release bundle for the current host target:

```bash
./scripts/package-release.sh
```

This produces:

- a release tarball in `dist/`
- a bundled standalone UI
- a `SHA256SUMS` file when a checksum tool is available

Tagged releases use `.github/workflows/release.yml` to build binaries, upload UI artifacts, generate checksums, and publish the container image.

## Package manager manifests

Release manifests are tracked in:

- `packaging/homebrew/acsa.rb`
- `packaging/scoop/acsa.json`

Update the version and checksum fields when publishing a new release.
