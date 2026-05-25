# Learner — Role, Features & User Flows

This document covers everything a user experiences when operating in the **Learner** role: navigation, dashboard, course catalog, creator directory, subscriptions, bookmarks, achievements, report cards, and support.

---

## 1. Learner Role Overview

Any registered user is a Learner by default. Learner and Creator are not mutually exclusive — a single account can have both roles enabled and switch between them via the navbar role-switcher (see `common.md §4.3`).

A Learner can:
- Browse and search the course catalog.
- Enroll in free courses instantly; pay for premium courses.
- Consume course content (watch videos, read markdown, take quizzes, view PDFs, interact with static website nodes).
- Comment and ask doubts on individual nodes.
- Subscribe to Creators (like a YouTube channel follow).
- Bookmark individual nodes for later reference.
- Track learning consistency via a heatmap dashboard.
- Earn badges and certificates.
- Review course performance in a report card.
- Contact support.

---

## 2. Learner Navbar Links

The navbar for a Learner shows these links (in order):

| Link | Route | Description |
|---|---|---|
| Home | `/home` | Personal dashboard with heatmap and in-progress courses. |
| My Courses | `/my-courses` | All enrolled courses. |
| Course Catalog | `/catalog` | Browse and discover all courses. |
| Creators | `/creators` | Directory of all Creators. |
| Bookmarks | `/bookmarks` | Saved nodes and courses. |
| Achievements | `/achievements` | Badges, streaks, certificates. |
| Report Cards | `/report-cards` | Quiz scores and learning analytics. |
| Transaction History | `/transactions` | Payment history. |
| Support | `/support` | Contact support, view tickets. |

---

## 3. Home / Dashboard (`/home`)

The dashboard is the Learner's personal command centre. It is **private** (only the learner can see their own dashboard).

### 3.1 Greeting Header

- "Good morning / afternoon / evening, {display name}" — time-of-day aware.
- Today's date.
- A motivational micro-message (rotated daily from a small curated list, e.g., "You're on a 5-day streak! Keep it up.").

### 3.2 Activity Heatmap

Inspired by **Codeforces** and GitHub's contribution graph. A calendar grid showing the past 52 weeks (1 year), where each cell represents one day.

- **Cell colour intensity** corresponds to how many nodes the learner completed on that day:
  - 0 nodes: lightest shade (empty/grey).
  - 1–2 nodes: light green.
  - 3–5 nodes: medium green.
  - 6–10 nodes: dark green.
  - 11+ nodes: darkest green.
- Hovering over a cell shows a tooltip: "{date} — {N} nodes completed".
- Below the heatmap: "Current streak: X days" and "Longest streak: Y days".
- The streak is defined as consecutive days where at least 1 node was completed.
- The heatmap is computed server-side from `lesson_progress` rows and cached (invalidated daily or on progress update).

### 3.3 Continue Learning Strip

A horizontal scroll strip showing the **3–5 most recently accessed courses** the learner is currently enrolled in but has not completed.

Each card in the strip shows:
- Course thumbnail.
- Course title (truncated at 2 lines).
- Creator name.
- Progress bar (`X% complete`).
- "Resume" button — deep-links directly to the **exact last node** the learner was on, and for Video nodes, resumes from the exact timestamp.

### 3.4 Recommended Courses

A grid (2 rows × 4 cols on desktop, single col on mobile) of courses recommended for this learner.

**Recommendation logic (priority order)**:
1. Courses in the same categories as courses the learner is currently enrolled in.
2. Courses by Creators the learner has subscribed to (not yet enrolled in).
3. Courses with high ratings in the learner's declared interest tags (set during onboarding).
4. Fallback: "Most popular this week" (top 8 by new enrollments in the past 7 days).

### 3.5 Subscribed Creator Updates

A feed section showing recent activity from Creators the learner subscribes to:
- "Creator X published a new course: [Course Name]" with a thumbnail and "Enroll" CTA.
- "Creator Y added a new node to [Course Name]: [Node Title]" with a "View Node" CTA (if already enrolled).

Feed items older than 14 days are not shown here (they are still visible in `/notifications`).

### 3.6 Stats Summary Bar

A row of 4 stat chips:
- **Courses Enrolled**: total count.
- **Courses Completed**: count with 100% progress.
- **Total Hours Learned**: sum of video watch time + estimated read time for completed markdown/PDF nodes.
- **Certificates Earned**: count.

---

## 4. My Courses (`/my-courses`)

A full list of every course the learner is enrolled in.

### 4.1 Tabs

- **In Progress**: courses with 1–99% completion. Sorted by last accessed date (most recent first) by default.
- **Completed**: courses with 100% completion. Sorted by completion date (most recent first).
- **All**: both tabs combined.

### 4.2 Course Card

Each card shows:
- Thumbnail.
- Course title.
- Creator name + small avatar.
- Progress bar with percentage.
- Last accessed: "2 days ago".
- **"Continue"** button (In Progress) or **"Review"** button (Completed) — both link to the course player.
- **Certificate button** (Completed, if certificate was enabled): "Download Certificate".

### 4.3 Filters and Sort (within My Courses)

Filter by:
- Category.
- Creator.
- Status: In Progress / Completed.

Sort by:
- Last accessed (default).
- Enrollment date.
- Progress percentage (ascending / descending).
- Alphabetical.

---

## 5. Course Catalog (`/catalog`)

See `course.md §9` for full search, filter, and sort details. This section covers the UX flow.

### 5.1 Page Layout

- **Top bar**: search bar (full width), sort dropdown.
- **Left sidebar** (desktop) / **Bottom sheet filter panel** (mobile): all filters.
- **Main area**: course cards in a responsive grid.
  - Desktop (≥ 1280px): 4 columns.
  - Tablet (768–1279px): 3 columns.
  - Mobile (< 768px): 1 column (large cards) or 2 columns (compact cards — user-toggleable).

### 5.2 Course Card (Catalog)

- Thumbnail.
- Course title (2-line truncation).
- Creator avatar + name.
- Star rating (numeric to 1 decimal + star graphic).
- Total enrollments ("1.2k students").
- Price: "Free" or "₹499" or "~~₹999~~ ₹499" (strike-through original price if discounted).
- Category tag (pill).
- Bookmark icon (heart/bookmark) — clicking it saves the course without navigating away.

### 5.3 Loading State

Skeleton screens (grey placeholder cards) while data loads — never a blank page or spinner only.

---

## 6. Creator Directory (`/creators`)

A searchable, filterable list of all Creators with at least one published course.

### 6.1 Page Layout

- Search bar: search by creator name.
- Filter: by category (what subjects they teach).
- Sort: by total students (most popular), by avg rating, by number of courses.

### 6.2 Creator Card

- Circular avatar (large).
- Display name + username.
- Category tags (up to 3 shown, rest collapsed).
- "X students · Y courses · Z★ avg rating".
- Subscribe / Subscribed toggle button.

### 6.3 Creator Public Profile (`/u/:username`)

Clicking a creator card goes to their public profile. Covered in `common.md §5`.

Learner-specific additions on this page:
- **Subscribe/Unsubscribe button** at the top (visible only to logged-in learners).
- **Subscriber count** shown (e.g., "2.4k subscribers").
- **Courses tab**: grid of all their published courses. Fully functional — learner can bookmark or click through to enroll.

---

## 7. Creator Subscriptions

Subscriptions work analogously to **YouTube channel subscriptions**.

### 7.1 Subscribing

- "Subscribe" button on the creator's public profile page and on creator cards in the directory.
- Subscription is free — it has nothing to do with paid course enrollment.
- When a learner subscribes, a `subscriptions` row is created: `(learner_id, creator_id, subscribed_at)`.

### 7.2 Subscription Benefits

Subscribing to a creator gives the learner:
1. **In-app notifications** when the creator:
   - Publishes a new course.
   - Adds a new node to an existing published course.
2. **Email notification** (if learner has email notifications enabled for "new content from followed creators").
3. **Feed items** on the dashboard home (see §3.5).

### 7.3 Unsubscribing

- "Unsubscribe" button replaces "Subscribe" when already subscribed.
- On unsubscribe: future notifications stop. Past notifications already delivered are not deleted.

### 7.4 Subscription & Bookmarks Relationship

**Important**: Bookmarks on individual nodes (see §8) are **linked to the learner's subscription to that creator**. Specifically:
- If a learner bookmarks a node from a **paid course they are not enrolled in**, the bookmark is visible only as long as they have the relevant context (either enrolled OR subscribed — TBD: confirm exact rule with product owner).
- If a learner is enrolled in a course but unenrolled later (e.g., refund), their node bookmarks from that course become inaccessible (grayed out with a "Re-enroll to access" message).

---

## 8. Bookmarks (`/bookmarks`)

Bookmarks are **node-level**, not course-level. A learner can bookmark any specific node they want to return to.

### 8.1 Bookmarking a Node

- A bookmark icon (e.g., a ribbon/flag icon) is shown in the top-right corner of every node's content area.
- Clicking it creates a bookmark immediately (optimistic UI — icon fills instantly, synced to server in background).
- Clicking it again removes the bookmark.
- No limit on the number of bookmarks.

### 8.2 Bookmarks Page Layout

The `/bookmarks` page shows all bookmarked nodes grouped by course.

```
[Course Thumbnail] Course Title — Creator Name
  ├── [Module Name]
  │     ├── [Node icon] Node Title          [Go to Node] [Remove Bookmark]
  │     └── [Node icon] Node Title          [Go to Node] [Remove Bookmark]
  └── [Module Name]
        └── [Node icon] Node Title          [Go to Node] [Remove Bookmark]

[Course Thumbnail] Course Title — Creator Name
  └── ...
```

- Each node entry shows: node type icon (PDF, video, markdown, quiz, website), node title, module name, course name.
- **"Go to Node"** button: links directly to that node in the course player.
- **"Remove Bookmark"** button: removes it.
- **Search** within bookmarks by node title or course name.

### 8.3 Accessibility of Bookmarked Nodes

- If the learner is **enrolled** in the course: the "Go to Node" button is active.
- If the learner is **not enrolled** (bookmarked from the course preview): the button is greyed out with tooltip "Enroll in this course to access".
- If the node was on a **paid course the learner was refunded from**: the bookmark persists visually but is greyed out.

---

## 9. Achievements (`/achievements`)

The achievements system is designed to gamify learning and reward consistency.

### 9.1 Badges

Badges are earned automatically when certain conditions are met. They are shown as icons with a name and description.

**List of badges (examples — expandable by Admin)**:

| Badge Name | Trigger Condition |
|---|---|
| First Step | Complete your very first node. |
| Course Completer | Complete your first course. |
| Speed Reader | Complete 3 markdown/PDF nodes in a single day. |
| Quiz Ace | Score 100% on any quiz. |
| Comeback Kid | Resume a course after being away for > 7 days. |
| Week Warrior | Maintain a 7-day learning streak. |
| Month Master | Maintain a 30-day learning streak. |
| Centurion | Complete 100 nodes in total (cumulative). |
| Polymath | Enroll in courses from 3 different categories. |
| Helpful Voice | Post 10 comments/doubts across any courses. |
| Early Adopter | Joined within the platform's first 3 months. |
| Top Reviewer | Write a review that gets 10+ upvotes from other learners. |

- New badges can be added by Admin at any time.
- Badges are evaluated asynchronously by the **Achievement Service** (see `design.md §3.2`) after the triggering event (e.g., a node completion event is published to the queue; Achievement Service consumes it and checks all relevant badge rules).

### 9.2 Badge Display

On the Achievements page:
- **Earned badges**: shown in full colour with the earned date below ("Earned on 14 May 2026").
- **Locked badges**: shown greyed out with the name visible but a "?" or lock icon. This creates a sense of discovery and encourages learners to keep going.
- Hovering/clicking a locked badge shows the unlock condition as a hint.

### 9.3 Learning Streak

- Shown at the top of the Achievements page as a large visual (flame icon + number).
- "Current streak: **23 days**" and "Longest streak: **47 days**".
- A streak continues as long as the learner completes at least 1 node per calendar day (midnight-to-midnight in the learner's local timezone).
- Missing a day resets the current streak to 0 (longest streak is preserved).
- A **"grace period"** of 24 hours is applied: if the learner has a ≥ 3-day streak and misses one day, a one-time grace notification is sent ("Don't break your streak! Complete a node today."). If they complete a node within 24 hours of the missed day, the streak is preserved. This grace period can only apply once per 30 days.

### 9.4 Certificates

When a learner completes 100% of a course that has `certificate_enabled = true`:

1. A **PDF certificate** is auto-generated with:
   - Learner's full display name (as it appears on their profile).
   - Course title.
   - Creator's name.
   - Date of completion.
   - Platform name and logo.
   - A unique **Certificate ID** (e.g., `CRSRNG-2026-A4F9B2`).
   - A **QR code** that links to the public verification URL: `/verify/:certificateId`.

2. The certificate is stored in Supabase Storage and linked to the learner's profile.
3. A download link is shown on the course completion screen and in My Courses (Completed tab).
4. An email is sent with the certificate as a PDF attachment.

**Certificate Verification Page** (`/verify/:certificateId`):
- Public, no login required.
- Shows: learner name, course name, creator name, completion date, and a "✓ Verified" stamp.
- Used by employers/institutions to confirm the certificate is genuine.

### 9.5 Public Badge Display

On the learner's public profile (`/u/:username`), earned badges are displayed as a grid of icons. The learner can choose (in Settings → Privacy) whether to show achievements publicly.

---

## 10. Report Cards (`/report-cards`)

The Report Card gives the learner a comprehensive view of their learning performance, with a focus on quiz results.

### 10.1 Summary Stats (Top Section)

| Metric | Description |
|---|---|
| Total Quizzes Attempted | Count of all quiz nodes where at least one attempt was made. |
| Average Quiz Score | Mean of (best score per quiz) across all attempted quizzes. |
| Quizzes Passed | Count where best score ≥ passing percentage. |
| Total Study Time | Sum of video watch time + estimated read time for completed nodes. |
| Nodes Completed | Total completed nodes count. |

### 10.2 Per-Course Report Card

Expanding or clicking on a course shows a detailed breakdown for that course:

- Course name + progress bar.
- A list of every **quiz node** in that course:
  - Quiz node title.
  - Number of attempts made.
  - Best score (%).
  - Latest attempt score.
  - Date of best attempt.
  - Pass / Fail status.
  - A "Review Answers" link that re-shows the quiz in read-only mode with correct answers and explanations — for any past attempt the learner selects.

- A list of **non-quiz nodes** showing: node title, type, and completion status.

### 10.3 Quiz Attempt History

For each quiz, the learner can view a history of all their attempts:
- Attempt #, date/time, score, time taken (if timed quiz), pass/fail.
- Clicking an attempt shows the full question-by-question breakdown for that attempt: learner's answer, correct answer, explanation.

### 10.4 Export

- "Export as PDF" button: generates a formatted PDF of the full report card (all courses, all quiz scores, summary stats). Useful for sharing with professors or employers.

---

## 11. Transaction History (`/transactions`)

A full audit trail of every payment the learner has made on the platform.

### 11.1 Table Columns

| Column | Description |
|---|---|
| Date | Date and time of the transaction. |
| Course | Name of the course purchased (clickable, links to the course). |
| Amount | Amount paid in INR. |
| Original Price | Full price before any discount (shown if a discount was applied). |
| Payment Method | e.g., UPI, Credit Card, Net Banking, Wallet (sourced from Razorpay). |
| Transaction ID | Razorpay payment ID (e.g., `pay_XXXXXXXXX`). Copyable. |
| Status | `Success` (green), `Refunded` (orange), `Failed` (red). |

### 11.2 Filters

- Date range picker.
- Status filter.

### 11.3 Download

"Download CSV" button exports the filtered list of transactions.

### 11.4 Refund Request

For eligible transactions (within the refund window set by Admin, e.g., 7 days from purchase):
- A "Request Refund" button appears next to the transaction row.
- Clicking it opens a small form: reason for refund (optional dropdown + freetext).
- On submission: a support ticket is automatically created, linked to the transaction, and the refund request is flagged for Admin review.
- Once approved by Admin, the refund is processed via Razorpay and the transaction status changes to "Refunded".
- The enrollment is revoked after refund.

---

## 12. Support (`/support`)

### 12.1 FAQ Section

- A searchable accordion of common questions and answers.
- Questions are grouped by category (e.g., "Payments", "Courses", "Account").
- Searching filters the accordion in real-time.

### 12.2 Contact Support

A form to raise a new support ticket:

| Field | Type | Details |
|---|---|---|
| Subject | Text | Max 120 characters. |
| Category | Dropdown | Payment issue / Course access issue / Account issue / Bug report / Other. |
| Description | Textarea | Markdown supported. Max 2000 characters. |
| Attachment | File upload | Optional. Max 5 MB. JPG/PNG/PDF. |

On submit: a ticket is created and a confirmation email is sent with the ticket ID.

### 12.3 My Tickets

A list of the learner's past and current support tickets:
- Ticket ID, subject, category, status (`Open` / `In Progress` / `Resolved`), created date, last updated.
- Clicking a ticket opens the full conversation thread between the learner and the support admin.
- The learner can reply within the ticket thread.
- A resolved ticket can be re-opened by the learner within 7 days ("Was this issue resolved? No — Re-open ticket").

---

## 13. Enrollment Flow

### 13.1 Free Course

1. Learner clicks "Enroll Now" on course detail page.
2. A confirmation modal: "Enroll in [Course Name] for free?"
3. Learner confirms → enrollment row created immediately → redirect to course player.

### 13.2 Paid Course

1. Learner clicks "Enroll Now".
2. A checkout summary modal: course name, price, any applicable discount.
3. Learner clicks "Proceed to Pay" → Razorpay checkout modal opens.
4. Learner selects payment method and completes payment.
5. Razorpay webhook fires → Payment Service verifies → enrollment created → redirect to course player with a success toast: "You're enrolled! Welcome to [Course Name]."
6. Enrollment confirmation email sent.

### 13.3 Already Enrolled

If a learner visits a course detail page for a course they're already enrolled in, the "Enroll Now" button is replaced with "Continue Learning →" (deep-links to last accessed node).

---

## 14. Course Player (Learner Experience)

URL: `/course/:courseId/learn/:nodeId`

### 14.1 Layout

```
┌─────────────────────────────────────────────────────┐
│ Navbar (sticky)                                      │
├──────────────────────────────┬──────────────────────┤
│                              │ Course Sidebar        │
│  Node Content Area           │ (collapsible)         │
│  (video / markdown / quiz /  │                       │
│   PDF / static website)      │ Progress: 34%  ██░░░  │
│                              │                       │
│                              │ ▶ Module 1            │
│                              │   ✓ Node 1.1 Video    │
│                              │   ✓ Node 1.2 Article  │
│                              │   → Node 1.3 Quiz ◀   │  ← current
│                              │   ○ Node 1.4 PDF      │
│                              │                       │
│                              │ ▶ Module 2            │
│                              │   ○ Node 2.1 Video    │
│                              │   ...                 │
├──────────────────────────────┴──────────────────────┤
│ Comment / Doubt Section (below node content)         │
└─────────────────────────────────────────────────────┘
```

### 14.2 Course Sidebar

- Shows all modules (collapsible) and all nodes within each module.
- Icons indicate node type (play button for video, document for PDF, etc.).
- Checkmark (✓) on completed nodes.
- Arrow (→) on the current node.
- Circle (○) on not-yet-visited nodes.
- Clicking any completed or unlocked node navigates to it without a full page reload (client-side routing).
- Locked nodes (in sequential unlock mode, if Creator enables it) show a lock icon and are not clickable.
- The sidebar is collapsible (chevron button) to give the content area more space. State remembered in `localStorage`.

### 14.3 Navigation Arrows

Below the node content area: "← Previous Node" and "Next Node →" buttons for sequential navigation.

For Video nodes: after the video ends, a **5-second auto-advance countdown** appears ("Next: [Node Title] in 5s [Cancel]"). If the learner doesn't cancel, it advances automatically.

### 14.4 Notes (Video Nodes)

- A "Notes" tab is shown next to the video player (below or in a side panel).
- Learner can type a note; it is automatically timestamped to the current playback position.
- Notes are saved per-learner, per-node, to the DB.
- A note entry shows: `[MM:SS] Note text`. Clicking the timestamp seeks the video to that point.
- All notes for the entire course are accessible from the Report Card (exportable as PDF).

### 14.5 "Mark as Done" Button

For node types where completion isn't automatically detected (e.g., static website, PDF, markdown on short pages), a "Mark as Done" button is shown prominently. Clicking it marks the node complete and advances to the next one.
