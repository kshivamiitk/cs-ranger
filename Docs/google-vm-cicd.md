# Google VM CI/CD

This project deploys to one Google Compute Engine VM with:

- Nginx on ports 80/443.
- Next.js on localhost:3000.
- API gateway on localhost:4000.
- Backend services on localhost:4001-4012.
- PM2 as the process manager.
- GitHub Actions as CI/CD.

The current production VM (`learnrift-prod-1`) has ~16 GB RAM and ample disk, so
memory is not a constraint for the 14 Node processes (~1 GB total in practice).
The "small VM" notes below apply only to a fresh, under-provisioned instance.

## One-Time VM Setup

Run these on the VM once:

```bash
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx curl build-essential

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

On a small VM (<=2 GB), add swap before the first build. This avoids short memory
spikes during `npm ci` and `next build` taking the site down. (The current prod
box has plenty of RAM and already has swap configured; this matters mainly for a
fresh small instance.)

```bash
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
```

Clone the repo:

```bash
cd "$HOME"
git clone git@github.com:YOUR_ORG_OR_USER/YOUR_REPO.git cs-ranger
cd cs-ranger
```

Create the production env file:

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Required production values:

```env
NODE_ENV=production
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_SITE_URL=https://learnrift.site
FRONTEND_URL=https://learnrift.site
NEXT_PUBLIC_USE_MOCKS=false
JWT_SECRET=<strong generated secret>
SUPABASE_URL=<supabase project url>
SUPABASE_SERVICE_KEY=<service role key>
NEXT_PUBLIC_SUPABASE_URL=<supabase project url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
REDIS_URL=<redis url>
```

Create the PM2 systemd startup service:

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u "$USER" --hp "$HOME"
```

Run the first deploy manually:

```bash
cd "$HOME/cs-ranger"
chmod +x deploy.sh
./deploy.sh
```

Verify:

```bash
pm2 status
curl http://127.0.0.1:4000/health
curl -I http://127.0.0.1:3000
curl -I https://learnrift.site
curl https://learnrift.site/api/health
```

## GitHub Secrets

Add these in GitHub:

```text
Settings -> Secrets and variables -> Actions -> New repository secret
```

Required secrets:

```text
DEPLOY_HOST=learnrift.site
DEPLOY_USER=kumarshivamiitkcse
DEPLOY_SSH_KEY=<private ssh key that can access the VM>
```

The matching public key must be present on the VM:

```bash
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
nano "$HOME/.ssh/authorized_keys"
chmod 600 "$HOME/.ssh/authorized_keys"
```

## Deployment Flow

On every push to `main`, GitHub Actions:

1. Installs root, frontend, and backend dependencies from lockfiles.
2. Runs typecheck, lint, tests, build, and production dependency audits.
3. SSHes into the VM.
4. Checks out the exact pushed commit.
5. Runs `./deploy.sh`.

`deploy.sh` then:

1. Removes stale PM2 entries for this app.
2. Installs dependencies from lockfiles on the VM.
3. Sources `.env` before the frontend build.
4. Builds the frontend.
5. Starts the canonical `ecosystem.config.cjs`.
6. Health-checks frontend and gateway/services.
7. Saves the clean PM2 process list.

The app is intentionally stopped before install/build because this is a cheap
single-VM deployment. That short downtime is safer than building Next.js while
all backend services are already using RAM.

On a small or cold VM, `next start` can take around 90-120 seconds to become
ready after a fresh build. `deploy.sh` waits up to 180 seconds before failing
the frontend health check.

## Manual Recovery

If the site returns 502:

```bash
ssh DEPLOY_USER@DEPLOY_HOST
cd "$HOME/cs-ranger"
./deploy.sh
```

If PM2 is empty after a reboot:

```bash
systemctl status "pm2-$USER" --no-pager
pm2 resurrect
pm2 status
```

If memory pressure appears on a small VM, add swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## When to Upgrade

Do this order:

1. Keep one VM, add PM2 startup, add swap, and make deploys clean.
2. If memory genuinely stays high (check `free -h`), resize from `e2-small` to
   `e2-medium`. **But frequent PM2 restarts are usually NOT memory.** On this box
   they have been startup crash-loops: every backend service runs
   `assertProductionEnv()` via `createService`, so one missing/invalid required
   env var (e.g. `INTERNAL_API_SECRET`, `JWT_SECRET`, `SUPABASE_*`) makes them all
   throw on boot and restart endlessly — the api-gateway flaps and the GCP uptime
   check pages. Diagnose with `pm2 logs <service> --err --lines 40 --nostream`
   and `free -h` BEFORE blaming RAM; resizing never fixes a crash-on-boot.
   (Mitigations already in place: exponential-backoff restarts in
   `ecosystem.config.cjs`, and a secret preflight in `deploy.sh` that aborts a
   deploy rather than swapping in crash-looping processes.)
3. Only add a load balancer, managed instance group, and autoscaling after the
   app is stable on one VM and traffic justifies the extra cost.

Autoscaling does not fix a process that crashes on one VM; it only creates more
VMs with the same crash unless the single-instance deployment is stable first.
