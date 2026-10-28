# Orel KPI Dashboard – Sales & Profitability

React + Express + PostgreSQL version of the KPI dashboard, packaged with Docker.

| Layer | Tech |
|---|---|
| `frontend/` | React 19, TypeScript, Vite, React Router, TanStack Query (served by nginx in Docker) |
| `backend/` | Express 5, TypeScript, `pg`, JWT auth, `xlsx` import (parsed in a worker thread) |
| database | PostgreSQL 16 (schema in `backend/src/db/migrations`) |

All KPI calculations run **on the server** (`backend/src/calc/calc.ts`, ported unchanged from the original browser `calc.js`). The browser only renders results.

## Run with Docker

```bash
cp .env.example .env     # then edit: passwords, JWT_SECRET, ADMIN_EMAIL / ADMIN_PASSWORD
docker compose up --build
```

Open <http://localhost:8080> and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

On first start the backend runs migrations, creates the administrator, and loads the workbooks in `./data` (about a minute; the UI waits automatically). Datasets that already exist are never re-seeded. Set `SEED_ON_START=false` to start empty and upload everything from the UI.

## Roles

| Role | View dashboards | Upload data, settings, snapshots | Manage users |
|---|---|---|---|
| Administrator | yes | yes | yes |
| Finance / Data Manager | yes | yes | no |
| Viewer | yes | no | no |

Permissions are enforced by the API (`requireRole`), not just hidden in the UI.

## Local development

```bash
# database
docker run -d --name kpi-db -e POSTGRES_USER=kpi -e POSTGRES_PASSWORD=kpi -e POSTGRES_DB=kpi -p 5432:5432 postgres:16-alpine

# backend  (http://localhost:4000)
cd backend && npm install
DATABASE_URL=postgres://kpi:kpi@localhost:5432/kpi ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=ChangeMe123 \
  SEED_ON_START=true SEED_DATA_DIR=../data npm run dev

# frontend (http://localhost:5173, proxies /api to :4000)
cd frontend && npm install && npm run dev
```

Tests: `npm test` in `backend/` (importers) and `frontend/` (formatters).

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>` except `/auth/login` and `/health`.

- `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`
- `GET /dashboard?month&main&sub&gp&npat`, `GET /comparison`, `GET /ytd`
- `GET|POST /snapshots`, `DELETE /snapshots/:id` (write: admin, finance)
- `GET|PUT /settings` (MM60 surcharge, VK13 exchange rates, electrician point; write: admin, finance)
- `GET /uploads`, `POST /uploads/:dataset`, `DELETE /uploads/costCenters` (write: admin, finance)
- `GET|POST /users`, `PATCH|DELETE /users/:id` (admin)

Datasets: `sales`, `target`, `expenses`, `gl`, `mm60`, `vk13`, `distExclusion`, `costCenters`, `debtor`, `inventory`. Each upload replaces that dataset, as in the original app, and is recorded in `upload_batches`.

## Legacy files

`Sales Dashboard.dc.html`, `calc.js`, `support.js` and `KPI Dashboard - Standalone.html` are the original single-page app, kept for reference.
