# LearnRift — Frontend

Next.js 15 + React 19 + TypeScript + Tailwind. Dark glassmorphic UI.

## Run

```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
# open http://localhost:3000
```

Backend is optional in dev — the app reads from `src/lib/mock-data.ts` so every page renders without API calls.

## Routes

### Public
- `/` Landing
- `/login`, `/signup`, `/forgot-password`, `/reset-password`
- `/catalog`, `/creators`, `/search?q=`
- `/course/:id`, `/u/:username`, `/verify/:certId`

### Learner (authenticated)
- `/home`, `/my-courses`, `/bookmarks`
- `/course/:id/learn/:nodeId` (course player)
- `/achievements`, `/report-cards`, `/transactions`, `/support`, `/notifications`
- `/profile/edit`, `/settings`

### Creator (`/creator/*`)
- `/creator/overview`, `/creator/courses`, `/creator/courses/new`
- `/creator/courses/:id/analytics`, `/creator/doubts`, `/creator/finance`

### Admin (`/admin/*`)
- `/admin/overview`, `/admin/payouts`, `/admin/support`
- `/admin/users`, `/admin/courses`, `/admin/categories`
- `/admin/settings`, `/admin/audit-log`

## Design tokens

CSS custom properties in `src/app/globals.css` — `--brand-primary` (violet), `--brand-accent` (cyan), `--color-bg`, `--color-surface`, etc. Light/dark switched by `.dark` class on `<html>`. Toggle in the navbar persists to `localStorage`.

## Mock vs. real data

Set `NEXT_PUBLIC_USE_MOCKS=false` and point `NEXT_PUBLIC_API_URL` at the api-gateway to switch to the real backend. (Page wiring to the API client is currently mock-first; replace direct imports of `mock-data.ts` with API calls when ready.)
