# komun-api

Backend API for Komun – multi-tenant condominium management (Malta MVP).

## Stack

- Node.js, Express, TypeScript
- Postgres (single DB, schema-per-tenant)
- Drizzle ORM + migrations
- JWT auth, file storage (filesystem in dev / S3 in prod)

## Setup

1. Copy `.env.example` to `.env` and set:
   - `DATABASE_URL` – Postgres connection string
   - `JWT_SECRET` – at least 32 characters
   - `CORS_ORIGIN` – e.g. `http://localhost:3000` for the Next.js app
   - `FILE_STORAGE=filesystem` and `UPLOAD_PATH=./uploads` for local dev

2. Create the DB and run public migrations:

   ```bash
   npm run db:migrate
   ```

3. Seed a demo user and tenant (optional):

   ```bash
   npm run db:seed
   ```

   Then sign in with `admin@test.com` / `password123` and use tenant `demo`.

## Scripts

- `npm run dev` – start API with tsx watch
- `npm run build` / `npm start` – production
- `npm run db:migrate` – run public schema migrations
- `npm run db:seed` – seed demo user + tenant
- `npm run db:create-tenant` – CLI: `npm run db:create-tenant -- <name> <slug> <owner-email>`
- `npm run test` – run tests

## Tenant creation

New tenants are created via `POST /control/tenants` (authenticated). The API creates a new schema `tenant_<slug>` and runs the tenant migrations inside it. All tenant-scoped requests must send the `X-Tenant` header.
# komun-api
