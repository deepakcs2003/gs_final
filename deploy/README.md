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
   ├─ WhatsApp Business Cloud API (OTP + notifications, direct Meta)
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

## 4. Put the app on the VM (clone, so auto-deploy can pull later)

The VM needs git + the repo so the auto-deploy webhook can `git pull`. On the VM:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/deepakcs2003/gs_final.git ~/app
cd ~/app
```
> Keep `~/app` on the *main* branch — the auto-deploy resets it to `origin/main`.

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
WHATSAPP_MODE=production
WHATSAPP_PRODUCTION_PHONE_NUMBER_ID=...
WHATSAPP_PRODUCTION_BUSINESS_ACCOUNT_ID=...
WHATSAPP_PRODUCTION_ACCESS_TOKEN=...
WHATSAPP_VERIFY_TOKEN=<random string you also put in the Meta webhook config>
WHATSAPP_APP_SECRET=<Meta app secret — HMAC for delivery-status signatures>
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
curl -s http://127.0.0.1:4000/health        # {"ok":true,"service":"guddi-silai-api"}
```

Then register the Razorpay **webhook** in the Razorpay dashboard pointing at:
```
https://yourdomain.com/api/payments/webhook
```
(events: `payment.captured`, `payment.failed`, `order.paid`) using the same
`RAZORPAY_WEBHOOK_SECRET`.

Then register the WhatsApp **delivery-status webhook** in the Meta app:
- Callback URL: `https://yourdomain.com/api/whatsapp/webhook`
- Verify token: the same `WHATSAPP_VERIFY_TOKEN`
- Subscribe to `messages` webhook field, with `WHATSAPP_APP_SECRET` used to
  verify the `X-Hub-Signature-256` header on each POST.

## 8. Auto-deploy (merge `main` -> the VM goes live)

Everything is in the repo already — only the webhook secret + systemd enable
is manual.

1. Pick a secret: `openssl rand -hex 32`
2. Point the service at it:
   ```bash
   cd ~/app
   sudo sed -i "s/CHANGE_ME/YOUR_SECRET/" deploy/autodeploy.service
   ```
3. Install & start the listener (it's just a small Node webhook, port 17400):
   ```bash
   sudo cp deploy/autodeploy.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now autodeploy
   systemctl status autodeploy          # should be "active (running)"
   ```
4. Open the same **TCP 17400** ingress rule on the Oracle security list
   (restrict source to GitHub's IPs `140.82.112.0/20`, `192.30.252.0/22`,
   `185.199.108.0/22` — optional but tidy).
5. Tell GitHub to ping it. Repo → **Settings → Webhooks → Add webhook**:
   - Payload URL: `http://<PUBLIC_IP>:17400/`
   - Content type: `application/json`
   - Secret: the same `YOUR_SECRET`
   - Events: **Just the push event** → Add
6. Test end-to-end: merge (or push) to `main`, then
   ```bash
   journalctl -u autodeploy -f      # watch pull + rebuild in real time
   docker compose ps                # both containers restarted
   ```
   GitHub shows a green ✓ on the webhook delivery panel after each push.

Each future `git merge` to `main` now auto-pulls and redeploys. No login needed.

## 9. Update & redeploy manually (if auto-deploy is off)

```bash
cd ~/app && git pull
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
| Webhook shows red ✗ in GitHub | port 17400 ingress closed, wrong secret in `autodeploy.service`, or node not running (`systemctl status autodeploy`) |
| Merge happened but nothing deployed | push was to a different branch; only `main` triggers. Check `journalctl -u autodeploy -f` |
| `update.sh` fails: `git.lock exists` | a manual `git pull` is mid-run — wait, then re-trigger webhook |

## What NOT to do
- Don't run `npm run seed` on the live DB — it wipes the real catalogue.
- Don't put live secrets in the repo — env stays on the VM only.
- Don't expose the API on a public port with test keys — the boot guard blocks this.