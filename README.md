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

On first start the backend runs migrations and creates the administrator. **The database starts empty** — no data is bundled with the app. Sign in as a Finance/Admin user and open **Upload Data**. Each file is stored in PostgreSQL and every KPI is then calculated by the backend; the dashboard only displays those results. Until the required data is uploaded, the dashboard shows a banner listing what is missing.

## Monthly uploads and locking

Upload Data has two parts:

- **Monthly data** — Sales, Expenses, Debtor Summary and Inventory reports, plus the month's *Electrician Point*. **Choose the month first**, then upload. An upload replaces only that month (rows dated in other months are ignored and reported; a file with nothing for the chosen month is rejected with its actual date range).
- **Reference data** — Target, G/L mapping, MM60, VK13, Cost Centers, exclusion list, MM60 surcharge and exchange rates. These are not month-specific and apply to every month.

**Locking a month** (Administrator or Finance, once Sales and Expenses are uploaded) blocks uploads, replacements, removals and edits for that month. Only an **Administrator** can unlock it (an optional reason is kept in the audit trail, table `period_events`). The rule is enforced by the API *and* by database triggers, so direct edits to a locked month — for example in pgAdmin — are refused too.

Reference data is deliberately not frozen by a month lock. Changing it (for example MM60 costs) can change results for locked months, so treat it as a controlled change.

The dashboard's **Month** filter shows the results calculated from the data stored for that month (🔒 marks locked months); "All Months" aggregates every month that has data. The financial year starts in April of `FISCAL_YEAR_START` (default 2026 = FY26/27).

## Open the database in pgAdmin

The database port is published on `127.0.0.1:${DB_PORT:-5432}` (this machine only). In pgAdmin choose **Servers → Register → Server…** and enter:

| Field | Value |
|---|---|
| Host name/address | `localhost` |
| Port | `5432` (or your `DB_PORT`) |
| Maintenance database | `kpi` (`POSTGRES_DB`) |
| Username / Password | `POSTGRES_USER` / `POSTGRES_PASSWORD` from `.env` |

Then browse **kpi → Schemas → public → Tables**. Run `docker compose up -d db` after pulling this change to apply the new port mapping. Never publish this port on a public server. Direct edits bypass the app's validation, and the backend caches calculation inputs, so upload a file or change a setting to refresh them.

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
  npm run dev

# frontend (http://localhost:5173, proxies /api to :4000)
cd frontend && npm install && npm run dev
```

Tests: `npm test` in `backend/` (importers) and `frontend/` (formatters).

## API overview

All routes are under `/api` and need `Authorization: Bearer <token>` except `/auth/login` and `/health`.

- `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password`
- `GET /dashboard?month&main&sub&gp&npat`, `GET /comparison`, `GET /ytd`
- `GET|POST /snapshots`, `DELETE /snapshots/:id` (write: admin, finance)
- `GET|PUT /settings` (MM60 surcharge, VK13 exchange rates; write: admin, finance)
- `GET /periods`, `POST /periods/:month/lock` (admin, finance), `POST /periods/:month/unlock` (admin), `PUT /periods/:month/electrician-point`
- `GET /uploads`, `POST /uploads/:dataset` (add `?month=June` for sales, expenses, debtor, inventory), `DELETE /uploads/:dataset` (month-based: `?month=`; or `costCenters`) (write: admin, finance). A locked month answers `423`.
- `GET|POST /users`, `PATCH|DELETE /users/:id` (admin)

Datasets: `sales`, `target`, `expenses`, `gl`, `mm60`, `vk13`, `distExclusion`, `costCenters`, `debtor`, `inventory`. Reference datasets are replaced as a whole, month-based ones per month; every upload is recorded in `upload_batches`.

## Legacy files

`Sales Dashboard.dc.html`, `calc.js`, `support.js` and `KPI Dashboard - Standalone.html` are the original single-page app, kept for reference.
