# Irshad Finance

Single-user finance app for an ultrasound machine sales business — plain HTML/CSS/JS + Supabase.
Works on laptop and phone. Currency: PKR.

## Features

- **Dashboard** — total sale, cash, bank, zakat and purchases for the chosen period, to-receive / to-pay balances with month/year/all-time/custom date filters, sales split by office / dealer / salesman / reference, recent sales.
- **Sales** — record sales with date, customer, sold through (**Office / Dealer / Salesman / Reference**), any number of items (one line each), total, and how it was paid (cash / bank). Choosing **Reference** asks for the name of the person who referred the sale — it shows on the sale's detail and gets its own bar in the dashboard's source split. Installments live in an optional section that stays collapsed until needed; **Notes belong to the sale itself and are always visible** in the form. Edit, delete, search.
- **Item picker** — on the sale form, a dropdown of machine types (Logiq, Aloka, Viamo, ProSound, S-Nerve, Xario, Voluson, Aplio…15 in all) and tick-boxes for the printer and every probe kind (TVS, cardiac, phased array, linear, convex, micro convex, abdominal, endocavity, volume 4D, biplane, pencil). Ticking adds that item to the sale, unticking removes it, and every line can still be typed or edited by hand.
- **Filters** — the ⚙ *Filters* button on Sales narrows the list by source (office / dealer / salesman / reference), salesman name, kind (installments or one-time), payment status (paid in full / still to receive), any date or period (with Today / Yesterday / This week / This month / Last month one-taps), and amount range (`1lac` style amounts work here too). A line under the toolbar shows how many match and their totals.
- **Loans (money given out)** — record cash you gave someone: who, how much, on which day, and when he will give it back. Tick **✓ Returned** when the money comes back; the page totals what is still to get back, what is late, and what was returned.
- **Expenses (money spent)** — just record what money went out: the day, what it was for (rent, salary, bills… suggestions pop up), how much, and optional notes. The page totals this month, this year, and all time, and you can search past expenses.
- **Purchases (things bought)** — its own tab using the **same item procedure as a sale**: the machine-type dropdown (15 types), the printer / probe tick-boxes and free-form lines — one line per item — plus the day, supplier (optional), amount and notes. Totals this month / this year / all time, with search, edit and delete.
- **Notes everywhere** — every kind of entry (sale, purchase, expense, zakat, personal loan, what-you-owe, and each payment) has an optional Notes field, and the note shows next to the entry in its list.
- **Zakat** — its own tab to record zakat given: the day, the amount, and an optional note (e.g. on whose behalf). Totals this month / this year / all time, and the Dashboard shows a **Zakat** card for the selected date range.
- **Easy amounts** — every amount field accepts `500000`, `5lac`, `50hazar`, `2cr` or `1,50,000` and converts automatically; tapping a field selects it so you can just start typing.
- **Salesmen** — a saved list of salesmen (seeded with Yasir, Fazal, Usman) to pick from on the sale form, plus a manager to add or delete them. Sales made by a new salesman can be added inline with **+ Add**.
- **Installments** — tick *Split what is left unpaid into monthly installments*, pick how many months + first due date; the schedule is generated automatically. Each installment shows pending / partial / paid / overdue.
- **To receive** — what customers still owe you, overdue flag, add payments (cash/bank) against a sale. When someone pays everything, tap **✓ Paid all** on their row (or *+ Add payment* inside the sale) — the remaining amount is already filled in, so just pick Cash or Bank and Save. The sale then shows *Paid in full* and drops off this list, and the dashboard totals update.
- **To pay** — what you owe dealers/suppliers, add payments against them.
- **Mobile-first** — built for phones: no page zoom when you tap a field, big tap targets, sticky Save/Cancel above the keyboard, safe-area padding (notch/home-indicator aware), the phone's Back button closes open sheets instead of leaving the app, and a bottom tab bar on small screens. It's also installable to the home screen (Add to Home Screen) with its own icon, opening like a native app.
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

This creates 7 tables (`sales`, `installments`, `payables`, `payments`, `salesmen`, `personal_loans`, `expenses`)
and enables RLS (only a signed-in user can touch data). It also seeds the salesmen list
with **Yasir**, **Fazal** and **Usman** (safe to re-run — existing names are skipped).

> **Connecting with `psql` instead of the SQL Editor?** Newer Supabase projects publish the
> direct host (`db.<ref>.supabase.co`) as **IPv6-only**, so on an IPv4-only network you get
> `ENOTFOUND` / `getaddrinfo` failures even though the dashboard works fine. Use the
> **session pooler** host instead — it has IPv4:
>
> ```
> postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
> ```
>
> Note the username carries the project ref (`postgres.<ref>`), and a password containing `@`
> must be percent-encoded (`%40`) when written in a connection **URL** — but passed literally
> when set as a `password` property in a driver. The app itself is unaffected: it talks to
> Supabase over HTTPS, which works on IPv4.

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
2. **Sales → + New sale** after each machine sale (open *Installments & notes* if on a plan)
3. **To receive** → tap a customer → *+ Add payment* when money comes in
4. **To pay** → *+ Add what you owe* for a dealer, *+ Pay* when you pay
5. **Loans** → *+ New loan* when you hand money to someone, tick *✓ Returned* when it comes back
6. **Expenses** → *+ New expense* whenever money is spent (rent, bills, salary…)
7. **Dashboard** → month/year totals whenever needed
