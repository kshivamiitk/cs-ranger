# Admin — Role, Panel & Platform Management

This document covers the Admin role: how admin accounts work, what the admin can see and do, and every page in the admin panel.

---

## 1. Admin Role Overview

The **Admin** is a superuser with platform-wide access. Admin accounts are **not creatable through any API or user-facing flow** — they can only be assigned via a direct database update (setting `users.role = 'admin'`). This is intentional to prevent privilege escalation.

A single platform can have multiple admins (e.g., a founder + a support team member), each with a full-access admin account.

An admin can simultaneously have Learner and Creator roles on the same account (since they are a regular user too), but the admin panel is a separate interface accessed via `/admin/*`.

---

## 2. Admin Panel Navigation

The admin panel has a **left sidebar** (persistent on desktop, hamburger-triggered on mobile) with:

| Link | Route | Description |
|---|---|---|
| Overview | `/admin/overview` | Platform KPIs, course review queue, recent activity. |
| Payouts | `/admin/payouts` | Creator payout management, bulk payout initiation. |
| Support Chats | `/admin/support` | All learner and creator support tickets. |
| Users | `/admin/users` | User management (view, ban, role assignment). |
| Courses | `/admin/courses` | Platform-wide course list, search, flag management. |
| Categories | `/admin/categories` | Manage course categories and sub-categories. |
| Platform Settings | `/admin/settings` | Commission rate, refund window, T&C content, feature flags. |
| Audit Log | `/admin/audit-log` | Immutable log of all admin actions. |

---

## 3. Overview (`/admin/overview`)

The overview is the admin's first view on login. It provides a bird's-eye view of the entire platform's health.

### 3.1 Platform KPI Cards (Top Row)

| KPI | Description |
|---|---|
| Total Users | Cumulative registered users (all roles combined). |
| New Users Today | Signups in the past 24 hours. |
| New Users This Week | Signups in the past 7 days. |
| Active Learners (MTD) | Unique learners who completed at least one node this calendar month. |
| Total Published Courses | Count of courses in `published` status. |
| Courses Under Review | Count in `under_review` status — number of courses waiting for admin action. |
| Total Revenue (All Time) | Sum of all enrollment payments platform-wide (gross). |
| Platform Commission Earned | Sum of all commission deductions platform-wide. |
| Total Payouts Disbursed | Sum of all payouts sent to creators. |

Each card shows a delta vs. the previous equivalent period (e.g., "↑ 14% vs. last week").

### 3.2 Revenue & Growth Charts

**Revenue Chart**: monthly gross revenue vs. platform commission (dual-line or stacked bar chart), past 12 months.

**User Growth Chart**: cumulative users over time (line chart) and new signups per month (bar chart).

**Enrollment Trend**: total new enrollments per month, past 12 months.

All charts are interactive (hover for exact values, click to drill down).

### 3.3 Course Review Queue

A table of all courses currently in `under_review` status, sorted by submission date (oldest first — to prevent starvation):

| Column | Description |
|---|---|
| Submitted | Date/time submitted. |
| Course Title | Clickable — opens the course preview. |
| Creator | Creator name + avatar. |
| Category | Course category. |
| Nodes | Total node count (quick proxy for course completeness). |
| Pricing | Free / ₹{price}. |
| Action | "Approve" button (green) / "Reject" button (red). |

**Approve flow**:
- Clicking "Approve" → confirmation modal: "Approve [Course Name]? It will immediately appear in the catalog."
- On confirm: course status → `published`. Creator is notified (in-app + email).

**Reject flow**:
- Clicking "Reject" → a modal with a **rejection reason** text area (required, min 20 characters).
- Admin selects a rejection category (dropdown): Policy Violation / Incomplete Content / Poor Quality / Misleading Title or Description / Other.
- On confirm: course status → `draft`. Creator is notified with the rejection reason and the selected category.

**Course Preview**: before approving/rejecting, admin can click the course title to open a full preview of the course (all modules, all nodes, read-only) in a new tab.

### 3.4 Recent Activity Feed

Same concept as the Creator's activity feed but platform-wide:
- New user registrations.
- New course submissions.
- Large enrollment events (e.g., "50 new enrollments in the last hour for [Course]").
- Support tickets opened.
- Payout processed / payout failed.
- Flagged comments requiring moderation.

### 3.5 Flagged Content Queue

A count badge shows if any content is flagged and pending moderation. Clicking it goes to a sub-section (or a dedicated page) listing:
- Flagged comments (with course + node context, reporter usernames, flag reason).
- Flagged courses (reported by users as violating policy).

---

## 4. Payouts (`/admin/payouts`)

### 4.1 Overview

The Payouts page is where the admin manages all money flowing out of the platform to creators.

### 4.2 Commission Settings

At the top of the page: a settings card showing the current platform commission rate.

- **Commission Rate**: a percentage input (e.g., `20`). This means the platform keeps 20% of every enrollment payment, and the creator receives 80%.
- "Save" button to update.
- **Important**: changing the commission rate does NOT retroactively affect past transactions. It applies to future enrollments only.
- Changing the commission rate increments the T&C version, which triggers re-acceptance from all creators on their next course submission.

### 4.3 Payout Schedule

The admin can configure when bulk payouts run:
- **Manual**: payouts only happen when admin clicks "Initiate Bulk Payout".
- **Automatic (scheduled)**: payout runs automatically on a schedule (e.g., 1st and 15th of each month). The admin still gets a notification when it runs and can see the results.

### 4.4 Minimum Payout Threshold

A setting (editable by admin): creators with a pending balance below this amount (e.g., ₹500) are excluded from a payout run and their balance carries forward to the next cycle.

### 4.5 Pending Payouts Table

A table of all creators with a pending balance ≥ minimum threshold, who are eligible for the next payout:

| Column | Description |
|---|---|
| Creator | Avatar + name + email. |
| KYC Status | `Approved` (green) / `Pending` (yellow) / `Failed` (red). Creators with non-Approved KYC are flagged but can still be included if admin overrides. |
| Pending Balance | Amount to be paid out (net of commission and refunds). |
| Bank / UPI | Masked account details (last 4 digits of account or UPI ID). |
| Last Payout | Date of the most recent payout to this creator. |

**Filters**: KYC status, balance range.

**Initiate Bulk Payout**:
- Button at the top: "Initiate Bulk Payout".
- A confirmation modal shows:
  - Total creators in this run: {N}.
  - Total amount to be disbursed: ₹{X}.
  - Estimated Razorpay fees: ₹{Y} (shown informatively).
  - A list of any creators being **excluded** (KYC not approved, below threshold, or failed payout in last run).
- Admin clicks "Confirm & Disburse".
- The Payout Service calls Razorpay's bulk payout API for each eligible creator.
- The admin is shown a real-time status update: "Processing {N} payouts... {M} completed, {K} failed."

### 4.6 Payout Run History

A table of all past payout runs:

| Column | Description |
|---|---|
| Date | When the run was initiated. |
| Initiated By | Admin username. |
| Creators Paid | Count of creators in this run. |
| Total Disbursed | Total amount paid out. |
| Success Count | How many individual payouts succeeded. |
| Failed Count | How many failed. |
| Status | `Completed` / `Partially Failed` / `Failed`. |
| Actions | "View Details" — opens a per-creator breakdown for this run. |

**Per-run detail view**:
- A table with one row per creator: creator name, amount, Razorpay payout ID, status, failure reason (if any).
- "Retry Failed" button to retry only the failed payouts in that run.

### 4.7 Individual Payout Actions

The admin can also manually initiate a payout to a single creator (e.g., to resolve a dispute or off-cycle payment) via an "Issue Manual Payout" button on the creator's row in the pending table. Requires entering the amount and a reason (logged in audit log).

### 4.8 Failed Payouts

A dedicated tab showing all individual payouts that are in `failed` status across all runs. For each:
- Creator name, run date, amount, failure reason from Razorpay (e.g., "Invalid IFSC", "Account frozen").
- "Retry" button (re-attempts the payout).
- "Contact Creator" button (creates a support ticket addressed to that creator explaining the issue).

---

## 5. Support Chats (`/admin/support`)

### 5.1 Overview

A unified support inbox for all tickets raised by Learners and Creators via `/support`.

### 5.2 Layout

- **Left panel**: list of all tickets, sortable and filterable.
- **Right panel**: full ticket conversation when a ticket is selected.

### 5.3 Ticket List Columns

| Column | Description |
|---|---|
| Ticket ID | Auto-generated ID (e.g., `TKT-00412`). |
| Subject | Ticket subject line. |
| User | Name + avatar of the user who opened it. Role badge (Learner / Creator). |
| Category | Payment / Course access / Account / Bug / Other. |
| Status | `Open` (red) / `In Progress` (yellow) / `Resolved` (green). |
| Assigned To | Admin member assigned (or "Unassigned"). |
| Opened | Date/time. |
| Last Updated | Date/time of the most recent message. |

### 5.4 Filters

| Filter | Options |
|---|---|
| Status | All / Open / In Progress / Resolved |
| Category | All / Payment / Course access / Account / Bug / Other |
| Role | All / Learner / Creator |
| Assigned To | All / Me / Unassigned / Specific admin |
| Date range | Opened date range |

### 5.5 Ticket Actions

When a ticket is open in the right panel:

- **Reply**: text area with Markdown support. Send button. The message is appended to the thread and the user is notified via email and in-app notification.
- **Internal Note**: a reply visible only to admins (not the user). Shown with a different background colour (e.g., yellow). Used for admin-to-admin communication on complex tickets.
- **Change Status**: dropdown to set `Open` / `In Progress` / `Resolved`.
- **Assign**: assign to any admin user. Assignee gets an in-app notification.
- **Close**: marks as `Resolved`. User is notified.
- **Reopen**: re-opens a resolved ticket (if user follows up or admin needs to revisit).

### 5.6 Canned Responses

Admins can save and use pre-written responses for common questions:
- A "Use Canned Response" button opens a searchable list of saved responses.
- Selecting one inserts it into the reply text area (editable before sending).
- Canned responses are managed in Platform Settings.

### 5.7 Linked Tickets

For refund-related support tickets (auto-created when a learner requests a refund from Transaction History):
- A special "Refund Request" label is shown.
- A "Approve Refund" / "Reject Refund" button is shown in the ticket view.
- Approving triggers the Payment Service to process the Razorpay refund and revoke the enrollment.

---

## 6. Users (`/admin/users`)

### 6.1 User List

A searchable, filterable table of all platform users.

| Column | Description |
|---|---|
| User | Avatar + display name + email. |
| Roles | Badges for each active role: Learner / Creator / Admin. |
| Joined | Registration date. |
| Status | `Active` / `Suspended` / `Pending Verification`. |
| KYC | (For creators) KYC status. |
| Actions | View profile / Suspend / Unsuspend / Grant Creator / Grant Admin. |

**Search**: by name, email, or username.
**Filter**: by role, by status, by join date range.

### 6.2 User Detail View

Clicking a user opens a detail view showing:
- Full profile info (read-only).
- Role history.
- Enrollment list (for learner role).
- Course list (for creator role).
- Transaction history (read-only).
- Support ticket history.
- Login history (last 10 sessions with IP and device).
- Audit log of admin actions taken on this account.

### 6.3 Suspend / Unsuspend

Suspending a user:
- Immediately invalidates all their active sessions.
- They cannot log in and see a "Your account has been suspended. Contact support." message.
- Their published courses remain visible in the catalog but enrollment is blocked (learners already enrolled can still access).
- All pending payouts are put on hold.
- Admin must enter a reason (logged in audit log).

Unsuspending reverses all the above.

### 6.4 Role Assignment

- **Grant Creator**: gives the user the Creator role without them going through the normal flow. Useful for manually onboarding a trusted creator.
- **Grant Admin**: promotes a user to Admin. **Requires confirmation from a second admin** (two-person rule). The request is logged in the audit log.
- **Revoke Creator / Revoke Admin**: removes a role. Revoking Creator while the creator has pending balances prompts a warning.

---

## 7. Courses (`/admin/courses`)

A platform-wide view of all courses (not just those under review).

### 7.1 Course List

| Column | Description |
|---|---|
| Thumbnail | Small. |
| Title | Clickable preview. |
| Creator | Name. |
| Category | |
| Status | All statuses. |
| Students | |
| Revenue | |
| Rating | |
| Flagged | Boolean — if the course has been flagged by users. |
| Actions | View / Force-approve / Force-reject / Suspend course. |

**Suspend course**: immediately hides a published course from the catalog and blocks new enrollments. Existing enrolled learners retain access. Used for policy violations while investigation is ongoing.

**Force-approve / Force-reject**: admin can act on a course outside the normal review flow (e.g., to quickly pull a policy-violating course).

---

## 8. Categories (`/admin/categories`)

### 8.1 Category List

A tree view:
```
Data Structures & Algorithms
  ├── Arrays & Strings
  ├── Trees & Graphs
  ├── Dynamic Programming
  └── ...
Web Development
  ├── Frontend (HTML/CSS/JS)
  ├── React
  ├── Node.js
  └── ...
Mathematics
  └── ...
```

### 8.2 Actions

- **Add Category**: a top-level category. Requires a name and an optional icon/emoji.
- **Add Sub-category**: within an existing category. Requires a name.
- **Rename**: edit the name of any category or sub-category.
- **Merge**: merge one sub-category into another (courses in the old sub-category are re-assigned).
- **Delete**: only if no courses are currently assigned to this category. Otherwise, must reassign courses first.

---

## 9. Platform Settings (`/admin/settings`)

### 9.1 General

| Setting | Description |
|---|---|
| Site Name | The display name of the platform (default: CS-Ranger). Changes the `NEXT_PUBLIC_SITE_NAME` env variable on next deploy OR is read dynamically from DB. |
| Site Tagline | Short tagline shown on the landing page hero section. |
| Contact Email | Platform support email shown in email footers. |

### 9.2 Commission & Payouts

| Setting | Description |
|---|---|
| Commission Rate (%) | Platform's cut from each paid enrollment. |
| Minimum Payout Threshold (₹) | Minimum balance a creator must have to be included in a payout run. |
| Payout Schedule | Manual / Automatic (1st & 15th / 1st only / custom cron). |
| TDS Threshold (₹/year) | Annual earnings above which TDS is deducted. Default: ₹30,000 (per Indian tax law). |
| TDS Rate (%) | Default: 10%. |

### 9.3 Refund Policy

| Setting | Description |
|---|---|
| Refund Window (days) | Number of days after enrollment within which a learner can request a refund. |
| Refund Auto-Approval | Boolean. If true, refunds within the window are auto-approved without admin review. |

### 9.4 Creator Terms & Conditions

A rich text editor for the full T&C text shown to creators. Saving increments the `terms_version` counter and marks all creators as needing re-acceptance.

### 9.5 Canned Responses

A CRUD interface for managing support canned responses:
- List of existing responses with title and body preview.
- Add / Edit / Delete.

### 9.6 Feature Flags

Boolean toggles for experimental features:
- Enable subscriptions (Creator follow feature).
- Enable achievements / badge system.
- Enable the static website node editor.
- Enable Google Drive video embed.
- Enable leaderboard on achievements page.

This allows the admin to soft-launch features to the full user base or roll them back without a code deploy.

### 9.7 Landing Page Curation

- **Featured Courses**: a drag-and-drop list of up to 8 course IDs to feature on the landing page.
- **Featured Creators**: a drag-and-drop list of up to 6 creator user IDs to spotlight on the landing page.
- **Testimonials**: add/edit/delete testimonial entries (quote, name, college, photo).

---

## 10. Audit Log (`/admin/audit-log`)

An **immutable** log of every admin action. Rows can never be deleted or edited — they are append-only.

### 10.1 Logged Events

Every admin action is logged, including:
- Course approved / rejected (by which admin, on which course, timestamp).
- User suspended / unsuspended (by which admin, on which user, reason).
- Role granted / revoked.
- Bulk payout initiated (by which admin, total amount, timestamp).
- Commission rate changed (old value → new value, by which admin).
- T&C updated (version increment, by which admin).
- Refund approved / rejected (by which admin, transaction ID, amount).
- Feature flag toggled.
- Category created / renamed / deleted.
- Platform setting changed (setting name, old value, new value).

### 10.2 Log Table Columns

| Column | Description |
|---|---|
| Timestamp | Exact date + time (UTC). |
| Admin | Name + email of the admin who performed the action. |
| Action Type | Human-readable label (e.g., "Course Approved"). |
| Target | The entity affected (e.g., course ID + title, user ID + name). |
| Details | JSON blob with before/after values or additional context. |
| IP Address | IP of the admin at time of action. |

### 10.3 Filters

- Date range.
- Admin (filter by which admin did the action).
- Action type.

Exportable as CSV.
