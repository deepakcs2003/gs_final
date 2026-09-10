# Guddi Silai — Oracle Cloud Always Free deployment

One free Oracle Cloud ARM VM running the whole site behind Caddy (auto-HTTPS).
MongoDB stays on Atlas; nothing here needs a database server.

## Architecture

```
Customer https://yourdomain.com
   │
   ▼
Caddy (ports 80/443, Let's Encrypt)   ── gorazorpay / shiprocket webhooks hit /api/...
   │  reverse-proxy → :4000
   ▼
guddi docker container (Node, serves SPA + /api)
   │
   ├─ MongoDB Atlas (cloud, existing)
   ├─ Razorpay (live keys)
   ├─ msg91 SMS
   └─ Shiprocket (orders/fulfilment)
```

## 1. Create the free VM (Oracle Cloud console)

1. OCI → **Create a VM instance**
   - Image: Ubuntu 22.04 (or 24.04)
   - Shape: **VM.Standard.A1.Flex (ARM)**, 4 OCPU / 24 GB RAM (free always-on)
   - Boot volume: 100 GB (free; default okay)
   - Enable SSH: paste your public key (create one on Windows with `ssh-keygen`)
2. Note the **Public IPv4** once created.
3. In **Networking → Security list** for the instance:
   - Allow **TCP 22** (SSH, from your IP)
   - Allow **TCP 80** and **TCP 443** from `0.0.0.0/0`
4. SSH in (see Windows step 2).

## 2. On Windows: generate a key + SSH into the VM

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519"   # paste the .pub into Oracle
ssh ubuntu@<PUBLIC_IP>                                        # default user is "ubuntu"
```

## 3. On the VM (one-time setup)

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out & back in so your user can docker without sudo:
exit
```

Test it:
```bash
ssh ubuntu@<PUBLIC_IP>
docker --version
```

## 4. Copy the app to the VM

From Windows (in the repo folder):
```powershell
scp -r .\Dockerfile .\docker-compose.yml .\package.json .\package-lock.json .\frontend .\backend .\deploy ubuntu@<PUBLIC_IP>:~/app
```
(The `deploy\` folder is needed for the Caddyfile; `.dockerignore` keeps the
image lean.)

## 5. Create the production env file on the VM

```bash
cd ~/app
nano .env        # fill from backend/.env.example — production values (see table below)
```

Required (server refuses to boot otherwise — this is by design):
```
NODE_ENV=production
APP_BASE_URL=https://yourdomain.com
API_BASE_URL=https://yourdomain.com/api
CORS_ORIGINS=https://yourdomain.com
MONGODB_URI=mongodb+srv://...
JWT_SECRET=<64 char random>
CSRF_SECRET=<64 char random, different>
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
SMS_PROVIDER=msg91
MSG91_AUTH_KEY=...
MSG91_OTP_TEMPLATE_ID=...
PUBLIC_DIR=../frontend/dist
SHIPROCKET_EMAIL=...
SHIPROCKET_PASSWORD=...
SHIPROCKET_PICKUP_LOCATION=Primary
SHIPROCKET_MOCK=false
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
ADMIN_MOBILE=919322240998
PORT=4000
```
Generate secrets: `openssl rand -base64 48` twice.

## 6. Register the domain (GoDaddy)

1. GoDaddy → your domain → **DNS** → **Add records**:
   - Type **A**, Host `@`, Value `<PUBLIC_IP>`, TTL 600
   - Type **CNAME**, Host `www`, Value `@`, TTL 600
2. (Optional, recommended) Move nameservers to Cloudflare for free CDN/proxy.
3. Caddy will auto-issue Let's Encrypt certs for `yourdomain.com` + `www` on first request — no manual cert step.

## 7. Build & run

```bash
cd ~/app
docker compose up -d --build
docker compose ps
curl -s https://yourdomain.com/health        # {"ok":true,"service":"guddi-silai-api"}
```

Then register the Razorpay **webhook** in the Razorpay dashboard pointing at:
```
https://yourdomain.com/api/payments/webhook
```
(events: `payment.captured`, `payment.failed`, `order.paid`) using the same
`RAZORPAY_WEBHOOK_SECRET`.

## 8. Update & redeploy after future merges

```bash
cd ~/app && git pull   # or scp the changed files again
docker compose up -d --build
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `docker compose up` can't resolve | your DNS (A record) not propagated yet — check `nslookup yourdomain.com` |
| `/health` 404 | app still building — `docker compose ps`, `docker compose logs` |
| Boot refuses | env.ts validation — `docker compose logs` prints the exact missing keys |
| Payments fail | key is `rzp_test_` in prod (boot blocks it) or webhook URL/secret wrong |
| Can't get the site | Oracle security list missing ports 80/443, or instance is stopped |

## What NOT to do
- Don't run `npm run seed` on the live DB — it wipes the real catalogue.
- Don't put live secrets in the repo — env stays on the VM only.
- Don't expose the API on a public port with test keys — the boot guard blocks this.