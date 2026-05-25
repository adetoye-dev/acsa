# ACSA Cloud Deployment Guide

This guide walks you through deploying the complete ACSA stack **100% for free** using a modern, secure, and distributed architecture:

1. **Frontend UI**: Hosted on **Vercel** (Next.js client-side, zero cost).
2. **Backend Engine**: Hosted on **Koyeb** or **Fly.io** (high-performance Rust Axum backend).
3. **Workflow Database Integration**: Powered by **Neon Postgres** (serverless Postgres, free tier).

---

## Architecture Overview

```mermaid
graph TD
    User([User's Browser]) -->|HTTPS| Vercel["⚡ Vercel (Next.js Frontend)"]
    Vercel -->|Secure Rewrites /engine/*| Koyeb["🦀 Koyeb / Fly.io (Rust Backend Engine)"]
    Koyeb -->|SQLite Pool| Storage[("💾 Persistent DB (acsa.db)")]
    Koyeb -->|Database Queries| Neon[("🐘 Neon Postgres (Workflow DB)")]
    
    style Vercel fill:#f5f5f5,stroke:#000,stroke-width:2px,color:#000
    style Koyeb fill:#eef3ff,stroke:#6f63ff,stroke-width:2px,color:#6f63ff
    style Neon fill:#eefaf3,stroke:#2fa36b,stroke-width:2px,color:#2fa36b
```

By decoupling the UI and the Engine, you get:
- **Zero CORS Issues**: Next.js automatically proxies all `/engine/*` requests directly to the Rust backend from the same domain.
- **Maximum Security**: The Engine's host URL and port are hidden behind Vercel's edge, preventing direct public exposure.
- **Instant Scaling**: Fast global static delivery of UI components with dynamic backend computation.

---

## Step 1: Provision Neon Serverless Postgres

Use Neon as a robust, fully managed database integration target in your ACSA workflow nodes (e.g. `database_query` node) to read, write, and persist your business data.

1. Sign up for free on **[Neon.tech](https://neon.tech/)**.
2. Create a new Postgres project (e.g. `acsa-workspace-db`).
3. Select your preferred region (e.g., AWS US East).
4. Copy your PostgreSQL connection string from the dashboard. It will look like this:
   ```text
   postgres://username:password@ep-cool-glade-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
5. Save this string! You will pass it to your ACSA workflows or save it inside the ACSA credentials store as `DATABASE_URL`.

---

## Step 2: Deploy Rust Engine Backend (Koyeb or Fly.io)

You can choose either **Koyeb** (for fast, automated Docker deployments) or **Fly.io** (to mount a free 3GB persistent disk volume for SQLite).

### Option A: Fly.io (Recommended — 100% Free Persistence)

Since the internal metadata of ACSA is powered by SQLite (`acsa.db`), Fly.io is the best free provider because it lets you mount a **permanent, free 3GB disk volume**. This prevents your workflows and runs from wiping on server restarts.

1. Install the Fly CLI:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```
2. Log in or sign up:
   ```bash
   fly auth login
   ```
3. Initialize the app in the project root:
   ```bash
   fly launch --no-deploy
   ```
   *Choose your app name (e.g. `acsa-engine`) and region.*

4. Provision a persistent data volume named `acsa_data` (3GB is free):
   ```bash
   fly volumes create acsa_data --size 3
   ```

5. Deploy the app:
   ```bash
   fly deploy
   ```

6. Copy the assigned URL (e.g., `https://acsa-engine.fly.dev`).

---

### Option B: Koyeb (Fast & Ephemeral Docker Deployment)

Koyeb runs 24/7 with zero cold starts, utilizing the production-ready multi-stage `Dockerfile` in the root of the project.

1. Sign up on **[Koyeb.com](https://www.koyeb.com/)** and link your GitHub repository.
2. Click **Create Service** and select **GitHub**.
3. Choose the ACSA repository.
4. In the configuration:
   - **Build Type**: `Dockerfile` (Koyeb will automatically detect the root `Dockerfile`).
   - **Ports**: Expose port `8080` (HTTP).
5. Add the following **Environment Variables**:
   - `PORT`: `8080`
   - `ACSA_WEBHOOK_SECRET`: *(Create a strong random secret key)*
6. Click **Deploy**. Koyeb will compile your container using our optimized caching layer and host it at `https://<your-app-name>.koyeb.app`.

---

## Step 3: Deploy Frontend UI to Vercel

Vercel is the ultimate hosting platform for Next.js applications, offering high performance, automatic SSL, and zero configuration.

1. Sign up or log in to **[Vercel.com](https://vercel.com/)** and connect your GitHub repository.
2. Click **Add New** -> **Project** and select your ACSA repository.
3. Configure the Project settings:
   - **Root Directory**: `ui` (Make sure to click 'Edit' and select `ui`).
   - **Framework Preset**: `Next.js`
   - **Build & Development Settings**: Keep defaults (`npm run build`).
4. Add the following **Environment Variable**:
   - **Key**: `ACSA_ENGINE_URL`
   - **Value**: `https://<your-engine-app-url>` (Your Fly.io or Koyeb backend URL from Step 2, e.g. `https://acsa-engine.fly.dev`)
5. Click **Deploy**. Vercel will build your static files and deploy them globally!

---

## Environment Variables Reference

| Variable Name | Required | Target Platform | Description |
|---|---|---|---|
| `ACSA_ENGINE_URL` | **Yes** | **Vercel** | The URL of your deployed Rust Engine (Fly.io or Koyeb URL). |
| `PORT` | **Yes** | **Koyeb/Fly.io** | The port the Engine listens on (default: `8080`). |
| `ACSA_DB_PATH` | No | **Fly.io** | Path to the SQLite database file (set to `/data/acsa.db` on Fly.io). |
| `ACSA_WEBHOOK_SECRET` | No | **Koyeb/Fly.io** | Secure secret used to authenticate webhook triggers. |
| `DATABASE_URL` | No | **Workflows** | Your Neon Postgres connection string, used inside database query nodes. |

---

## Verification & Testing

Once both systems are deployed:

1. **Verify Engine Health**:
   Visit `https://<your-engine-url>/health` in your browser. It should return a success message or JSON confirming the server is running healthy.
2. **Verify Frontend Proxying**:
   Load your Vercel deployment URL. Open the Browser Developer Console (`F12` -> Network tab) and verify that API requests to `/engine/...` are proxied perfectly with no CORS or connection errors.
