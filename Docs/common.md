# Common — Shared Pages & Components

This document covers everything that is **not role-specific**: the landing page, authentication flows, the global navbar, theming, and any other UI or logic that every user (Learner, Creator, Admin) encounters.

---

## 1. Website Identity

- **Working name**: LearnRift (changeable without a code deploy — stored in an environment variable `NEXT_PUBLIC_SITE_NAME`).
- **Logo**: SVG format so it scales crisply at any size. Used in the navbar, email templates, certificates, and the browser tab favicon.
- **Favicon**: generated from the logo mark (not the full wordmark). Required sizes: 16×16, 32×32, 180×180 (Apple Touch Icon), 192×192 (Android), and a 512×512 PNG for PWA manifest. All generated from a single master SVG via favicon.io or `sharp`.
- **Brand colors**: defined as CSS custom properties. Both light and dark variants are specified at the root level (`--brand-primary`, `--brand-accent`, etc.) so every component inherits them without hard-coding hex values.

---

## 2. Landing Page (`/`)

The landing page is the first thing an unauthenticated visitor sees. It must convey what the platform does within 5 seconds. It is **public** (no login required) and **statically generated** (SSG) for near-instant load times.

### 2.1 Hero Section

- Full-viewport-height section.
- **Headline**: one punchy line explaining the platform's core value (e.g., "Learn from India's sharpest students. Earn by teaching what you know.").
- **Sub-headline**: one sentence expanding on it (2–3 lines max).
- **Primary CTA button**: "Get Started Free" → `/signup`.
- **Secondary CTA**: "Explore Courses" → `/catalog`.
- **Background**: subtle animated gradient or a looping short video/lottie illustration. Must not distract from the text.
- **Social proof strip** directly below the headline: "X learners enrolled · Y courses · Z creators" — these numbers are fetched from the DB at build time and refreshed via ISR (Incremental Static Regeneration) every 24 hours.

### 2.2 How It Works Section

A three-step visual walkthrough using icons + short text:

1. **Discover** — Browse hundreds of courses across CS, math, and engineering topics.
2. **Learn** — Watch videos, read notes, attempt quizzes, ask doubts — all in one place.
3. **Earn** — Create your own courses and get paid directly to your bank account.

### 2.3 Featured Courses Section

- A horizontal scroll row of 6–8 hand-picked courses (curated by Admin from the platform dashboard).
- Each card shows: thumbnail, title, creator name + avatar, star rating, and price.
- "View All Courses" link at the end.

### 2.4 Creators Spotlight Section

- 4–6 featured creator cards: avatar, name, subject area, student count, a one-line bio.
- "Become a Creator" CTA button.

### 2.5 Platform Analytics Section

Live-ish counters (updated via ISR daily):
- Total learners.
- Total courses published.
- Total hours of content.
- Total creators.

Displayed as large bold numbers with a short label. Animated count-up effect on scroll into view.

### 2.6 Testimonials Section

Static testimonial cards (3–5) with: quote, learner name, college/institution, and profile photo. These are manually curated by Admin.

### 2.7 Pricing / Monetization Transparency Section

A short explainer for potential Creators:
- "You set the price. We take X%. You keep the rest."
- The commission percentage is fetched from platform settings (same value Admin controls) so it always stays in sync.

### 2.8 FAQ Section

Collapsible accordion. 6–10 common questions. Content managed by Admin via platform settings or a static config file.

### 2.9 Footer

- Logo + one-liner tagline.
- Links: About, Blog, Careers, Privacy Policy, Terms of Service, Refund Policy.
- Social media icons: Twitter/X, LinkedIn, GitHub, Instagram.
- Copyright line: "© {year} LearnRift. All rights reserved."
- Theme toggle (for visitors who want to browse the landing page in dark mode).

---

## 3. Authentication

### 3.1 Sign Up Page (`/signup`)

Two methods:

#### 3.1.1 Manual (Email + Password)

Form fields:
| Field | Type | Validation |
|---|---|---|
| Full Name | Text | 2–60 characters, required. |
| Email | Email | Valid email format, must be unique in the system, required. |
| Password | Password | Min 8 characters, at least one uppercase, one lowercase, one digit. Show/hide toggle. |
| Confirm Password | Password | Must match Password field. |

On submit:
1. Client-side validation runs first (instant feedback on each field blur).
2. Server-side: check email uniqueness. If taken → inline error "This email is already registered. [Log in instead?](/login)".
3. If unique: create user record with `role = learner` by default, send **verification email** with a signed token link valid for 24 hours.
4. Redirect to a "Check your inbox" page.

Email verification:
- User clicks the link → token validated → account marked `is_verified = true` → auto-logged in → redirect to `/home`.
- If token expired → show "Link expired" page with a "Resend verification email" button.

#### 3.1.2 Google OAuth

- "Continue with Google" button.
- Initiates OAuth 2.0 flow via Supabase Auth (Google provider).
- On callback: if first time → create user record + profile, skip email verification (Google already verified the email), redirect to a **onboarding step** (see §3.3).
- If returning user → log in, redirect to `/home`.

#### 3.1.3 Role Selection at Signup

After the account is created (both methods), the user is asked a single question:
> "What brings you here?"
> - [ ] I want to learn.
> - [ ] I want to create and sell courses.
> - [ ] Both.

This sets the initial role. A user can always enable both roles later from profile settings.

### 3.2 Log In Page (`/login`)

- Email + Password form. "Forgot password?" link.
- "Continue with Google" button.
- On success: redirect to the role-appropriate home (`/home` for learner, `/creator/overview` for creator, `/admin/overview` for admin).
- After 5 failed attempts within 15 minutes: show a CAPTCHA challenge and lock the account for 15 minutes.

### 3.3 Onboarding Flow (First Login Only)

After the very first login (flag: `has_completed_onboarding = false`), a multi-step modal guides the user through setup. The user can skip any step.

**Step 1 — Profile basics**:
- Upload profile photo.
- Set username (auto-suggested from their name, editable).
- College / Institution (optional).

**Step 2 — Interests** (Learners and dual-role):
- Multi-select interest tags (e.g., Data Structures, Web Development, Machine Learning, Mathematics).
- Used to personalise the home feed and recommendations.

**Step 3 — Creator intro** (Creators and dual-role):
- A brief explainer: "Here's how earning works." Shows the commission rate, payout schedule, and a link to the full T&C.
- Checkbox: "I have read and agree to the Creator Terms & Conditions." Required to proceed as a creator.

**Step 4 — Done**:
- "You're all set, {name}!" + a single CTA to the appropriate dashboard.
- Set `has_completed_onboarding = true`.

### 3.4 Forgot Password (`/forgot-password`)

1. User enters their registered email.
2. If found: a password-reset email is sent with a signed link (valid for 1 hour, single-use).
3. Response is always "If this email is registered, you'll receive a link" — to prevent email enumeration.

Password Reset Page (`/reset-password?token=...`):
- Validates token server-side before showing the form.
- Two fields: New Password + Confirm Password.
- On success: password updated, all existing sessions invalidated, redirect to `/login` with a success toast.

### 3.5 Session Management

- **Access token**: JWT, 15-minute expiry. Signed with a server-side secret.
- **Refresh token**: opaque random string, 30-day expiry. Stored in an `httpOnly`, `SameSite=Strict`, `Secure` cookie.
- On every API request: if access token is expired, the client auto-requests a new one using the refresh token (transparent to the user).
- Refresh tokens are **rotated** on each use (old one invalidated, new one issued).
- "Log out from all devices" option in Settings invalidates all refresh tokens for that user.

---

## 4. Global Navbar

The navbar is the top bar present on **every authenticated page**. It is sticky (fixed to the top on scroll) and responsive.

### 4.1 Layout

```
[Logo]   [Nav Links — role-specific]   [Search]   [Notifications]  [Theme Toggle]  [Avatar Dropdown]
```

On mobile (< 768px): nav links collapse into a hamburger menu that slides in from the left as a drawer.

### 4.2 Logo

- SVG. Links to the role-appropriate home page.
- Next to the logo, the site name text is shown on desktop but hidden on mobile (logo mark only).

### 4.3 Role-Specific Nav Links

See `learner.md`, `creator.md`, and `admin.md` for the exact links per role.

If a user has both Learner and Creator roles enabled, there is a **role switcher** in the navbar — a small pill/toggle that switches between "Learner view" and "Creator view". This only changes which nav links are shown and which dashboard is the default; it does not create separate accounts.

### 4.4 Global Search Bar

- Present on Learner and Creator views.
- Pressing `/` on the keyboard focuses the search bar (keyboard shortcut).
- Typing triggers a debounced (300ms) search against courses and creators.
- Results shown in a dropdown with two sections: "Courses" and "Creators".
- Pressing Enter or clicking "View all results" goes to `/search?q=...`.

### 4.5 Notifications Bell

- Bell icon with a badge showing the count of unread notifications.
- Clicking opens a dropdown showing the latest 10 notifications.
- Notification types:
  - New enrollment in one of your courses (Creator).
  - New doubt/comment on one of your course nodes (Creator).
  - Reply to a doubt you asked (Learner).
  - A creator you subscribed to published a new course or node (Learner).
  - Payout processed (Creator).
  - Support ticket status changed (Learner/Creator).
  - Achievement/badge earned (Learner).
- Each notification item shows: icon (type-specific), text, time ago, and an unread dot.
- "Mark all as read" button.
- "See all notifications" link → `/notifications`.
- Notifications arrive in real-time via **Supabase Realtime** (WebSocket subscription), so the badge count updates without a page refresh.

### 4.6 Theme Toggle

- Sun/Moon icon button.
- Switches between light and dark CSS class on `<html>`.
- Preference saved in `localStorage` AND synced to the user's DB profile.
- On initial page load: first check DB preference (if logged in) → else check `localStorage` → else fall back to OS preference (`prefers-color-scheme`).
- Transition: a CSS `transition: background-color 0.2s, color 0.2s` on the root so the switch is smooth, not jarring.

### 4.7 Avatar Dropdown

A circular avatar (user's photo, or initials on colored background if no photo). Dropdown items:
- **View Profile** → `/u/:username` (public profile page).
- **Edit Profile** → `/profile/edit`.
- **Settings** → `/settings`.
- *(Creator only)* **Creator Dashboard** → `/creator/overview`.
- *(Admin only)* **Admin Panel** → `/admin/overview`.
- **Log Out** → invalidates session, redirects to `/`.

---

## 5. Public Profile Page (`/u/:username`)

Accessible by anyone (even unauthenticated visitors).

- **Header**: cover photo (optional, uploadable), avatar (large), display name, username, college, bio, social links.
- **Stats strip**: if Learner role — courses enrolled, certificates earned. If Creator role — courses published, total students, average rating.
- **Tabs**:
  - "Courses" (if Creator): grid of their published courses.
  - "Achievements" (if Learner): publicly visible badges and certificates.
- Subscribe button (if Creator) — for Learners to follow this Creator.

---

## 6. Settings Page (`/settings`)

### 6.1 Account Settings
- Change email (requires re-verification of new email).
- Change password (requires current password).
- Connected accounts: link/unlink Google OAuth.
- "Delete Account" — soft-delete with a 30-day recovery window. Requires typing "DELETE" to confirm.

### 6.2 Notification Preferences
Toggles for email and in-app notifications per event type:
- New reply to my doubt.
- New course from a creator I follow.
- Payout processed.
- Support ticket update.
- Achievement earned.
- Platform announcements.

### 6.3 Privacy Settings
- Profile visibility: Public / Registered users only.
- Show college on profile: toggle.
- Show achievements on profile: toggle.

### 6.4 Appearance
- Theme: Light / Dark / System.
- Font size: Normal / Large (accessibility).

---

## 7. Error Pages

- **404 Not Found**: friendly illustration + "Looks like you're lost" + a button to go home.
- **500 Server Error**: friendly message + link to home + a link to file a support ticket.
- **403 Forbidden**: "You don't have permission to view this" with a back button.
- All error pages share the same navbar (if logged in) so the user is never stranded.

---

## 8. Accessibility & Performance Standards

- All interactive elements must be keyboard-navigable (Tab, Enter, Space, Escape).
- All images must have `alt` text.
- Color contrast ratio: at least 4.5:1 for normal text (WCAG AA).
- No layout shift on load (CLS < 0.1 as measured by Lighthouse).
- First Contentful Paint < 1.5 seconds on a simulated fast 3G connection.
- All forms must work without JavaScript (progressive enhancement) — critical for accessibility.
