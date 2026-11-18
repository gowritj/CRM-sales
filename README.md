# Northstar Loan Sales CRM

A lightweight loan-sales CRM for lead management, calls, follow-ups, document review, loan applications, bank schemes, team targets, and reporting. It uses Node.js, SQLite, and browser-native JavaScript; there are no runtime npm dependencies.

## Requirements

- Node.js 22.9 or later (`node:sqlite` and optional `.env` loading are built into Node.js).
- Docker is optional for containerized runs.

## Run locally

```powershell
Copy-Item .env.example .env
npm start
```

Open [http://localhost:3000](http://localhost:3000), or use [http://localhost:3000/mobile](http://localhost:3000/mobile) for the phone-style workspace. Set `PORT` in `.env` to use another port.

The first launch initializes SQLite, creates the demo accounts and sample CRM records, and stores the database at `data/crm.db`. Uploaded documents are stored separately under `uploads/`. Both locations can be changed through `DATABASE_PATH` and `UPLOAD_DIR`.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@northstar.demo` | `admin123` |
| Staff | `staff@northstar.demo` | `staff123` |
| Staff | `ethan@northstar.demo` | `staff123` |
| Staff | `priya@northstar.demo` | `staff123` |
| Staff | `noah@northstar.demo` | `staff123` |

Change demo passwords before exposing the app to any other users.

## Features

- Role-aware admin and staff access, persisted sessions, password changes and resets, login throttling, and security headers.
- Searchable, server-paginated leads; CSV import with validation and duplicate-phone detection; CSV export; lead distribution and bulk reassignment.
- Atomic call logging, outcome-driven lead updates, scheduled follow-ups, and daily call-target metrics.
- Application stage transitions with history, disbursement tracking, and lead conversion.
- Private PDF/JPG/PNG uploads with a 5 MB limit, access-checked downloads, and document verification or rejection.
- Bank and scheme management, responsive reports, team metrics, and a dedicated phone-style `/mobile` interface.

## Environment

Copy `.env.example` to `.env`. The start and development scripts load it with Node's built-in environment-file support.

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | Set to `production` to enable the `Secure` session cookie flag. |
| `PORT` | `3000` | HTTP listen port. |
| `DATABASE_PATH` | `data/crm.db` | SQLite database file. Relative paths resolve from the current working directory. |
| `UPLOAD_DIR` | `uploads/` | Private directory for document binaries. |

## Commands

```powershell
npm start
npm run dev
npm test
npm run seed
npm run reset-db -- --yes
```

`npm run seed` initializes an empty database with the included demo data. The reset command deletes the configured SQLite database and its journal files; stop the server and make a backup before using it. It requires the explicit `--yes` confirmation. The next server start creates a fresh demo database.

Tests use isolated temporary SQLite and upload paths.

## Docker

Build and run with persistent storage for the database and uploaded files:

```sh
docker build -t northstar-crm .
docker run --name northstar-crm -p 3000:3000 \
  -v northstar-data:/app/data \
  -v northstar-uploads:/app/uploads \
  northstar-crm
```

The container runs as the unprivileged `node` user. Preserve both volumes when updating or restarting the container; deleting them removes customer data and uploaded documents.

## Data migration and security notes

On its first SQLite startup, the app looks for a legacy `crm.json` beside the configured database. If valid legacy data is found, it imports that data; otherwise it creates sample data. Keep the original file and back up the database before migration or reset.

This project is a demonstration CRM, not a compliance-certified lending platform. It ships with public demo credentials and does not include production identity management, audit retention policies, automated backups, or deployment-specific TLS termination. For external access, use HTTPS through a trusted reverse proxy, replace demo credentials, restrict network exposure, and establish encrypted backups and retention policies. Uploaded documents contain sensitive information and must remain in private persistent storage.
