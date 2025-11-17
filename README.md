# Roy-Hart Climate Survey Backend

Node + Express + Postgres backend for the Royalton-Hartland Parent/Family Climate Survey.

- `POST /submit` — accepts JSON from the survey front end
- One submission per IP **forever** (per `SURVEY_ID`)
- Stores responses in Postgres (`submissions` table, `payload` JSONB)
- Optionally forwards responses to a Google Sheet via Apps Script (`APPS_SCRIPT_URL`)

## Environment variables

- `DATABASE_URL` (required) — Postgres connection string
- `SURVEY_ID` (optional, default: `royhart_parent_family_climate_2025`)
- `SALT` (required) — long random secret for hashing IPs
- `APPS_SCRIPT_URL` (optional) — Google Apps Script Web App URL
- `TRUST_PROXY` (default: `true`)
- `PORT` (Render sets this automatically)

## Local dev

```bash
cp .env.example .env   # edit with real values
npm install
npm start
