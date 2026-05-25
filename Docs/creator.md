# Creator — Role, Dashboard & Features

This document covers everything a user experiences when operating in the **Creator** role: the overview dashboard, course management, doubts inbox, and finance.

---

## 1. Creator Role Overview

Any registered user can become a Creator. The Creator role is activated either during onboarding (by selecting "I want to create and sell courses") or later via Profile Settings → "Become a Creator".

Before a Creator can publish their first course, they must:
1. Accept the **Creator Terms & Conditions** (which includes the current platform commission rate, prohibited content policy, refund policy, and payout schedule).
2. Complete **KYC via Razorpay** before any payout can be disbursed (KYC completion is not required to publish — only to receive payments).

A Creator and Learner role coexist on the same account. The user switches between views via the navbar role-switcher.

---

## 2. Creator Navbar Links

The navbar when in Creator view shows:

| Link | Route | Description |
|---|---|---|
| Overview | `/creator/overview` | KPI dashboard, earnings summary, recent activity. |
| Courses | `/creator/courses` | List of all the creator's courses + course builder. |
| Doubts | `/creator/doubts` | Unified inbox for all learner comments/doubts. |
| Finance | `/creator/finance` | Revenue analytics, bank details, payout history. |

---

## 3. Overview Dashboard (`/creator/overview`)

The overview is the first page a Creator lands on. It gives a quick snapshot of their platform presence and revenue at a glance.

### 3.1 KPI Cards (Top Row)

A row of summary cards, each with a current value and a delta from last month (e.g., "+12% vs last month"):

| KPI | Description |
|---|---|
| Total Revenue (All Time) | Gross revenue from all enrollments across all courses, before commission deduction. |
| Revenue This Month | Gross revenue earned in the current calendar month. |
| Total Students | Unique learners enrolled across all published courses. |
| New Students This Month | New enrollments in the current calendar month. |
| Published Courses | Count of courses in `published` status. |
| Average Rating | Weighted average star rating across all published courses (courses with ≥ 3 reviews). |
| Total Nodes Published | Sum of all published nodes across all courses. |

### 3.2 Revenue Chart

A **line chart** showing monthly gross revenue for the past 12 months. X-axis: months. Y-axis: INR amount.

Hovering over a data point shows a tooltip: "Month — ₹{amount} from {N} enrollments".

The chart also has a toggle to switch between:
- **All courses** (default).
- **Per course** (a dropdown to select a specific course and see its individual revenue trend).

### 3.3 Enrollment Chart

A bar chart showing new enrollments per month for the past 12 months (same time range as revenue chart). Useful for spotting seasonal patterns.

### 3.4 Top Performing Course

A highlighted card showing the creator's single best-performing course by total revenue:
- Thumbnail.
- Title.
- Gross revenue + net earnings (after commission).
- Total students.
- Average rating.
- "View Analytics" link → course-level analytics page.

### 3.5 Pending Balance

A card showing:
- Current pending balance (revenue earned but not yet paid out).
- Next scheduled payout date.
- Last payout amount + date.
- "View Finance Details" link → `/creator/finance`.

### 3.6 Recent Activity Feed

A chronological feed of the last 20 platform events related to this creator:
- "🎓 {Learner Name} enrolled in [Course Name]" — with timestamp.
- "💬 New doubt in [Course Name] → [Node Name]: {question preview}" — with "Reply" CTA.
- "⭐ New review on [Course Name]: {rating stars} — {review snippet}".
- "💰 Payout of ₹{amount} processed."
- "✅ Course [Name] approved and published."
- "❌ Course [Name] rejected: {reason preview}" — with "Edit Course" CTA.

### 3.7 Quick Actions

Buttons in the top-right of the overview:
- "Create New Course" → opens the course builder.
- "View All Doubts" → `/creator/doubts`.

---

## 4. Courses (`/creator/courses`)

### 4.1 Course List

A table (or card grid — toggle available) of all the creator's courses regardless of status.

**Table columns**:

| Column | Description |
|---|---|
| Thumbnail | Small image. |
| Title | Course title. Clicking opens the course builder/editor. |
| Status | Pill badge: `Draft` (grey) / `Under Review` (yellow) / `Published` (green) / `Archived` (red). |
| Students | Total enrolled learners. |
| Revenue | Gross revenue from this course. |
| Rating | Avg. star rating + review count. |
| Last Updated | Date of last edit. |
| Actions | Edit / View / Archive / Duplicate buttons. |

**Status filter tabs** at the top: All / Published / Drafts / Under Review / Archived.

**Sort**: by last updated, by students, by revenue, by rating, by title.

### 4.2 Course Builder (New / Edit)

The course builder is a multi-step form. Progress is auto-saved as a draft every 30 seconds (and on each step navigation). The creator can exit and return at any time; their progress is preserved.

A step indicator at the top shows which step they're on (1–5).

---

#### Step 1 — Course Basics

| Field | Type | Constraints |
|---|---|---|
| Course Title | Text input | Max 80 chars. Required. |
| Subtitle | Text input | Max 120 chars. Required. |
| Description | Rich text editor | Supports headings (H2/H3), bold, italic, lists (ordered + unordered), code blocks (with language selection), blockquotes, horizontal rules, links. Required. |
| Category | Dropdown | Required. Seeded by Admin. |
| Sub-category | Dropdown | Required. Depends on selected Category. |
| Language | Dropdown | Required. The language the course is taught in. |
| Level | Dropdown | Beginner / Intermediate / Advanced / All Levels. Required. |
| Tags | Tag input | Max 10 tags. Free-form. Comma or Enter to add. Shown as pills. |
| What You'll Learn | List builder | The creator adds bullet points (max 20, each max 120 chars). Shown on the course detail page. At least 3 required. |
| Prerequisites | List builder | Optional. What the learner should know before starting. |

---

#### Step 2 — Media

| Field | Type | Constraints |
|---|---|---|
| Thumbnail | Image upload | JPG/PNG/WEBP. Recommended 1280×720. Max 10 MB. Required. |
| Promotional Video | URL input (YouTube or Google Drive) | Optional. Max 3 minutes. Uses the same embedding mechanism as Video Nodes. |

The thumbnail can also be auto-generated from a template (solid colour background + course title text) if the creator doesn't have a custom image ready.

---

#### Step 3 — Curriculum Builder

This is the most complex step. The creator builds the full course structure here.

**Module management**:
- "Add Module" button: creates a new module at the bottom.
- Each module has: Title field (required), Description field (optional), and a drag handle for reordering.
- Modules can be collapsed/expanded to reduce visual clutter.
- "Delete Module" (only if the module has no nodes; otherwise prompts confirmation).

**Node management (within each module)**:
- "Add Node" button opens a picker: choose node type (PDF / Static Website / Video / Markdown / Quiz).
- Each node has its own editor UI (see `course.md §4`).
- Nodes can be dragged to reorder within a module.
- Nodes can be moved to a different module via a "Move to module..." dropdown.
- Nodes can be duplicated.
- Each node has a "Free Preview" toggle.

**Bulk actions**:
- Select multiple nodes → "Mark as Published" / "Mark as Draft" / "Move to module".

**Curriculum preview**:
- A collapsible sidebar shows a live outline of the full curriculum as the creator builds it, with node counts and total video duration per module.

---

#### Step 4 — Pricing

| Field | Type | Constraints |
|---|---|---|
| Course Type | Radio | Free / Paid |
| Price | Number input (INR) | Required if Paid. Min ₹49. |
| Discounted Price | Number input (INR) | Optional. Must be less than Price. |
| Discount Valid Until | Date picker | Optional. If no date, discount is permanent until manually removed. |
| Enrollment Limit | Number input | Optional. Leave blank for unlimited. |
| Certificate on Completion | Toggle | Whether a certificate is issued when a learner completes all nodes. |

---

#### Step 5 — Settings & Publish

| Field | Type | Description |
|---|---|---|
| Welcome Message | Textarea | Markdown. Sent to learner in their enrollment confirmation email and shown as a banner on first course entry. |
| Completion Message | Textarea | Markdown. Shown to the learner when they complete 100% of the course. |
| Sequential Unlock | Toggle | If enabled, learners must complete each node before the next is unlocked. Default: off (all nodes accessible from day one). |
| Discussion Enabled | Toggle | Whether the comment section is shown under nodes. Default: on. |

**Submit for Review** button:
- Validates all required fields across all steps. Shows inline errors for any incomplete fields.
- On success: course status changes to `under_review`. Creator sees a confirmation message: "Your course is submitted for review. We'll notify you when it's approved (usually within 48 hours)."
- Creator can "Withdraw Submission" at any time before Admin acts, which moves the course back to `draft`.

**Save as Draft** button: available on all steps. Saves current state without submitting for review.

---

### 4.3 Course Analytics (`/creator/courses/:courseId/analytics`)

A dedicated analytics page per course. Accessible from the course list (Actions → "View Analytics") or from the overview top-performing course card.

#### Enrollment Over Time

Line chart: new enrollments per day/week/month (toggleable time granularity). Overlay option to compare two time periods.

#### Node Completion Funnel

A funnel chart (or waterfall bar chart) showing, for each node in the course, what percentage of enrolled learners completed it. Helps identify "drop-off" nodes where learners disengage.

Example:
```
Module 1
  Node 1.1 — Intro Video         100% (everyone starts here)
  Node 1.2 — Overview Article     94%
  Node 1.3 — Quiz 1               81%   ← 13% drop-off, quiz too hard?
Module 2
  Node 2.1 — Deep Dive Video      68%
  ...
```

#### Revenue Breakdown

A pie chart + table showing:
- Gross revenue.
- Platform commission deducted.
- Net earnings.
- Refunds issued.
- Net payout received.

#### Quiz Performance

For each quiz node in the course:
- Average score across all learner attempts.
- Percentage of learners who passed on first attempt.
- Per-question analysis: for each question, what % of learners got it wrong. This helps identify confusing questions.

#### Review Summary

- Rating histogram (1–5 star distribution).
- Average rating trend over time.
- Most recent reviews with the option to "View all reviews" (which shows all reviews for the course with search/filter).

---

## 5. Doubts (`/creator/doubts`)

### 5.1 Overview

The Doubts page is the Creator's **unified inbox** for all learner comments posted in the comment section of any node across all their courses.

It is designed to make responding to learners efficient — the creator doesn't need to visit each course and each node individually.

### 5.2 Layout

**Left panel**: inbox list of comments (most recent first by default). Each item shows:
- Learner avatar + name.
- Course name.
- Node name (and type icon).
- First ~100 characters of the comment body.
- Timestamp ("3 hours ago").
- Status badge: `Unanswered` (yellow) / `Answered` (green) / `Resolved` (grey).
- Unread indicator dot.

**Right panel**: conversation view when an item is selected.
- Shows the full comment context: node title, module title, course title — with a "Go to Node" link.
- The original comment with the learner's full message.
- All existing replies in the thread.
- Reply input box for the creator to respond.
- "Mark as Resolved" button.

### 5.3 Filters

| Filter | Options |
|---|---|
| Course | All courses / Select a specific course |
| Status | All / Unanswered / Answered / Resolved |
| Sort | Newest first / Oldest first / Unanswered first |

### 5.4 Bulk Actions

Select multiple items → "Mark as Resolved" (for quick cleanup of old/answered doubts).

### 5.5 Notifications

- When a new comment is posted on any of the creator's course nodes, the creator receives:
  - An in-app notification (bell icon badge update + feed item).
  - An **email notification** (if enabled in notification settings). Emails are batched: at most one "new doubts" summary email per hour (lists all new comments in that hour).

---

## 6. Finance (`/creator/finance`)

### 6.1 Summary Section (Top)

Three large stat cards:

| Card | Value |
|---|---|
| Total Gross Revenue | Sum of all enrollment payments for this creator's courses (all time). |
| Platform Commission Paid | Sum of all commission deductions. |
| Total Net Earnings | Gross Revenue − Commission − Refunds. |

### 6.2 Revenue Analytics

Same charts as the course analytics but aggregated across all courses:
- Monthly net earnings trend (line chart, 12 months).
- Per-course revenue breakdown (horizontal bar chart: each bar is one course, showing its contribution to total revenue).

### 6.3 Payout Details

| Field | Description |
|---|---|
| Pending Balance | Current balance available for payout. |
| Minimum Payout Threshold | Set by Admin (e.g., ₹500). Creator cannot request payout below this amount. |
| Next Payout Date | When Admin will run the next bulk payout. Shown as a date. |
| Last Payout | Amount + date + status. |

### 6.4 Bank Account / UPI Details (KYC)

A form to add payment details:

**Option A — Bank Account**:
- Account Holder Name (must match KYC name).
- Account Number (input masked, shown as last 4 digits after saving).
- Confirm Account Number (separate field to prevent typos).
- IFSC Code (11 characters, validated format).
- Bank Name (auto-filled from IFSC after validation).

**Option B — UPI ID**:
- UPI ID (e.g., `name@upi`). Validated format.

After saving:
1. KYC Service initiates Razorpay Contact + Fund Account creation.
2. Razorpay performs verification. Status shown as `Pending KYC` / `KYC Approved` / `KYC Failed`.
3. If `KYC Failed`: the creator is shown the rejection reason and prompted to re-enter details.
4. Until KYC is `Approved`, a warning banner is shown: "Complete KYC to receive payouts."

The creator can have only one active payout method at a time. Changing it requires re-KYC.

### 6.5 Transaction Ledger

A detailed table of every financial event related to this creator:

| Column | Description |
|---|---|
| Date | Timestamp. |
| Type | `Enrollment Credit` / `Refund Debit` / `Commission Debit` / `Payout Debit` |
| Description | e.g., "Enrollment: [Learner Name] in [Course Name]" |
| Gross Amount | Amount before commission (for enrollments). |
| Commission | Commission deducted (for enrollments). |
| Net Amount | Amount credited to creator's balance. |
| Running Balance | Creator's pending balance after this transaction. |

Filterable by date range and transaction type. Downloadable as CSV.

### 6.6 Payout History

A table of past payouts:

| Column | Description |
|---|---|
| Payout Date | When the payout was initiated. |
| Settlement Date | When the funds were credited to the creator's account (sourced from Razorpay webhook). |
| Amount | Net amount paid. |
| Razorpay Payout ID | Reference ID for the creator's records. |
| Status | `Processing` / `Processed` / `Failed` |
| Action | "Download Receipt" for completed payouts. |

### 6.7 Tax Documents

- **TDS Certificate**: auto-generated quarterly (if TDS was deducted). Downloadable PDF. Format compliant with Form 16A requirements.
- **Earnings Statement**: annual summary of gross earnings, commission, refunds, and net earnings. Useful for income tax filings.

---

## 7. Creator Terms & Conditions

### 7.1 Initial Acceptance

Before a creator can submit their first course for review, a modal is shown with the full terms text. The creator must scroll to the bottom before the "I Accept" button becomes active (to prevent blind acceptance).

The T&C covers:
- The current platform commission rate (e.g., "The platform retains X% of each enrollment payment").
- Payout schedule (e.g., "Payouts are processed on the 1st and 15th of each month").
- Prohibited content (NSFW, copyrighted material, misinformation, etc.).
- Refund policy (the platform's refund window; refunds come out of the creator's balance).
- Content ownership (creator retains IP; grants the platform a license to host and distribute).
- Account termination conditions.

The acceptance is recorded in the DB: `(creator_id, accepted_at, commission_rate_at_acceptance, terms_version)`.

### 7.2 Updated Terms

If the Admin updates the T&C (e.g., changes the commission rate), existing creators are shown the new T&C the next time they log in and attempt to submit a course. They must re-accept before submitting.

Creators who have not re-accepted the updated terms can still manage their existing courses but cannot submit new ones until they accept.

---

## 8. Creator Public Profile (Learner View)

What learners see when they visit `/u/:creatorUsername`:
- Avatar, display name, bio, college, social links.
- "Subscribers: {N}" count.
- "Subscribe / Unsubscribe" button.
- **Courses tab**: grid of all published courses from this creator. Fully interactive (learners can bookmark or enroll directly).
- **About tab**: fuller bio (if the creator wrote an extended about section in profile settings).

---

## 9. Becoming a Creator Flow

If a logged-in Learner wants to become a Creator:

1. Go to Profile Settings → "Creator Account" section.
2. Click "Enable Creator Mode".
3. A quick onboarding step: accept Creator T&C.
4. Creator view is now available via the navbar role-switcher.
5. The creator can start building courses immediately. Payouts require KYC completion (prompted lazily when they try to view the Finance page).
