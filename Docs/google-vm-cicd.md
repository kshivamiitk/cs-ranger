# Google VM CI/CD

This project deploys to one Google Compute Engine VM with:

- Nginx on ports 80/443.
- Next.js on localhost:3000.
- API gateway on localhost:4000.
- Backend services on localhost:4001-4012.
- PM2 as the process manager.
- GitHub Actions as CI/CD.

## One-Time VM Setup

Run these on the VM once:

```bash
sudo apt update
sudo apt install -y git nginx certbot python3-certbot-nginx curl build-essential

curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
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

1. Installs dependencies from lockfiles on the VM.
2. Sources `.env` before the frontend build.
3. Builds the frontend.
4. Removes stale PM2 entries for this app.
5. Starts the canonical `ecosystem.config.cjs`.
6. Health-checks frontend and gateway/services.
7. Saves the clean PM2 process list.

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

If memory pressure appears on a 2 GB VM, add swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```
