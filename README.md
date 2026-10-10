# Irshad Finance

Single-user finance app for an ultrasound machine sales business — plain HTML/CSS/JS + Supabase.
Works on laptop and phone. Currency: PKR.

## Features

- **Dashboard** — total sale, cash, bank, loan, debit, credit, dues (lena hai / dena hai) balances with month/year/all-time/custom date filters, sales split by office/dealer/salesman, recent sales.
- **Sales** — record sales with date, customer, source (office / dealer / salesman), item, total, cash/bank/loan split, notes. Edit, delete, search.
- **Installments** — mark a sale as installment, pick number of months + first due date; the schedule is generated automatically. Each installment shows pending / partial / paid / overdue.
- **Dues (Lena Hai)** — what customers still owe you, overdue flag, record payments (cash/bank) against a sale.
- **Dues (Dena Hai)** — what you owe dealers/suppliers, record payments against them.
- **Expenses & Income** — debit / credit entries with Dr, Cr, Net totals.
- **Login** — single email/password protected by Supabase Row Level Security.

## Files

```
index.html            app shell (screens + modals)
styles.css            styling, mobile-first
app.js                all logic (Supabase auth + CRUD)
vendor/supabase.js    supabase-js library, served locally (no CDN needed)
build.js              builds dist/, injects Supabase config from env vars
package.json          npm scripts (build / start)
vercel.json           Vercel build command + output directory
.env.example          template for local environment variables
supabase/schema.sql   database tables, RLS, login user
```

## Setup

### 1. Create the database

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**
2. Paste the entire contents of `supabase/schema.sql` and click **Run**
3. You should see `Success. No rows returned`

This creates 5 tables (`sales`, `installments`, `payables`, `payments`, `ledger_entries`)
and enables RLS (only a signed-in user can touch data).

**Create the login account — no password is stored in this repository:**

1. Supabase Dashboard → **Authentication → Users** → **Add user**
2. Enter an email + password of your choice, tick **Auto Confirm**
3. Log in with those credentials on desktop and phone

### 2. Configure environment variables

Credentials are **never hardcoded** — they come from environment variables:

```bash
copy .env.example .env     # then edit .env with your values
```

`.env` (local only, git-ignored):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Run locally

```bash
npm start
```

This runs the build (injects env vars into `dist/config.js`) and serves **http://localhost:3000**

Manual alternative: `npm run build` then `npx serve dist`

(Always serve over http — opening `index.html` with `file://` will not work.)

### 4. Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) → import this folder (drag & drop) or the GitHub repo
2. **Before deploying**, add the environment variables:
   **Settings → Environment Variables → Add** both:
   - `SUPABASE_URL` = `https://skbobzpbgsusleianoqb.supabase.co`
   - `SUPABASE_ANON_KEY` = your anon public key
3. Leave build settings alone — `vercel.json` already sets
   build command `npm run build` and output directory `dist`
4. Click **Deploy** — done

> If you skip step 2 the build fails with a clear error telling you which variables are missing.

## Security notes

- Credentials live in environment variables (`.env` locally, Vercel dashboard for deploys) — nothing secret is committed to Git.
- The anon key still ends up inside the built `dist/config.js` — that is unavoidable and safe: it only works with RLS enabled, so it can't bypass the login.
- The **service_role key** must never be put in these env vars or in any frontend code. If it was shared anywhere, rotate it: **Settings → API → Rotate service_role key**.
- To change the password: reset it in **Authentication → Users**. Login credentials are never stored in this repository.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, console: `Failed to fetch` from a CDN | Old version loaded the library from `esm.sh` | Pull latest code — the library is now bundled locally in `vendor/` |
| Page shows "Configuration missing" | Project root was served instead of `dist/` | Run `npm start` (never `npx serve .`) |
| Login says "Invalid email or password" | Login user not created yet, or wrong password | Add the user in Supabase → Authentication → Users (Auto Confirm) |
| Vercel build fails: "SUPABASE_URL must be set" | Env vars missing in Vercel | Settings → Environment Variables → add both |
| Port 3000 already in use | Another server is running | Close it, or use `npx serve dist -l 3001` |

## Typical day

1. Open on phone → log in once (stays logged in)
2. **Sales → + New sale** after each machine sale (tick *Installment* if on a plan)
3. **Dues (Lena Hai)** → tap a customer → *Record payment* when money comes in
4. **Dues (Dena Hai)** → add what you owe a dealer, *+ Pay* when you pay
5. **Expenses & Income** → Debit/Credit entries for expenses, withdrawals, capital, etc.
6. **Dashboard** → month/year totals whenever needed
