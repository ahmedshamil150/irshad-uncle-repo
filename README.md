# Irshad Finance

Single-user finance app for an ultrasound machine sales business — plain HTML/CSS/JS + Supabase.
Works on laptop and phone. Currency: PKR.

## Features

- **Dashboard** — total sale, cash, bank, adjustment (old machines taken in trade, shown when there is any), zakat and purchases for the chosen period, to-receive / to-pay balances with month/year/all-time/custom date filters, sales split by office / dealer / salesman / reference, recent sales.
- **Sales** — record sales with date, customer, sold through (**Office / Dealer / Salesman / Reference**), any number of items (one line each), total, and how it was paid (cash / bank / **adjustment**). Choosing **Dealer** optionally asks for the dealer's name (past dealer names pop up as suggestions), **Salesman** requires the salesman, and **Reference** requires the name of the person who referred the sale — each shows on the sale's detail. The **Adjustment** field is for trade-ins: write the worth of the old machine the customer gave — it counts as paid and whatever is left over is what goes to installments. When there is an adjustment you can also tag it as settled by **cash or bank** and note the **name of the adjusted item** (both optional) — they show on the sale's detail and list line, e.g. `Adj Rs 300,000 (cash) · old Logiq 2015`. The source split on the dashboard has a bar for each (including **Reference**). Installments live in an optional section that stays collapsed until needed — editing a sale restores its **actual schedule** (months + first due date) and any change always takes effect, even after payments are recorded; **Notes belong to the sale itself and are always visible** in the form. Edit, delete, search.
- **Item picker** — on the sale form, a dropdown of machine types (Logiq, Aloka, Viamo, ProSound, S-Nerve, Xario, Voluson, Aplio…15 in all) and tick-boxes for the printer and every probe kind (TVS, cardiac, phased array, linear, convex, micro convex, abdominal, endocavity, volume 4D, biplane, pencil). Ticking adds that item to the sale, unticking removes it, and every line can still be typed or edited by hand.
- **Filters** — every list tab (Sales, Purchases, Loans, Expenses, Zakat, To receive, To pay) has a ⚙ *Filters* panel with its own search box, custom from/to dates, one-tap date ranges (Today / Yesterday / This week / This month / Last month), an amount range (`1l` / `50k` style amounts work here too), a count badge, a live *X of Y match* line, a *Showing … total* line and **Clear all filters** — plus a tab-specific dropdown where it helps: Sold through / salesman / kind / status on Sales, batch vs local on Purchases, still out / past due / returned on Loans, overdue on To receive, still-to-pay / partly paid / paid on To pay. Summary cards always keep the full period totals; only the list narrows.
- **Loans (money given out)** — record cash you gave someone: who, how much, on which day, and when he will give it back. If he returns it in parts, tick **Returns in installments** and pick the months + first due date — a schedule is built like a sale's, and each row shows **pending / partial / paid / overdue** as you record the money coming back (**+ Record return** on the loan's detail sheet); when the last rupee is in, the loan marks itself **Returned**. One-tick **✓ Returned** still works for a simple loan, and the page totals what is still to get back (part payments included), what is late, and what was returned.
- **Empty lists** — stay short and quiet: *“No zakat entries yet.”*, *“No loans yet.”*, *“No expenses yet.”* — no instruction sentences; the *+ New* button sits right above the list. When filters are on instead, it says *“… match these filters.”*
- **Expenses (envelopes: money given out, then spent inside)** — record who the money was given to (**Paid to**, required — past names pop up as suggestions) and what it was for, plus the day, how much, and optional notes. Every top-level expense is a **card**: Irshad gives Rauf 30k, Rauf logs in, opens that card and taps **+ Add spend** to record each use inside it (`3k Milkman`, `1.5k tea`) — the card shows **Given / Spent / Left** (green, red once overspent) so everyone with access can follow where the money went. Tapping a card opens its detail sheet with the spends listed inside; list lines read `06 Nov 2026 · Rent · Paid to: Bilal`, the page totals this month / this year / all time count **cards only** (never double-counting their spends), and searching a spend's name finds its card with that spend drawn underneath. Each row may only be edited or removed by the person who created it — admins can change anything — and the database enforces the same rule.
- **Purchases (things bought)** — the form first asks whether this is a **Batch purchase** or a **Local purchase**, then shows the matching input: **Batch** = a whole lot bought at once, written as **one statement** (`5 machines, 20 probes, 3 printers` — however he likes it); **Local** = the item picker, the same procedure as a sale (machine-type dropdown with 15 types, printer / probe tick-boxes, free-form lines — one line per item). Editing restores whichever kind it was saved as. Either way: the day, supplier (optional), amount and notes. **How it was paid** works like a sale — enter **Cash** and/or **Bank** (a live line shows *Paid now · Left to pay*), and tick **Installments** to spread what is left over months (count + first due date, with a schedule preview); cash/bank + installments must cover the total, or it tells you what is uncovered. Rows show their balance (`Rs 80,000 left`), a **pending / partial / overdue / paid** badge and `+ Pay`, and any money still owed on a purchase joins the **To pay** tab with a *Purchase* badge. Totals this month / this year / all time, with search, edit and delete.
- **Notes everywhere** — every kind of entry (sale, purchase, expense, zakat, personal loan, what-you-owe, and each payment) has an optional Notes field, and the note shows next to the entry in its list.
- **Zakat** — its own tab to record zakat given: the day, the amount, and an optional note (e.g. on whose behalf). Totals this month / this year / all time, and the Dashboard shows a **Zakat** card for the selected date range.
- **Easy amounts** — every amount field accepts `500000`, `5l`, `50k`, `2million` or `1,50,000` and converts automatically (`k` = thousand, `l` = lac, `million` = 10 lac); tapping a field selects it so you can just start typing.
- **Salesmen** — a saved list of salesmen (seeded with Yasir, Fazal, Usman) to pick from on the sale form, plus a manager to add or delete them. Sales made by a new salesman can be added inline with **+ Add**.
- **Installments** — tick *Split what is left unpaid into monthly installments*, pick how many months + first due date; the schedule is generated automatically. Each installment shows pending / partial / paid / overdue.
- **To receive** — what customers still owe you, overdue flag, add payments (cash/bank) against a sale. When someone pays everything, tap **✓ Paid all** on their row (or *+ Add payment* inside the sale) — the remaining amount is already filled in, so just pick Cash or Bank and Save. The sale then shows *Paid in full* and drops off this list, and the dashboard totals update.
- **To pay** — what you owe dealers/suppliers, plus any purchase still owing cash/bank/installments (tagged *Purchase*), and payments against either.
- **Mobile-first** — built for phones: no page zoom when you tap a field, big tap targets, sticky Save/Cancel above the keyboard, safe-area padding (notch/home-indicator aware), the phone's Back button closes open sheets instead of leaving the app, and a bottom tab bar on small screens. It's also installable to the home screen (Add to Home Screen) with its own icon, opening like a native app.
- **Login** — one email/password per person, protected by Supabase Row Level Security, with **per-flow permissions** the admin hands out (see *Users & access levels* below).
- **Users & access (admin)** — the admin adds people from the app (**Users** button, top right): email + password creates the login too, then grant access per flow — Dashboard, Sales, To receive, To pay, Loans, Expenses, Purchases, Zakat — as **No access / Read only / Add & edit**, plus a separate **Delete** tick per flow. A read-only person only looks and searches; a writer adds and edits but sees no ✕ unless the delete tick is there; a flow with no access doesn't even show its tab. Row Level Security enforces the same rules in the database, so one person can manage the expenses sheet while seeing nothing else at all.

## Files

```
index.html            app shell (screens + modals), loads the js/ files in order
styles.css            styling, mobile-first
js/                   all app logic — one file per feature (explained in CODE_GUIDE.md)
  core.js               foundation: Supabase client + helpers (money, dates, modals)
  auth.js               login screen + session
  navigation.js         shared state object + tab switching
  filters.js            the shared ⚙ Filters engine (used by 6 list tabs)
  items.js              item picker shared by the Sale and Purchase forms
  dashboard.js          dashboard totals for the chosen date range
  sales.js              sales list, detail sheet, salesmen, sale form
  receivables.js        "To receive" (customers still owe us)
  payables.js           "To pay" (we owe dealers/suppliers)
  loans.js              money given out + detail sheet + return schedule
  expenses.js           expense cards + the spends recorded inside them (envelopes)
  purchases.js          things bought (batch or local)
  zakat.js              zakat given
  payments.js           the shared payment sheet (sale / owe / purchase / loan)
  users.js              admin sheet: user list + per-flow access grants
  main.js               wires every button to its code, then starts the app (loads last)
vendor/supabase.js    supabase-js library, served locally (no CDN needed)
build.js              builds dist/, injects Supabase config from env vars
package.json          npm scripts (build / start)
vercel.json           Vercel build command + output directory
.env.example          template for local environment variables
supabase/schema.sql   database tables, RLS, per-flow permissions, admin user functions
CODE_GUIDE.md         plain-English walkthrough of the code + technologies used
```

## Setup

### 1. Create the database

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**
2. Paste the entire contents of `supabase/schema.sql` and click **Run**
3. You should see `Success. No rows returned`

This creates the 12 tables (`sales`, `installments`, `purchase_installments`, `loan_installments`,
`payables`, `payments`, `salesmen`, `personal_loans`, `expenses`, `purchases`, `zakat`, `app_users`)
and enables RLS: every read/write/delete is checked against that person's permissions
(see *Users & access levels* below). `expenses` additionally carries `parent_id` (a spend
inside a card) and `created_by` (who may change it), backfilled for any existing rows.
It also seeds the salesmen list
with **Yasir**, **Fazal** and **Usman** (safe to re-run — existing names are skipped).

> **Upgrading an older database?** Just paste and Run the file again — it is idempotent.
> While the new `app_users` table is empty, every login that already exists is promoted to
> **admin**, so nothing you have breaks; from then on new logins start with no access until
> you grant it in the app.

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

**Create the first login account — no password is stored in this repository:**

1. Supabase Dashboard → **Authentication → Users** → **Add user**
2. Enter an email + password of your choice, tick **Auto Confirm**
3. Log in with those credentials on desktop and phone
4. That first account becomes the **admin** — after that, add everyone else from the
   **Users** button inside the app (they get their own password and their own access)

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

## Users & access levels

The admin can give other people their own login and control exactly what each one sees.

1. Log in as the admin → click **Users** (top right) → **+ Add user**
2. Enter their **email** and a **password** (6+ characters) — this creates their Supabase
   login too. Leave the password blank only when you already created that login in the
   Supabase dashboard (then this just grants access to it).
3. Optionally give them a **name**, and tick **Admin** if they should manage users as well
4. Under **Access by flow**, choose what each screen gets:
   - **No access** — the tab is hidden and the database returns nothing for them
   - **Read only** — they can open the screen, search and filter, but change nothing
   - **Add & edit** — they can also add and edit entries
   - **Delete** (the tick beside each flow) — only then does the ✕ / Delete button appear
5. **Save**. Tap their row later to change anything, or **Remove** to delete them and their login

**Example:** give someone **Expenses → Add & edit** and nothing else. They log in and land
straight on Expenses, can add expenses and record spends inside the cards, but the ✕ stays
hidden — and every other tab (and all its data) is invisible to them. They can also only
change rows they created themselves: Irshad's 30k card is open for Rauf to see and spend
inside, but he can't edit or delete the card (the admin can change everything). The same
rules are enforced in the database by Row Level Security (`app_can()` plus the
ownership check on `expenses.created_by` in `supabase/schema.sql`), so the hidden buttons
are not the only guard.

Things worth knowing:

- The **first** account ever created is the admin. Admins see every screen, manage the Users
  sheet, and are protected from locking themselves out (you can't remove your own admin tick
  or your own account).
- **Already using the app?** Re-running `schema.sql` promotes every existing login to admin
  while `app_users` is empty — your current setup keeps working, then you can dial people's
  access down one flow at a time.
- Tabs, *+ New* buttons, row Edit/✕/Pay buttons, dashboard cards and even the sale/loan detail
  actions all appear and disappear automatically to match each person's access.

## Security notes

- Credentials live in environment variables (`.env` locally, Vercel dashboard for deploys) — nothing secret is committed to Git.
- Access is enforced **twice**: the UI hides what a person may not touch, and Supabase Row Level Security (`app_can()` in `supabase/schema.sql`) refuses the same operations in the database — a restricted login cannot read or write other flows even by calling the API directly.
- The anon key still ends up inside the built `dist/config.js` — that is unavoidable and safe: it only works with RLS enabled, so it can't bypass the login.
- The **service_role key** must never be put in these env vars or in any frontend code. If it was shared anywhere, rotate it: **Settings → API → Rotate service_role key**.
- To change the password: reset it in **Authentication → Users**. Login credentials are never stored in this repository.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, console: `Failed to fetch` from a CDN | Old version loaded the library from `esm.sh` | Pull latest code — the library is now bundled locally in `vendor/` |
| Page shows "Configuration missing" | Project root was served instead of `dist/` | Run `npm start` (never `npx serve .`) |
| Login says "Invalid email or password" | Login user not created yet, or wrong password | Add the user in Supabase → Authentication → Users (Auto Confirm), or let the admin add them from the **Users** button |
| Toast: "Permissions not active yet — run the new schema.sql" | The users/access feature is newer than your database | Paste `supabase/schema.sql` into the SQL Editor and Run again (safe to re-run) |
| Someone logs in but every tab is hidden / "ask the admin to grant it" | Their account has no access yet | Admin → **Users** → tap their row → set the flows → Save |
| The **Users** button is missing | Signed in with a non-admin account (or schema not re-run) | Use the admin login, or tick **Admin** for your account in the Users sheet |
| Vercel build fails: "SUPABASE_URL must be set" | Env vars missing in Vercel | Settings → Environment Variables → add both |
| Port 3000 already in use | Another server is running | Close it, or use `npx serve dist -l 3001` |

## Typical day

1. Open on phone → log in once (stays logged in)
2. **Sales → + New sale** after each machine sale (open *Installments & notes* if on a plan)
3. **To receive** → tap a customer → *+ Add payment* when money comes in
4. **To pay** → *+ Add what you owe* for a dealer, *+ Pay* when you pay
5. **Loans** → *+ New loan* when you hand money to someone, tick *✓ Returned* when it comes back
6. **Expenses** → *+ New expense* when you hand cash out (a card, e.g. 30k to Rauf); open the card and *+ Add spend* for each use inside it — the sheet keeps **Given / Spent / Left** for everyone
7. **Dashboard** → month/year totals whenever needed
