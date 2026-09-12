# Guddi Silai — Setup & Architecture

Storefront for ready-to-buy blouses, custom-stitched blouses and upcoming
designs. Built to the requirement document in [README.md](README.md).

Stack: React 18 + TypeScript + Vite + Tailwind (frontend) · Node 20+ / Express 5
+ TypeScript + Mongoose (backend) · MongoDB Atlas · Razorpay · Cloudinary ·
Shiprocket · WhatsApp Business Cloud API.

---

## 1. Running it

```bash
npm install            # installs both workspaces
```

### Optional demo mode — temporary in-memory database

```bash
npm run dev:api:local  # in-memory MongoDB, auto-seeded with 25 demo designs
npm run dev:web        # http://localhost:5173
```

The in-memory database is discarded when you stop the process. OTP codes are
printed to the API log instead of being sent by SMS. Use this to look around.

### Real setup (recommended, persistent MongoDB Atlas)

```bash
cp backend/.env.example backend/.env   # then fill it in — see §2
npm run seed                           # loads the demo catalogue into Atlas
npm run dev:real                       # API on :4000, web on :5173
```

`dev:real` uses `backend/.env` and connects to the configured MongoDB Atlas
database. It never starts `src/dev/local.ts`, so data remains after restart.

### Separate terminals (fixed ports)

Use exactly one backend terminal and one frontend terminal:

```powershell
# Terminal 1 — API: http://localhost:4000
cd ecomm_shop/backend
npm run dev
```

```powershell
# Terminal 2 — website: http://localhost:5173
cd ecomm_shop/frontend
npm run dev
```

The Vite proxy forwards `/api` to port `4000`. The frontend is configured with
`strictPort`, so it will stop with a clear port-busy message instead of silently
moving to `5174` or `5175` and confusing cookies or sessions.

`npm run build` type-checks and builds both. `npm run typecheck` checks only.

---

## 2. Environment

Every value lives in `backend/.env`. **Never commit it**, and never paste keys
into a chat or an issue. `backend/.env.example` documents each one and says
where in each provider's dashboard to find it.

The server validates its whole environment at boot and refuses to start if
anything required is missing or weak — a half-configured server is worse than
one that never accepts traffic. In production it additionally refuses to start
with placeholder Razorpay keys or a mocked SMS provider.

Generate the two secrets separately:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Integration | Needed for | Behaviour when unset |
|---|---|---|
| MongoDB Atlas | everything | server will not start |
| Razorpay | online payment | online payment hidden, COD still works |
| Cloudinary | product image hosting | uploads rejected; `gs-art:` placeholders still render |
| WhatsApp | login OTP + order notifications + campaigns | OTP falls back to the backend log (dev only); notifications/campaigns stay queued |
| Shiprocket | pincode check, courier push | pincode check returns a neutral answer; orders still place |
| Google | "Continue with Google" | the button is simply not shown |

On Atlas: create a database user scoped to this database only, and restrict
Network Access to your own IPs rather than `0.0.0.0/0`.

---

## 3. Layout

```
backend/src/
  config/       env validation (zod, fail-closed), mongoose connection
  domain/       product types, order statuses, currency rules
  models/       catalog · user · commerce · analytics
  middleware/   auth · csrf · rateLimit · validate · errorHandler
  services/     pricing · measurements · settings · geo · tokens
                payment/razorpay · sms · shipping/shiprocket · media/cloudinary
  routes/       catalog · auth · cart · measurements · orders · payments · misc · admin
  presenters/   what the browser is allowed to see
  seed/         demo catalogue
  dev/local.ts  in-memory Mongo runner (dev only)

frontend/src/
  lib/          api client · analytics · formatting · types
  store/        cart · wishlist · recently viewed · UI state (zustand)
  hooks/        react-query hooks
  components/   layout · product · customize · shared UI
  pages/        Home · Listing · ProductDetail · Cart · Measurement
                Checkout · OrderSuccess · Wishlist · Orders · Static
```

---

## 4. The three product types

README §83 asks for these to be separated at the data layer rather than behind
`if/else` in the UI, and they are — `type` on the product decides which controls
exist, which validations run and which endpoints apply.

| | READY_MADE | CUSTOMIZE | SHOWCASE |
|---|---|---|---|
| Customer picks | colour + size | fabric + laces + measurement | nothing |
| Actions | Cart, Buy Now | Fabric sheet → measurement → cart | Like, Share, WhatsApp |
| Inventory | size × colour matrix | fabric stock | none |
| Orderable | yes | only once measurement is confirmed | **never** — refused server-side |

---

## 5. How money works

**The browser never sends a price.** A cart line carries choices only — product,
colour, size, fabric, quantity. Every amount is recomputed from the database in
`services/pricing.ts`, which both the cart page and checkout call. Tampering
with the cart in devtools changes nothing.

Amounts are integers in the order currency's minor unit (paise / cents), which
is also exactly what Razorpay expects. Product prices are stored as whole
rupees; floats never enter the calculation.

Currency and COD follow README §32:

| Visitor's country | Currency | COD | Delivery |
|---|---|---|---|
| IN | INR | yes | free above ₹1,499, else ₹79 |
| BD, PK, NP, BT, LK | INR | no | flat rate |
| everywhere else | USD (converted at an admin-editable rate) | no | quoted at payment time |

Country comes from the CDN edge header (`CF-IPCountry` and friends), defaulting
to India. Verify with:

```bash
curl -H 'CF-IPCountry: US' localhost:4000/api/config
```

---

## 6. Security

The measures below are implemented, not aspirational — see `SECURITY.md` for
the full map of control to file.

- **Payments.** An order is marked PAID only from an HMAC signature this server
  verified — either the Razorpay checkout handshake or the webhook. The webhook
  is mounted before the JSON body parser so it can verify the exact bytes sent.
- **Sessions.** Short-lived JWT access token plus a rotating refresh token, both
  in httpOnly cookies. Refresh tokens are stored hashed, so a database leak
  cannot be replayed as a login. Nothing sensitive touches `localStorage`.
- **OTP.** Six digits from a CSPRNG, stored as a bcrypt hash, single-use,
  five-minute expiry, five attempts, rate-limited per IP *and* per number.
- **CSRF.** Signed double-submit token required on every state-changing request.
- **Input.** Every payload is bound through a strict zod schema that rejects
  unknown keys — this is what blocks both mass assignment and Mongo operator
  injection, since only validated primitives ever reach a query.
- **Stock.** Reserved with a conditional update (`stock: {$gte: qty}` inside the
  filter), so two shoppers racing for the last blouse cannot both win.
- **Privacy.** Raw IP addresses are never stored — only a salted hash, which
  counts unique visitors without identifying anyone (README §63).
- **Errors.** Clients get a stable code and a plain-Hinglish message; stack
  traces and driver errors stay in the server log.

---

## 7. Images

Seed products use a `gs-art:` URL scheme that the frontend renders as a branded
SVG placeholder, so the site is fully browsable before a single photograph
exists. Replace those URLs with Cloudinary ones and `SmartImage` starts serving
real images with no other change. Uploads always go through the server, with a
magic-byte check — never an unsigned browser preset, which is an open file-drop
for the internet.

---

## 8. Admin access and remaining work

Set `ADMIN_MOBILE` to an authorised mobile number before running the seed. The
seed creates or promotes that account to `SUPER_ADMIN`; sign in with its OTP and
open `/admin`. The admin workspace currently includes dashboard metrics, order
status updates, product create/update/archive APIs, review moderation,
measurement fields, settings, catalogue resources and activity logs. All admin
routes are protected by the live role check.

The next operational additions are bulk image upload, full CRUD forms for
categories/fabrics/laces/coupons, CSV exports, notifications, and social
preview rendering. These are intentionally separate from the customer
storefront so its current mobile experience remains stable.
- Review photo uploads (text reviews and moderation work today).
- Notifications (README §51).
- Server-side rendering for social preview cards. Open Graph tags are static in
  `index.html`; per-product previews need SSR or a prerender step.
