# Security notes — Guddi Silai

Where each control lives, so a reviewer can check the claim against the code.
Addresses README §63, plus the OWASP Top 10 items that apply to a storefront
handling payments, phone numbers and home addresses.

## Money and payments

| Control | Where |
|---|---|
| Prices are never accepted from the client — every amount is recomputed from the database | `backend/src/services/pricing.ts` |
| Cart schema has no price field at all, and rejects unknown keys | `backend/src/schemas/cart.ts` |
| Order marked PAID only after an HMAC signature this server verified | `backend/src/routes/orders.ts`, `services/payment/razorpay.ts` |
| Webhook verified against the raw request bytes, mounted before the JSON parser | `backend/src/app.ts`, `routes/payments.ts` |
| Constant-time signature comparison (`crypto.timingSafeEqual`) | `services/payment/razorpay.ts` |
| Razorpay **secret** never leaves the server; only the public key id is sent | `routes/orders.ts` |
| Failed or unverified payment releases the stock it reserved | `routes/orders.ts` |
| Money stored as integer minor units — no float arithmetic anywhere | `services/pricing.ts`, `models/commerce.ts` |

Verify the tamper protection:

```bash
# adding a price field to a cart line is rejected outright
curl -b jar -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -X POST localhost:4000/api/cart/quote \
  -d '{"lines":[{"key":"k","productId":"<id>","quantity":1,"lineTotalMinor":1}]}'
# → 400  Unrecognized key(s) in object: 'lineTotalMinor'
```

## Authentication and sessions

| Control | Where |
|---|---|
| OTP is 6 digits from `crypto.randomInt`, never `Math.random` | `routes/auth.ts` |
| OTP stored as a bcrypt hash (cost 12), never in plaintext | `routes/auth.ts` |
| OTP single-use, 5-minute expiry, 5 attempts, superseded on resend | `routes/auth.ts`, `models/user.ts` |
| Identical error for every OTP failure — no user enumeration | `routes/auth.ts` |
| Access token is a short-lived JWT with the algorithm pinned to HS256 | `services/tokens.ts` |
| Refresh tokens are opaque, stored **hashed**, and rotated on every use | `services/tokens.ts`, `routes/auth.ts` |
| Session id rotates on login and on refresh (session fixation) | `services/tokens.ts` |
| Tokens live in httpOnly cookies — never `localStorage` | `services/tokens.ts`, `frontend/src/lib/api.ts` |
| Refresh cookie scoped to `/api/auth/refresh` only | `services/tokens.ts` |
| Google ID tokens verified against our own client id (audience check) | `routes/auth.ts` |
| Admin role re-read from the database on every admin request | `middleware/auth.ts` |

## Input handling

| Control | Where |
|---|---|
| Every body, query and param bound through a strict zod schema | `middleware/validate.ts`, all routes |
| Unknown keys rejected — blocks mass assignment | `.strict()` on every schema |
| Handlers read `req.validated`, never the raw body — no operator object can reach a query | `middleware/validate.ts` |
| Facet values matched against a slug pattern before use in a query | `routes/catalog.ts` |
| Search input length-capped before any regex, and regex metacharacters escaped | `routes/catalog.ts` |
| Pagination cursors re-validated into a primitive + a real ObjectId | `utils/cursor.ts` |
| Measurement keys restricted to configured fields; unknown keys dropped | `services/measurements.ts` |
| File uploads validated by magic bytes, size-capped, server-named, metadata stripped | `services/media/cloudinary.ts` |

## Access control

| Control | Where |
|---|---|
| Cart, wishlist and measurement profiles scoped by `req.auth.userId` from the signed token — never an id in the body | `routes/cart.ts`, `routes/measurements.ts` |
| Ownership is part of the query filter, not a check afterwards | `routes/measurements.ts` |
| Guest order tracking requires order number **and** the mobile on the order | `routes/orders.ts` |
| Unauthorised order lookup returns 404, not 403 — existence is not confirmed | `routes/orders.ts` |
| Order numbers are unpredictable, not sequential | `routes/orders.ts` |
| Only APPROVED reviews are ever public | `routes/misc.ts` |
| SHOWCASE products are refused at the pricing layer, not just hidden in the UI | `services/pricing.ts` |
| Exact stock counts and SKUs never leave the server | `presenters/product.ts` |

## Transport, headers, abuse

| Control | Where |
|---|---|
| CSRF: signed double-submit token on every state-changing request | `middleware/csrf.ts` |
| CORS restricted to an explicit origin allow-list | `app.ts` |
| CSP, HSTS, `X-Content-Type-Options`, frame-deny, referrer policy | `app.ts` (helmet) |
| `trust proxy: 1` — a client cannot spoof `X-Forwarded-For` past one proxy | `app.ts` |
| Rate limits backed by MongoDB so they hold across instances, failing **closed** | `middleware/rateLimit.ts` |
| Tight per-IP *and* per-number limits on OTP send and verify | `middleware/rateLimit.ts` |
| Body size capped at 256 KB | `app.ts` |
| Outbound calls disable redirects so credentials cannot be forwarded elsewhere | `services/sms/index.ts`, `services/shipping/shiprocket.ts` |

## Privacy (README §63)

- Raw IP addresses are **never stored**. The address is used once in-process to
  derive a coarse country/state/city and is then discarded; only a salted
  HMAC remains, which counts unique visitors but cannot be reversed.
- Analytics session ids are random client-generated strings with no personal
  data in them.
- Raw events expire automatically after 400 days (TTL index).
- Logs redact cookies, authorization headers, tokens, OTPs and secrets; phone
  numbers are masked to the last four digits.
- The privacy policy page states all of this in plain Hinglish.

## Secrets

- No secret is hardcoded anywhere. Everything loads from `backend/.env`, which
  is git-ignored, with `.env.example` as the documented template.
- Environment is validated at boot and the process **exits** if anything
  required is missing or weak; only key *names* are printed, never values.
- Production refuses to start with placeholder Razorpay keys, a mocked SMS
  provider, or `JWT_SECRET === CSRF_SECRET`.
- The only secret the browser ever receives is the Razorpay **key id**, which is
  public by design.

## Known gaps

- **No automated test suite.** Behaviour was verified by hand against a running
  server (see the transcript of this build); regressions will not be caught
  automatically. Tests around `services/pricing.ts` and the payment
  verification path would be the highest-value place to start.
- **No admin panel yet**, so admin authorisation is enforced by middleware that
  currently has no routes behind it.
- **Rate-limit store has a small race window** under concurrent first-hits on a
  fresh window; it can undercount by a request or two. Redis with an atomic
  INCR+EXPIRE would close it if the traffic ever justifies it.
- **Refresh-token reuse is not detected.** A stolen token stops working once the
  real client refreshes, but the theft itself does not trigger a session-wide
  revocation.
- **No CAPTCHA on OTP send.** Rate limiting bounds the abuse; a determined
  attacker could still burn SMS credit across many IPs.
