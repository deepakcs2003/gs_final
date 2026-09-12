# Guddi Silai Admin API Guide

This guide explains how to create an admin account, login with OTP, call the protected admin endpoints, and use the admin workspace.

## 1. Start The API

From the `ecomm_shop` folder:

```powershell
npm install
npm run seed:real
npm run dev:real
```

`dev:real` uses the MongoDB URI in `backend/.env`. Data remains after the server
restarts. Do not use `dev:local` for this workflow; that command uses a temporary
in-memory database.

For a real MongoDB database, set the values in `backend/.env` and run:

```powershell
npm run dev:api
```

## 2. Create The First Admin

Set an authorised mobile number and configure the WhatsApp OTP provider in `backend/.env`:

```env
ADMIN_MOBILE=917709894512
WHATSAPP_MODE=test            # test/dev; switch to production + WHATSAPP_PRODUCTION_* for live
WHATSAPP_TEST_PHONE_NUMBER_ID=<Meta phone number id>
WHATSAPP_TEST_BUSINESS_ACCOUNT_ID=<Meta WABA id>
WHATSAPP_TEST_ACCESS_TOKEN=<Meta access token>
```

Then run the seed command:

```powershell
npm run seed
```

The seed creates or promotes this mobile number to `SUPER_ADMIN`. The OTP is
delivered through the WhatsApp `guddi_otp` AUTHENTICATION template by the queue
worker. If WhatsApp is not configured, the OTP is printed to the backend log
(development only).

Do not use a real production admin number in a shared development database.

## 3. Login Flow

Admin authentication uses the same mobile OTP flow as the customer website. There is no separate admin password endpoint.

### Send OTP

```http
POST /api/auth/otp/send
Content-Type: application/json
X-CSRF-Token: <csrf-cookie-value>

{"mobile":"917709894512"}
```

With WhatsApp configured, the six-digit OTP is delivered through the approved `guddi_otp` WhatsApp template. For local testing without WhatsApp, the OTP is printed in the backend terminal instead.

### Verify OTP

```http
POST /api/auth/otp/verify
Content-Type: application/json
X-CSRF-Token: <csrf-cookie-value>

{"mobile":"917709894512","code":"123456"}
```

A successful response sets the httpOnly access and refresh cookies. Keep those cookies in the same browser or HTTP client. The response contains `user.isAdmin: true` for an admin account.

## 4. CSRF And Cookies

All state-changing `/api` requests need both:

1. The session cookies returned by login.
2. The `X-CSRF-Token` header equal to the readable `gs_csrf` cookie.

Safe `GET` requests do not need the CSRF header, but they still need the access cookie for admin routes.

The normal frontend API client handles this automatically. For manual API testing, first call a GET endpoint so the server issues `gs_csrf`, then send that cookie value as the header on every `POST`, `PATCH`, `PUT`, or `DELETE` request.

### Browser usage

1. Start the frontend with `npm run dev:web`.
2. Open `http://localhost:5173`.
3. Open the login sheet and use the `ADMIN_MOBILE` number.
4. Enter the OTP printed by the backend.
5. Open `http://localhost:5173/admin`.

## 5. Common Response Codes

| Status | Meaning |
|---|---|
| `200` | Request completed successfully |
| `201` | Resource created successfully |
| `400` | Invalid request body, query, or parameter |
| `401` | Login/session is missing or expired |
| `403` | Logged-in user is not an admin, or CSRF token is missing/invalid |
| `404` | Product, order, review, or measurement field was not found |
| `409` | Business conflict, such as duplicate design ID or unavailable stock |

## 6. Admin Endpoint List

All endpoints below are mounted under `/api/admin` and require an authenticated admin session.

### Dashboard

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/dashboard` | Dashboard cards, revenue, order statuses, events, and top viewed products |

Optional date filters use ISO dates:

```text
GET /api/admin/dashboard?from=2026-09-01&to=2026-09-07
```

Response includes `cards`, `statuses`, `topProducts`, and the resolved date range.

### Orders

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/orders` | List the latest 100 orders |
| `GET` | `/api/admin/orders?status=STITCHING` | Filter orders by status |
| `PATCH` | `/api/admin/orders/:orderNumber/status` | Change status and append status history |

Allowed statuses:

```text
PLACED
CONFIRMED
PROCESSING
STITCHING
QUALITY_CHECK
PACKED
SHIPPED
DELIVERED
CANCELLED
RETURNED
FAILED
```

Update example:

```json
{
  "status": "STITCHING",
  "note": "Measurement checked by stitching team"
}
```

### Products

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/products` | List up to 200 products with category details |
| `POST` | `/api/admin/products` | Create a product |
| `PATCH` | `/api/admin/products/:id` | Update product fields |
| `DELETE` | `/api/admin/products/:id` | Archive a product by setting `isActive` to false |

Product values use these product types:

```text
READY_MADE
CUSTOMIZE
SHOWCASE
```

Required fields for `POST /api/admin/products`:

```json
{
  "designId": "GS-301",
  "slug": "designer-blouse-301",
  "name": "Designer Blouse 301",
  "description": "Ready-to-buy blouse",
  "type": "READY_MADE",
  "category": "<category-object-id>",
  "mrpInr": 1299,
  "sellingPriceInr": 899
}
```

The create schema also accepts images, colors, sizes, variants, fabric/lace option IDs, embroidery, SEO fields, stitching details, `comingSoon`, and `isActive`. `PATCH` accepts any subset of those fields.

`DELETE` is a soft archive. It does not remove historical order snapshots.

### Catalogue Resources

These endpoints are read-only in the current admin API and are useful when building forms:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/categories` | List all categories |
| `GET` | `/api/admin/fabrics` | List all fabrics |
| `GET` | `/api/admin/laces` | List all laces |
| `GET` | `/api/admin/coupons` | List all coupons |

### Reviews

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/reviews` | List reviews |
| `GET` | `/api/admin/reviews?status=PENDING` | List pending reviews |
| `PATCH` | `/api/admin/reviews/:id/status` | Approve or reject a review |

Allowed review statuses:

```text
PENDING
APPROVED
REJECTED
```

Update example:

```json
{"status":"APPROVED"}
```

Only approved reviews are public on the customer storefront.

### Measurement Fields

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/measurements` | List measurement field definitions |
| `POST` | `/api/admin/measurements` | Add a measurement field |
| `PATCH` | `/api/admin/measurements/:id` | Update a measurement field |

Create example:

```json
{
  "key": "neck_width",
  "label": "Neck Width",
  "labelHi": "Gale ki chaudai",
  "instruction": "Neck ke across measure karein.",
  "gifUrl": "",
  "imageUrl": "",
  "minInch": 2,
  "maxInch": 12,
  "required": false,
  "order": 12,
  "isActive": true
}
```

### Settings

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/settings` | List runtime settings |
| `PUT` | `/api/admin/settings/:key` | Create or update one setting |

Update example:

```json
{"value":"v2"}
```

Only send settings that the application understands. A setting update is written to the admin activity log.

### Activity Log

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/admin/activity` | List the latest 100 admin actions |

Product changes, order status changes, review moderation, measurement creation, and setting changes are logged.

## 7. PowerShell Manual Test Example

PowerShell 5.1 does not provide a convenient cookie jar, so the browser or Postman is recommended for full OTP testing. The following checks the protected route without login:

```powershell
try {
  Invoke-WebRequest -UseBasicParsing http://localhost:4000/api/admin/dashboard
} catch {
  [int]$_.Exception.Response.StatusCode
}
```

Expected result:

```text
401
```

For a full manual request, use Postman with cookie persistence:

1. `GET http://localhost:4000/api/config`.
2. Copy the `gs_csrf` cookie.
3. Send OTP with `X-CSRF-Token` equal to that cookie.
4. Read the OTP from the backend console when WhatsApp is not configured.
5. Verify OTP and keep the returned cookies.
6. Call `GET http://localhost:4000/api/admin/dashboard`.
7. For writes, send the same `gs_csrf` cookie and header.

## 8. Security Notes

- Never expose JWT, refresh-token, MongoDB, Razorpay, or WhatsApp secrets in frontend code.
- Do not remove `requireAdmin()` from `backend/src/routes/admin.ts`.
- Admin sessions use httpOnly cookies; do not copy access tokens into localStorage.
- Use HTTPS and the WhatsApp production mode in production. Logged-out OTP codes are for development only.
- The current route group checks that the account has an admin role. Individual role restrictions are not yet separated per endpoint; `SUPER_ADMIN` and other admin-role accounts currently pass the same admin route guard.

## 9. Frontend Admin Workspace

After successful admin OTP login, open:

```text
http://localhost:5173/admin
```

The current workspace includes:

- Overview cards and top viewed products
- Order listing and status updates
- Pending review approval/rejection

The API also exposes product, measurement, settings, catalogue, and activity endpoints for the next admin form screens.
