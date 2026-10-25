# Sheggar Wheels — Full Application Package

Peer-to-peer car rental marketplace for Addis Ababa. This zip is the **complete,
self-consistent source code** of the app — every feature delivered so far, all
files in their latest version. Extract it into a fresh folder and follow the
setup below; no incremental copying from earlier feature zips is needed.

Stack: Next.js 16 (App Router) · React 19 · TypeScript (strict) · PostgreSQL 16 ·
Prisma 6 · Tailwind CSS 4 · shadcn/ui · Leaflet maps.

---

## 1. What's inside (feature map)

| Feature | Where to look |
|---|---|
| Demo sign-in / roles (RENTER, OWNER, ADMIN) | `src/lib/auth.ts`, `src/actions/auth.ts`, `src/components/auth-forms.tsx` |
| Browse + search + fuel/transmission filters | `src/app/cars/page.tsx`, `src/components/car-card.tsx` |
| Map search (Leaflet, neighbourhood clusters) | `src/components/map-view.tsx` |
| Car detail + photo gallery | `src/app/cars/[id]/page.tsx`, `src/components/photo-gallery.tsx` |
| Booking request + date overlap guard (BR-05) | `src/actions/bookings.ts`, `src/lib/bookings.ts`, `src/components/booking-form.tsx` |
| **Driving-licence review (owner decides)** | `src/components/booking-form.tsx` (submit), `src/app/owner/cars/[id]/bookings/page.tsx` (approve/decline) |
| Escrow-style payments (TeleBirr, CBE, M-Pesa, Chapa) | `src/lib/payments.ts`, `src/app/checkout/[bookingId]/page.tsx` |
| Cancellation + disputes + admin resolution | `src/actions/bookings.ts`, `src/app/admin/disputes/` |
| Reviews with owner replies | `src/app/bookings/[id]/page.tsx`, `src/actions/platform.ts` |
| Discount announcements (banner + per-car badge) | `src/actions/announcements.ts`, `src/components/announcement-ticker.tsx` |
| Owner earnings dashboard + charts | `src/app/owner/earnings/page.tsx`, `src/components/earnings-chart.tsx` |
| Admin income + CSV exports | `src/app/admin/earnings/page.tsx`, `src/app/api/export/` |
| Trip tracking (in-progress map) | `src/components/trip-tracking.tsx`, `src/lib/trips.ts` |
| Notifications (bell + page) | `src/lib/notifications.ts`, `src/components/notification-bell.tsx` |
| Car photos: device upload OR https link, max 5 | `src/components/photo-picker.tsx`, `next.config.ts` |
| Fuel categories (petrol/diesel/hybrid/electric) | `prisma/schema.prisma` (`FuelType`), browse filter |
| Security hardening (fail-closed sessions, rate limits) | `src/lib/auth.ts`, `src/lib/rate-limit.ts` |

Prisma data model: `prisma/schema.prisma` (comments map each field to the SRS
BR/FR numbers). Demo dataset: `prisma/seed.ts`.

---

## 2. Quick start (fresh machine)

Requirements: **Node.js 20+**, **npm**, **Docker Desktop** (for Postgres).

```bash
# 1. Extract this zip and enter the folder
cd sheggar-wheels

# 2. Install dependencies (this also runs prisma generate)
npm install

# 3. Configure the environment
cp .env.example .env
#    → open .env and make sure DATABASE_URL points at your Postgres,
#      then set SESSION_SECRET (generate once:  openssl rand -hex 32)

# 4. Start Postgres (pick ONE):
#    a) your existing container (sheggar-db on port 5433) — just start Docker Desktop
#    b) the repo's compose stack:  docker compose up db -d
#       then use the compose DATABASE_URL shown in .env.example

# 5. Create/update the schema from prisma/schema.prisma
npx prisma db push

# 6. Load the demo dataset (9 users, 12 cars, bookings, reviews, announcements)
npm run db:seed

# 7. Run the app
npm run dev
# → http://localhost:3000
```

**Health check:** `http://localhost:3000/api/health` returns DB latency.

> The seed is **idempotent**: it clears and re-creates the demo data every run.
> Never run it against data you want to keep.

---

## 3. Setup on YOUR machine (existing database)

Your `sheggar_wheels` database is **older but wider** than this code: it still
carries columns/tables from earlier experiments that the current app no longer
uses (`User.passwordHash`, `Message`, `Car.cancellationPolicy`,
`Booking.lateCancel`, `User.licensePhotoUrl` + friends, `LicenseStatus.NONE`).
This is why `npx prisma db push` with the bundled schema shows a data-loss
warning. Two clean ways forward:

### Path A — keep your existing data (no deletions)

Make the database itself the source of truth, then add only the licence fields:

```bash
# 1. Regenerate prisma/schema.prisma FROM your database
npx prisma db pull

# 2. Open prisma/schema.prisma and paste these 4 fields into `model Booking`
#    (anywhere between the other fields, e.g. above statusBeforeDispute):
#
#      licenseNumber       String?
#      licenseImage        String?
#      licenseStatus       LicenseStatus @default(PENDING)
#      licenseDecisionNote String?
#
#    (the LicenseStatus enum already exists in your DB, so `db pull` keeps it —
#     do NOT re-declare it; old rows may hold NONE, which the UI tolerates)

# 3. Push — this only ADDS the 4 nullable columns, nothing is dropped
npx prisma db push

# 4. Restart the dev server (it must regenerate the Prisma client)
npm run dev
```

Do **not** run `npm run db:seed` on this path — seeding wipes your data.

### Path B — clean slate (recommended before the final demo)

One command resets the database, then everything matches this package exactly:

```bash
# Wipes sheggar_wheels and re-applies the bundled schema (demo data is disposable)
npx prisma db push --force-reset

# Load the demo dataset
npm run db:seed

npm run dev
```

The dropped legacy columns (`passwordHash`, `Message`, …) are **not read by
this code** — sign-in here is the passwordless demo flow (SRS FR-01), so
nothing breaks. If you later re-add password auth or messaging, those features
ship with their own schema additions.

---

## 4. Demo accounts (sign in by email — no passwords)

| Email | Name | Roles |
|---|---|---|
| `admin@sheggarwheels.et` | Demo Admin | ADMIN |
| `daniel@sheggarwheels.et` | Daniel Bekele | OWNER |
| `selam@sheggarwheels.et` | Selam Tadesse | OWNER |
| `aklilu@sheggarwheels.et` | Aklilu Mengistu | OWNER |
| `yonas@sheggarwheels.et` | Yonas Girma | RENTER |
| `hanna@sheggarwheels.et` | Hanna Alemu | RENTER |
| `ruth@sheggarwheels.et` | Ruth Wolde | RENTER + OWNER |
| `kalkidan@sheggarwheels.et` | Kalkidan Assefa | RENTER (suspended demo) |

The sign-in page lists these accounts with one-click fill. Suspended users are
blocked from actions (BR-10) — that's Kalkidan's purpose in the demo.

**Try the licence flow end-to-end:** sign in as Yonas → open a car → request a
booking (licence number + photo are required) → sign in as the car's owner →
`Owner hub → car → Bookings` → review the licence card → Approve or Decline
(with note). The renter gets a notification either way.

### Google sign-in (optional, 5-minute setup)

The sign-in and sign-up pages show a **Continue with Google** button as soon
as two environment variables exist — and hide it automatically when they
don't. The implementation is hand-rolled OAuth 2.0 (`src/lib/google-auth.ts`,
`src/app/api/auth/google/`) with CSRF-state protection, verified-email-only
linking, rate limiting, and zero new npm dependencies.

1. Open <https://console.cloud.google.com> → create/select a project.
2. **APIs & Services → OAuth consent screen** → choose **External** → fill
   app name + your email → save. (Testing mode is fine for the demo; add your
   Google account as a test user if prompted.)
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   Application type **Web application**, then:
   - Authorized JavaScript origins: `http://localhost:3000`
   - Authorized redirect URIs: `http://localhost:3000/api/auth/google/callback`
4. Copy the Client ID and Client secret into `.env`:
   ```env
   GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
   GOOGLE_CLIENT_SECRET="GOCSPX-..."
   ```
5. **Restart** `npm run dev` → the button appears on /signin and /signup.
   First sign-in creates a RENTER account linked by verified email; if the
   Google address matches an existing demo account, you're signed into it.
6. For a deployed URL, add the same two entries with your production origin
   in Google Console, and set `NEXT_PUBLIC_SITE_URL` in `.env`.

---

## 5. Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run lint` | ESLint over the repo |
| `npm run build` | Production build (fails on type errors — intentional) |
| `npm start` | Serve the production build (standalone server) |
| `npm run db:push` | Sync `schema.prisma` → database (prompts before data loss) |
| `npm run db:seed` | Re-create the demo dataset |
| `npm run db:studio` | Prisma Studio (browse data in a GUI at port 5555) |
| `npx prisma db pull` | Regenerate schema from the database (Path A) |

Windows note: everything runs in **Git Bash** or PowerShell; the seed uses
`tsx`, so no global TypeScript runner or bun install is needed.

---

## 6. Deploying with Docker (optional)

The repo ships a production-grade stack: multi-stage Dockerfile (non-root,
healthchecked) + `docker-compose.yml` (app + Postgres 16).

```bash
cp .env.example .env       # set SESSION_SECRET (mandatory in production)
docker compose up --build
# app on http://localhost:3000 — migrations apply automatically at boot
```

Production safety: without a real `SESSION_SECRET` the server **refuses to
issue or trust session tokens** (fail-closed), and every public mutating server
action is rate-limited per IP with structured logs.

---

## 7. Known behaviours worth remembering

- Photos and licence images are stored as **data URLs** (resized in the browser
  to ≤1280 px / JPEG q0.82) or https links — no file storage service needed.
  CSP and `next/image` are already configured for both sources.
- Booking prices, discounts and fees are **snapshotted** at request time
  (BR-03/BR-04) — later price edits or expiring offers never rewrite history.
- Only `APPROVED` cars are public (BR-02); admin approves listings from
  `Admin → Listings`.
- `Booking.license*` fields are nullable so pre-feature rows and admin seeds
  stay valid; new requests always require them (zod-enforced).
