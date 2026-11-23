# Weekend Kitchen – pre-orders

A pre-order web app for a weekend home kitchen in Pune. Customers pick dishes, choose a pickup day and slot, and pay by UPI through Razorpay. The kitchen runs pickups from a phone-friendly admin page.

Stack: Next.js 15 (App Router, TypeScript), Tailwind CSS 4, Supabase (Postgres, Auth, Realtime, Storage), Razorpay Standard Checkout, Vercel.

## Setup

1. Install Node 20+ and run `npm install`.
2. Create a Supabase project at [supabase.com](https://supabase.com).
3. Copy the env file and fill it in:
   ```bash
   cp .env.example .env.local
   ```
   - The Supabase URL, anon key and service role key are in **Project Settings → API**.
   - The Razorpay key id and secret are in **Dashboard → Account & Settings → API Keys**. Use **Test mode** keys (`rzp_test_…`) while testing. Set `NEXT_PUBLIC_RAZORPAY_KEY_ID` to the same value as `RAZORPAY_KEY_ID`.
   - `RAZORPAY_WEBHOOK_SECRET` is any random string. Enter the same string when you create the webhook (see below).
   - `ADMIN_EMAILS` is a comma-separated list of emails that may use `/admin`.
   - `NEXT_PUBLIC_SITE_URL` is the public URL of the site, used in login emails.
4. Run the database migrations and seed (next section).
5. Set up admin login (see [Admin login setup](#admin-login-setup)).
6. Edit the kitchen name, tagline, pickup address and WhatsApp number in `lib/config.ts`.
7. Start the dev server with `npm run dev`. The shop is at http://localhost:3000 and the admin at http://localhost:3000/admin.

## Database migrations

The migrations are in `supabase/migrations/` and run in filename order:

| File | What it adds |
| --- | --- |
| `20261124000000_init.sql` | Tables, RLS, `place_order`, `get_availability` |
| `20261201000000_admin.sql` | Admins and `is_admin()`, admin read policies, Realtime on `orders`, rate limiting, the max-2-pending-per-phone rule, day `label`/`is_tasting_day`, and the `menu-images` storage bucket |

**Option A: SQL Editor.** In the Supabase dashboard, open **SQL Editor**. Paste and run each migration in order, then `supabase/seed.sql`.

**Option B: Supabase CLI.**
```bash
npx supabase init          # once; creates supabase/config.toml and keeps the existing files
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push --include-seed
```

The seed creates:
- the 4 dishes
- next Saturday and Sunday, using the default order window (below)
- three slots per day (12–1, 1–2, 2–3 PM), 40 orders each
- 75 mutton and 25 chicken bowls per day

It is safe to run the seed again. To add more days, use **Admin → Settings**.

## Admin login setup

Admins sign in with an email magic link (Supabase Auth). An email can use `/admin` if it is in `ADMIN_EMAILS` or in the `admins` table. Anyone else who signs in sees "Not allowed". Login links are only sent to admin emails.

In the Supabase dashboard:

1. **Authentication → URL Configuration**:
   - Set **Site URL** to your site URL (for example `https://orders.example.com`, or `http://localhost:3000` for local testing).
   - Add `http://localhost:3000/auth/confirm` and `https://<your-domain>/auth/confirm` under **Redirect URLs**.
2. **Authentication → Email Templates → Magic Link**: change the link to the line below. This is recommended on phones: the default link only works in the same browser that requested it, so it fails when Gmail opens it in its own browser. This version works anywhere.
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/admin">Log in</a>
   ```
3. Optional: to add more admins without redeploying, insert their emails in lowercase:
   ```sql
   insert into public.admins (email) values ('helper@example.com');
   ```

Supabase's built-in email service has a low hourly limit. For real use, set up custom SMTP under **Project Settings → Auth**.

## Using the admin

**Orders (`/admin`)**
- The day switcher at the top opens on today, or the next upcoming day if there is no service today.
- **Summary cards:**
  - paid orders and revenue (paid + ready + picked up)
  - orders still to pick up (paid + ready)
- **Dish totals card:**
  - bowls of each dish across paid, ready and picked-up orders. This is your cooking list.
  - for each category (mutton, chicken), bowls sold against the day's limit, bowls on hold in unpaid orders, and bowls left
- **Orders list:**
  - grouped by slot, with tap-to-call phone numbers
  - one-tap **Mark Ready** and **Mark Picked up** buttons, and **Undo** for mis-taps
  - **Cancel** asks you to confirm first. Cancelling an unpaid order releases its stock and slot straight away. Cancelling a paid order means you must refund it in Razorpay.
- **Filters:** status (All, Paid, Ready, Picked up, Cancelled), and search by name, phone or order number.
- Unpaid orders older than 10 minutes are hidden by default. A tick box shows them.
- **Live updates:** the page updates through Supabase Realtime, with a 1-minute fallback and a refresh when the phone wakes up. Turn on **🔔 Sound** to hear a beep for each new paid order; a green banner also counts them.
- **Refund needed:** if a customer pays after you cancelled their order, the order stays cancelled (its stock was already released). It is marked **Refund needed**, and the customer's order page tells them a refund is coming.

**Settings (`/admin/settings`)**
- **Service days:**
  - add a date (with default slots, stock and order window)
  - edit the label, the open and close times (IST), enabled, and tasting day
  - delete a day if it has no orders
- **Slots:** start, end and capacity. Capacity is the number of orders. A slot that has orders can be switched off but not deleted.
- **Stock:** one limit per category per day. Mutton dishes share one limit, chicken dishes share another. Each category shows bowls sold, on hold, the limit and bowls left, plus a breakdown by dish. Note: the Sprint 2 brief asked for a limit per dish, but this keeps the Sprint 1 decision of one shared limit per category.
- **Menu:**
  - add or edit a dish: name, description, price in rupees (stored as paise), stock group, sort order, and whether it shows on the menu
  - photo upload: photos are shrunk in the browser to 1200px JPEG, then uploaded to the `menu-images` bucket
  - price changes only affect new orders. Each existing order keeps the prices it was placed at.

## Order window

A day shows to customers only if it is enabled and `opens_at ≤ now < closes_at` (times are in Asia/Kolkata). An empty `opens_at` or `closes_at` means no limit on that side. The same rule is enforced again in `place_order`. When no day is open, the menu says *"Orders are closed right now. Next orders open Friday."* and shows a WhatsApp button. If a later day already has an opening time set, the message names that day instead of Friday.

Default schedule for new days:

| Day | Opens | Closes |
| --- | --- | --- |
| Saturday | Friday 00:00 | Friday 21:00 |
| Sunday | Friday 00:00 | Saturday 21:00 |
| Other days (tasting) | the previous Friday 00:00 | 21:00 the day before |

## How it works

- **One way to place an order.** `POST /api/orders` validates input with zod, applies the per-IP rate limit, and calls the Postgres function `place_order`. That function:
  - locks the day, and then the phone number
  - checks the order window, the 2-pending-orders-per-phone limit, slot capacity and the shared category stock
  - totals the order from DB prices
  - inserts the order and its items, all in one transaction
- **Holds.** An order counts against capacity and stock if it is paid, ready or picked up, or if it is `pending_payment` and less than 10 minutes old. The same rule is written in TypeScript in `lib/availability.ts`, which powers the admin counts.
- **Rate limits.**
  - Each phone number can have at most 2 unpaid orders from the last 10 minutes (checked in `place_order`).
  - Each IP can place at most 10 orders per 10 minutes. This is counted in the `rate_limit_events` table, which stores a hash of the IP, not the IP itself. You can change it in `ORDER_RATE_LIMIT` in `lib/config.ts`.
- **Payment confirmation.** `/api/payments/verify` and `/api/payments/webhook` both check the signature and run the same idempotent update from `pending_payment` to `paid`. Admin buttons only move orders that are already paid (`paid → ready → picked_up`, and Undo goes back one step), so they can never race with payment confirmation.
- **Security.**
  - The anon key can only read the public catalogue.
  - Signed-in admins can read through RLS (`is_admin()`), which Realtime needs.
  - Every admin write goes through a Server Action that calls `requireAdmin()` and then uses the service role.
- **Confirmation page.** It is at `/order/<public_token>`, a random UUID, not the internal id.

## Tests

```bash
npm test          # Vitest: order window, stock/hold counting, slot labels, rupee parsing
npm run test:db   # SQL tests against a real database (needs DATABASE_URL)
```

`supabase/tests/order_rules.sql` runs inside a transaction and rolls back at the end, so it is safe to run on a dev database. It checks:
- server-side totals
- the shared category stock
- the 10-minute hold
- that paid orders hold stock and cancelled ones don't
- that slot capacity counts orders
- the 2-pending-orders-per-phone limit
- the open, closed and disabled order window
- the rate-limit helper

It prints `ALL DB TESTS PASSED` when everything passes. Use the **direct** connection string from **Project Settings → Database**, or a local `supabase start` database.

## Testing with Razorpay test mode

1. Use `rzp_test_…` keys in `.env.local` and restart `npm run dev`.
2. Make sure a day is open. In Settings, set its "Orders open" time to the past, or leave it empty.
3. Add items, go to checkout, pick a day and slot, enter a name and any valid mobile number (for example `9876543210`), and tap **Pay**.
4. In the Razorpay popup:
   - **UPI:** enter `success@razorpay` for a successful payment, or `failure@razorpay` for a failed one.
   - **Card:** `4111 1111 1111 1111` (or another card from Razorpay's [test card list](https://razorpay.com/docs/payments/payments/test-card-details/)), any future expiry, any CVV, OTP `1234`.
5. You should land on "Order K-1001 confirmed". The order should also appear on `/admin` with a beep if sound is on.
6. Close the popup without paying. You should see **Try again**, and the cart should still be there.

### Testing the webhook locally

```bash
npx cloudflared tunnel --url http://localhost:3000   # or: ngrok http 3000
```

In the Razorpay Dashboard (Test mode), go to **Webhooks → Add new webhook**:
- URL: `https://<tunnel-host>/api/payments/webhook`
- Secret: the value of `RAZORPAY_WEBHOOK_SECRET`
- Events: `payment.captured` (and optionally `order.paid`)

To test the backup path, pay and then close the tab before the redirect. The order should still become `paid`.

## Deploying to Vercel

1. Import the repo into Vercel.
2. Add all the variables from `.env.example` (except `DATABASE_URL`) under **Project → Settings → Environment Variables**, and deploy.
3. Point the Supabase Site URL and Redirect URLs at your domain.
4. Create the Live-mode Razorpay webhook to `https://<your-domain>/api/payments/webhook`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | SQL tests (`DATABASE_URL` required) |
