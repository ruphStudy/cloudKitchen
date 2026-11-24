# Weekend Kitchen – pre-orders

A pre-order web app for a weekend home kitchen in Pune. Customers pick dishes, choose a pickup day and slot, and pay by UPI through Razorpay. The kitchen runs pickups, coupons, refunds and feedback from a phone-friendly admin page.

Stack: Next.js 15 (App Router, TypeScript), Tailwind CSS 4, Supabase (Postgres, Auth, Realtime, Storage), Razorpay Standard Checkout, Vercel.

## Setup

1. Install Node 20+ and run `npm install`.
2. Create a Supabase project at [supabase.com](https://supabase.com).
3. Copy the env file and fill it in with `cp .env.example .env.local`:
   - The Supabase URL, anon key and service role key are in **Project Settings → API**.
   - The Razorpay key id and secret are in **Dashboard → Account & Settings → API Keys**. Use **Test mode** keys (`rzp_test_…`) while testing. Set `NEXT_PUBLIC_RAZORPAY_KEY_ID` to the same value as `RAZORPAY_KEY_ID`.
   - `RAZORPAY_WEBHOOK_SECRET` is any random string. Enter the same string when you create the webhook.
   - `ADMIN_EMAILS` is a comma-separated list of emails that may use `/admin`.
   - `NEXT_PUBLIC_SITE_URL` is your public URL. It is used in login emails, link previews and feedback links. It is baked in when the app is built, so set it before you build.
   - `NEXT_PUBLIC_WHATSAPP_NUMBER` is your WhatsApp number with the country code, digits only (for example `919876543210`). If it is empty, all WhatsApp buttons are hidden.
4. Run the database migrations and seed (next section).
5. Set up admin login (see [Admin login setup](#admin-login-setup)).
6. Edit the kitchen name, tagline and pickup address in `lib/config.ts`.
7. Start the dev server with `npm run dev`. The shop is at http://localhost:3000 and the admin at http://localhost:3000/admin.

## Database migrations

The migrations are in `supabase/migrations/` and run in filename order:

| File | What it adds |
| --- | --- |
| `20261124000000_init.sql` | Tables, RLS, `place_order`, `get_availability` |
| `20261201000000_admin.sql` | Admins and `is_admin()`, admin read policies, Realtime on `orders`, rate limiting, the max-2-unpaid-orders-per-phone rule, day `label`/`is_tasting_day`, and the `menu-images` bucket |
| `20261208000000_coupons_tasting_feedback.sql` | Coupons (`evaluate_coupon`, `used_count`), tasting-day rules in `place_order`, the shared `mark_order_paid`, the `refunded` status and refund fields, and feedback spice/quantity |

**Option A: SQL Editor.** Paste and run each migration in order, then `supabase/seed.sql`.

**Option B: Supabase CLI.**
```bash
npx supabase init          # once; creates supabase/config.toml and keeps the existing files
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push --include-seed
```

The seed creates:
- the 4 dishes
- next Saturday and Sunday, using the default order window
- three slots per day (12–1, 1–2, 2–3 PM), 40 orders each
- 75 mutton and 25 chicken bowls per day

It is safe to run the seed again. To add more days, use **Admin → Settings**.

## Admin login setup

Admins sign in with an email magic link. An email can use `/admin` if it is in `ADMIN_EMAILS` or in the `admins` table. Anyone else who signs in sees "Not allowed".

In the Supabase dashboard:
1. **Authentication → URL Configuration**:
   - Set **Site URL** to your domain.
   - Add `http://localhost:3000/auth/confirm` and `https://<your-domain>/auth/confirm` to **Redirect URLs**.
2. **Authentication → Email Templates → Magic Link**: change the link to the line below. The default link only works in the same browser that requested it, so it fails when Gmail on a phone opens it in its own browser. This version works anywhere.
   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/admin">Log in</a>
   ```
3. Optional: add more admins without redeploying:
   ```sql
   insert into public.admins (email) values ('helper@example.com');
   ```
   Emails must be lowercase.

## Features

### Customer
- **Menu** (`/`): sticky cart bar. When only tasting days are open, the cart is limited to 1 bowl.
- **Checkout** (`/checkout`):
  - pick a day and slot, enter name and mobile
  - **Have a coupon?** opens a code box; the server checks the code and the summary shows a discount line
  - pay by UPI
- **Confirmation** (`/order/<token>`):
  - order details
  - **Send to WhatsApp** (sends your number the order no, name, day, slot and items)
  - a feedback link
  - refund status when a refund has been made
- **Feedback**:
  - `/feedback/<token>`: taste 1–5 (emoji buttons), spice and quantity (want less / just right / want more), and an optional comment. One submission per order. Afterwards it says thank you and links to next weekend's menu.
  - `/feedback`: for the **QR code printed on bowls**. The customer types their order number and mobile number and is taken to the page above. The mobile number is pre-filled on the device they ordered from. Lookups are rate-limited per IP.
- **WhatsApp help button** floats on every customer page.

### Tasting days
When a service day has `is_tasting_day = true`, `place_order` enforces these rules on the server, inside the same lock as stock and capacity:
- exactly **1 item** per order. Otherwise the customer sees *"Tasting day: 1 bowl per person"*.
- **one paid order per phone** for that day. Otherwise they see *"You've already booked your taste bowl!"*.
- if the same phone tries again (for example after changing the slot), the new attempt replaces their earlier unpaid one, so retries don't get stuck.

### Coupons
- **Validation:** the server checks that the coupon is active, inside its valid-from/until dates, meets the minimum order, and hasn't reached its max uses. Unpaid orders from the last 10 minutes count towards max uses, so the last use can't be taken twice.
- **Discount:** flat (₹) or percent. The order total never goes below ₹1.
- **One source of truth:** the check runs inside `place_order` (`evaluate_coupon`), so the discount can't be bypassed. `/api/coupons/validate` is only a preview for the checkout screen.
- **Counting uses:** `used_count` goes up only when an order becomes paid, inside `mark_order_paid`, the same idempotent update used by the verify route and the webhook. It goes up exactly once even if both run.
- **Admin → Coupons:** list, create, disable and enable coupons.

### Admin
- **Orders:**
  - status buttons, Realtime updates and the dish totals (Sprint 2)
  - an **Export orders CSV** button for the selected day
  - **Ask feedback** on picked-up orders opens WhatsApp to the customer with their feedback link
- **Refunds:**
  - Orders marked **Refund needed** (cancelled with a payment) have a **Refund ₹X** button. It calls the Razorpay refund API on the server, saves the refund id and sets the order to `refunded`. The customer's order page then shows the refund.
  - If the API call fails, you see Razorpay's error message and a **Mark refunded manually** button appears. Use it when you refund through the Razorpay dashboard or by UPI. A red banner at the top counts the refunds still needed.
- **Coupons:** see above.
- **Feedback:**
  - average taste per dish
  - spice and quantity counts
  - latest comments
  - **Export feedback CSV**
- **CSVs** open in Excel and Google Sheets. They include ₹ amounts and a byte-order mark so Indian-language names show correctly. Cells that start with `=`, `+`, `-` or `@` get a `'` prefix so a spreadsheet can't run them as formulas.

## Order window

A day shows to customers only if it is enabled and `opens_at ≤ now < closes_at` (times are in Asia/Kolkata). `place_order` enforces the same rule. When no day is open, the menu says *"Orders are closed right now. Next orders open Friday."* and shows a WhatsApp button.

| Day | Opens | Closes |
| --- | --- | --- |
| Saturday | Friday 00:00 | Friday 21:00 |
| Sunday | Friday 00:00 | Saturday 21:00 |
| Other days (tasting) | the previous Friday 00:00 | 21:00 the day before |

## How it works

- **Only one way to place an order.** `POST /api/orders`:
  - validates the input with zod
  - applies a per-IP rate limit
  - calls `place_order`, which locks the day, then the phone, then the coupon
  - `place_order` then checks the order window, tasting rules, the 2-unpaid-orders-per-phone limit, slot capacity, shared category stock and the coupon, prices the order from the DB, and inserts it, all in one transaction
- **Holds.** An order counts against capacity and stock if it is paid, ready or picked up, or if it is unpaid and less than 10 minutes old.
- **Payment confirmation.** `mark_order_paid` locks the order row, so it is safe when the verify route and the webhook run at the same time.
  - **Unpaid:** the order becomes `paid` and the coupon's `used_count` goes up by one.
  - **Already paid:** nothing changes.
  - **Cancelled:** the order stays cancelled but the payment is recorded, so it shows *Refund needed*.
  - **Refunded:** the payment is not applied.
- **Status flow.** `paid → ready → picked_up`, and Undo goes back one step. Cancel releases stock. `refunded` is only possible from cancelled orders that have a payment.
- **Security.**
  - The anon key can read only the catalogue.
  - Admins can read through RLS (`is_admin()`).
  - Every admin write goes through a Server Action that calls `requireAdmin()` and then uses the service role.
  - Customer links (order, feedback) use the random `public_token`, never the internal id.

## Tests

```bash
npm test          # Vitest: order window, stock/hold counting, slot labels, rupees, CSV, WhatsApp text, feedback stats, order-no parsing
npm run test:db   # SQL tests against a real database (needs DATABASE_URL); runs in a transaction and rolls back
```

The SQL tests check:
- **Sprints 1–2:** server-side totals, shared category stock, the 10-minute hold, slot capacity, the per-phone unpaid limit, the order window and the rate-limit helper
- **Sprint 3:**
  - flat and percent coupons, and the ₹1 minimum total
  - invalid, inactive, expired and below-minimum-order coupons
  - max uses, including uses held by unpaid orders
  - `used_count` goes up only on payment, and only once even when payment is confirmed twice
  - `mark_order_paid` results: amount mismatch, paid after cancel, refunded, and order not found
  - tasting days: only 1 item, only one paid order per phone, and a retry replaces the earlier unpaid order

## Testing with Razorpay test mode

1. Use `rzp_test_…` keys in `.env.local` and restart `npm run dev`.
2. Make sure a day is open (Admin → Settings → set "Orders open" to the past).
3. Add items, go to checkout, pick a day and slot, enter a name and any valid mobile number, and tap **Pay**.
4. In the Razorpay popup:
   - **UPI:** `success@razorpay` for a successful payment, `failure@razorpay` for a failed one.
   - **Card:** `4111 1111 1111 1111`, any future expiry, any CVV, OTP `1234`.
5. Webhook testing locally:
   - Run `npx cloudflared tunnel --url http://localhost:3000`.
   - In Razorpay, go to **Webhooks → Add**. Set the URL to `https://<tunnel>/api/payments/webhook`, the secret to `RAZORPAY_WEBHOOK_SECRET`, and the events to `payment.captured` and `order.paid`.
6. Refund testing: pay for an order, cancel it in admin, then tap **Refund**. In test mode the refund completes instantly.

## Go-live checklist

Items marked ✅ are already in the code. Items marked ⬜ you need to do by hand.

**Payments**
- ⬜ Complete Razorpay KYC and activate **Live mode**.
- ⬜ Put the live keys (`rzp_live_…`) in Vercel for `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `NEXT_PUBLIC_RAZORPAY_KEY_ID`, then redeploy.
- ⬜ Create a **Live** webhook to `https://<your-domain>/api/payments/webhook` with events `payment.captured` and `order.paid`, and a new secret in `RAZORPAY_WEBHOOK_SECRET`.
- ⬜ Run an end-to-end test with a ₹1 dish:
  1. In Admin → Settings → Menu, add "Test bowl" at ₹1 in any group.
  2. Order it from a phone and pay by real UPI.
  3. Check that it is Paid in admin and that the webhook shows as delivered in Razorpay.
  4. Cancel the order, then Refund it.
  5. Turn the test bowl off.

**Domain, preview and SEO**
- ⬜ Add a custom domain in Vercel (**Settings → Domains**). HTTPS is automatic.
- ⬜ Set `NEXT_PUBLIC_SITE_URL=https://<your-domain>` and redeploy, then update the Supabase Site URL and Redirect URLs.
- ✅ Link preview: Open Graph title and description, plus a 1200×630 image from `app/opengraph-image.tsx` (40 KB, under WhatsApp's limit). After going live, paste the link in WhatsApp to check it, or use [Facebook's Sharing Debugger](https://developers.facebook.com/tools/debug/) to refresh the cached preview.
- ✅ Basic SEO: title, description, `robots.txt` (admin, API, order and feedback-token pages are not indexed), `sitemap.xml`, `lang="en-IN"`.
- ✅ Favicon (`app/icon.svg`), home-screen icon (`app/apple-icon.tsx`), 404 page, and error pages.

**Monitoring**
- ✅ Every server error is logged as one JSON line (`instrumentation.ts`). Search **Vercel → Logs** for `"level":"error"`.
- ⬜ Optional, Sentry free tier: run `npx @sentry/wizard@latest -i nextjs`, which adds the config files and an `onRequestError` hook. Remove or merge `instrumentation.ts` when the wizard asks.
- ⬜ Optional: Vercel → Settings → **Log Drains** or Notifications, to get email alerts on errors.

**Backups**
- ✅ `.github/workflows/db-backup.yml` dumps the database every day at 02:00 IST and keeps 14 days of backups as private GitHub artifacts. To turn it on, add a repo secret `SUPABASE_DB_URL` with the Session pooler connection string. The backups contain customer names and phones, so keep the repo private.
- ⬜ Run the workflow once by hand (**Actions → Daily DB backup → Run workflow**) and download the artifact to check it.
- ⬜ To restore, use `gunzip -c kitchen-YYYY-MM-DD.sql.gz | psql "$DATABASE_URL"` on a fresh project, with the migrations applied first.
- ⬜ Alternatively, Supabase **Pro** has built-in daily backups and point-in-time recovery.

**Supabase**
- ⬜ Set up custom SMTP (**Project Settings → Auth**). The built-in email allows only a few login emails per hour.
- ⬜ Use the magic-link template from [Admin login setup](#admin-login-setup).
- ⬜ Free projects pause after about a week of no use. Open the site or admin once a week, or upgrade.

**Content**
- ⬜ Real kitchen name, tagline and pickup address in `lib/config.ts`. These also feed the link preview image.
- ⬜ `NEXT_PUBLIC_WHATSAPP_NUMBER`.
- ⬜ Dish photos (Admin → Settings → Menu).
- ⬜ Print a QR code on the bowls that points to `https://<your-domain>/feedback`.

## Go-live test (on a phone)

Run this on an Android phone, opening the link from WhatsApp, before the first real weekend. ✅ = verified during development (see note); ⬜ = needs a real device, Supabase and Razorpay.

**Customer**
- ⬜ The WhatsApp link preview shows the title, description and image.
- ⬜ The menu loads quickly on 4G. The cards and +/− buttons are easy to tap at 360px width.
- ⬜ The cart survives closing and reopening the browser.
- ⬜ Checkout: day → slot → name and mobile are pre-filled the second time. An invalid mobile shows an error.
- ⬜ Coupon: a valid code shows a discount line; invalid, expired and below-minimum codes show a friendly message. The total never goes below ₹1.
- ⬜ Tasting day: the cart is limited to 1 bowl. A second paid order from the same phone shows *"You've already booked your taste bowl!"*.
- ⬜ Pay with UPI (Google Pay or PhonePe opens) → "Order K-… confirmed".
- ⬜ **Send to WhatsApp** opens a chat with the order details pre-filled.
- ⬜ Close the Razorpay popup → friendly message and **Try again**; the cart is still there.
- ⬜ Pay, then kill the browser before the redirect → the order still becomes Paid (webhook).
- ⬜ The floating WhatsApp button doesn't cover the Pay or Continue buttons.
- ⬜ Feedback: from the confirmation page, and from `/feedback` with order number and mobile. A second submission says you've already given feedback.
- ✅ An unknown page shows the 404 page. ✅ A bad order or feedback token shows the 404 page.

**Admin**
- ⬜ Magic link opened from the Gmail app → lands in `/admin`. An email that isn't an admin sees "Not allowed".
- ✅ Signed-out `/admin/*` redirects to login. ✅ The CSV export URLs return 403 without an admin session.
- ⬜ A new paid order appears without refreshing, with a beep (after turning sound on).
- ⬜ Mark Ready → Mark Picked up → Undo all work with one tap each.
- ⬜ Cancel an unpaid order → stock goes back. Cancel a paid order → Refund needed → **Refund** → the customer page shows "Refunded".
- ⬜ A refund failure (for example, refunding twice from the Razorpay dashboard) shows the error and **Mark refunded manually**.
- ⬜ The orders CSV and feedback CSV open correctly in Google Sheets or Excel.
- ⬜ Coupons: create, see it used after a paid order, disable it.

**Verified during development:**
- ✅ Order, stock, capacity, window, rate-limit, coupon, tasting-day and mark-paid rules: `npm run test:db` on Postgres 16 with all three migrations
- ✅ RLS: anon can't read orders; admins can only read
- ✅ 41 unit tests
- ✅ Typecheck, lint and production build
- ✅ A local production smoke test: OG image (1200×630, 40 KB), icons, robots, sitemap, 404, admin redirect, export 403

## Deploying to Vercel

1. Import the repo into Vercel.
2. Add the variables from `.env.example`, except `DATABASE_URL`, under **Project → Settings → Environment Variables**.
3. Deploy.
4. Then follow the go-live checklist above.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | SQL tests (`DATABASE_URL` required) |
