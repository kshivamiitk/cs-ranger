# Course — Structure, Node Types & Content Model

This document defines how a course is structured, what types of content can exist inside it, how the comment/doubt system works under each node, and how the course is experienced by a learner.

---

## 1. Course Model Overview

A **Course** is the top-level container for educational content. It is created by a Creator and consumed by Learners. Every course is organised into a two-level hierarchy:

```
Course
 └── Module 1
      ├── Node 1.1  (e.g., Video)
      ├── Node 1.2  (e.g., Markdown article)
      └── Node 1.3  (e.g., Quiz)
 └── Module 2
      ├── Node 2.1
      └── ...
```

- A **Module** is a logical chapter or section (e.g., "Introduction to Recursion", "Dynamic Programming Basics").
- A **Node** is a single piece of content within a module. It is the atomic learning unit.

---

## 2. Course-Level Attributes

| Attribute | Description |
|---|---|
| Title | Max 80 characters. The primary name of the course. |
| Subtitle | Max 120 characters. A short descriptor shown on course cards. |
| Description | Rich text (supports headings, bold, italic, lists, code blocks, links). Shown on the course detail page. |
| Thumbnail | Image (JPG/PNG/WEBP), recommended 1280×720 px, max 10 MB. Stored in Supabase Storage. |
| Promotional video | Optional. A short (max 3 min) teaser video. Shown on the course detail page. Hosted via the same mechanism as Video Nodes (see §4.3). |
| Category | Top-level category (e.g., "Data Structures", "Web Development", "Mathematics"). Seeded and managed by Admin. |
| Sub-category | A more specific tag within the category (e.g., "Trees & Graphs" within "Data Structures"). |
| Language | The spoken language of the course content. |
| Level | Beginner / Intermediate / Advanced / All Levels. |
| Tags | Up to 10 free-form tags for discoverability (e.g., "leetcode", "dfs", "python"). |
| Pricing type | **Free** or **Paid**. |
| Price | In INR. Required if Paid. Must be ≥ ₹49. |
| Discounted price | Optional. If set, the original price is shown with a strikethrough. |
| Discount valid until | Optional date. After this date the discounted price stops applying automatically. |
| Enrollment limit | Optional cap on total learners (e.g., for cohort-based courses). |
| Certificate enabled | Boolean. If true, a certificate is auto-generated when a learner completes all nodes. |
| Status | `draft` → `under_review` → `published` → `archived`. |
| Welcome message | Text/markdown sent to the learner (via email + in-app notification) immediately on enrollment. |
| Completion message | Text/markdown shown when a learner completes 100% of the course. |

---

## 3. Module Attributes

| Attribute | Description |
|---|---|
| Title | Max 100 characters. |
| Description | Optional. Short text shown when the module is collapsed. |
| Position | Integer. Determines the order of modules. Drag-and-drop reordering available in the course builder. |
| Is published | Boolean. Unpublished modules are hidden from learners but visible to the creator in their builder. |

---

## 4. Node Types

A **Node** is a single learning unit within a module. A creator can add any mix of node types within a module. There is no restriction on order or quantity.

Each node has these **common attributes**:

| Attribute | Description |
|---|---|
| Title | Max 100 characters. Shown in the course curriculum sidebar. |
| Description | Optional. A short text description shown beneath the node title in the curriculum. |
| Position | Integer. Determines order within the module. |
| Is free preview | Boolean. If true, unenrolled learners can access this node (to get a taste of the course). |
| Is published | Boolean. Draft nodes are not visible to learners. |
| Attachments | Optional. Downloadable files (PDF, ZIP, etc.) the creator attaches to the node. Stored in Supabase Storage. Max 100 MB per attachment. |

---

### 4.1 PDF Node

**Purpose**: Share a document — notes, reference sheets, slides, research papers.

**How the Creator adds it**:
- Upload a PDF file (max 50 MB per file).
- The PDF is stored in Supabase Storage.
- Optionally add a description explaining what the PDF covers.

**How the Learner sees it**:
- An embedded PDF viewer renders the document directly in the page (using a library like `react-pdf` or an `<iframe>` pointing to a Supabase signed URL).
- The viewer supports: scroll through pages, zoom in/out, full-screen mode.
- A "Download PDF" button is shown (creator can optionally disable downloads if they only want online reading).
- Progress: marked as "completed" when the learner scrolls past 80% of the document OR clicks "Mark as done" manually.

---

### 4.2 Static Website Node

**Purpose**: Allow a creator to build an interactive, self-contained mini-webpage as part of a lesson — ideal for visualisations, interactive demos, practice exercises.

**How the Creator builds it**:
- An in-browser **code editor** (powered by Monaco Editor — the same engine as VS Code).
- Three tabs: **HTML**, **CSS**, **JS**.
- An **Images panel**: the creator can upload images (JPG/PNG/GIF/SVG, max 5 MB each) which are stored in Supabase Storage and available for reference in the HTML via a provided URL.
- A **Live Preview** pane shows the rendered output in real-time as the creator types. The preview runs inside a sandboxed `<iframe>` with `sandbox="allow-scripts"` to prevent XSS.
- A "Save" button persists the latest version. Previous versions are kept (up to 10 snapshots) so the creator can roll back.

**How the Learner sees it**:
- The rendered static website is displayed inside a sandboxed `<iframe>`, full-width within the lesson area.
- The iframe is resizable (drag the bottom edge).
- The learner **cannot edit** the code (read-only view). The creator chooses whether to show the source code alongside the preview via a "Show Source" toggle — useful for teaching.
- Progress: marked as "completed" when the learner has viewed the node for at least 30 seconds OR clicks "Mark as done".

**Technical note**: The HTML/CSS/JS files are bundled and stored as a Supabase Storage object. On render, the platform fetches the bundle and injects it into the sandboxed iframe. No server-side execution — purely client-side static content.

---

### 4.3 Video Node

**Purpose**: The most common node type. Supports lecture videos, screencasts, and walkthroughs.

**Video source options** (creator chooses one):

**Option A — YouTube link**
- Creator pastes a YouTube video URL.
- The platform embeds the video using the YouTube IFrame API.
- The player is styled to match the platform's theme.
- Progress tracking: the YouTube IFrame API exposes play/pause/time events; the platform hooks into these to track watch percentage and save last position.
- Limitation: videos must be publicly accessible or unlisted on YouTube. Private videos cannot be embedded.

**Option B — Google Drive link**
- Creator pastes a Google Drive shareable link (the video file must be set to "Anyone with the link can view").
- The platform embeds via the Google Drive preview URL (`https://drive.google.com/file/d/{FILE_ID}/preview`).
- The platform saves the `FILE_ID` and always reconstructs the embed URL from it (so if the creator pastes a messy share URL, it is sanitised server-side).
- Limitation: Google Drive has an unofficial bandwidth quota for embedded videos. This option is suitable for early-stage or low-traffic content; creators with large audiences should switch to YouTube.

**Video node attributes**:

| Attribute | Description |
|---|---|
| Source type | `youtube` or `google_drive` |
| Video ID / URL | Stored after extraction and sanitisation. |
| Duration | Auto-detected via the respective API where possible; otherwise manually entered by the creator. Shown in the curriculum sidebar. |
| Transcript / Subtitles | Optional. Creator can paste/upload a `.vtt` or `.srt` subtitle file. Shown as captions on the video. |
| Timestamps | Optional. Creator can define named chapters (e.g., "00:00 — Introduction", "05:30 — Main concept"). Shown as clickable chapters below the video. |

**How the Learner sees it**:
- Embedded video player (YouTube or Drive, styled to match platform).
- **Chapters panel** (if timestamps defined): a list of clickable chapters that seek the video to that point.
- **Notes panel**: learner can type timestamped notes. Each note is anchored to the current video timestamp and can be clicked to seek back to that moment. Notes are saved per-learner, per-node. Exportable as PDF from the Report Card page.
- **Playback speed control**: 0.5×, 0.75×, 1×, 1.25×, 1.5×, 2×.
- **Watch position save**: every 10 seconds, the current playback position is synced to the backend. On revisiting the node, the video resumes from where the learner left off (with a "Resume from X:XX?" prompt).
- Progress: node marked "completed" when the learner watches at least 80% of the video's duration.

---

### 4.4 Markdown Node

**Purpose**: Written text lessons — theory explanations, reading material, cheat sheets. Supports LaTeX for mathematical notation.

**How the Creator writes it**:
- A split-pane editor: **left pane** is a plain text editor for writing Markdown; **right pane** is a live rendered preview.
- Supports full **CommonMark** Markdown plus:
  - **LaTeX math**: inline (`$E = mc^2$`) and block (`$$\int_0^\infty e^{-x} dx$$`) — rendered via KaTeX.
  - **Code blocks** with syntax highlighting: specify the language after the triple backtick (`` ```python ``) and the code is highlighted by Prism.js or Shiki.
  - **Callout blocks**: special syntax (e.g., `:::note`, `:::warning`, `:::tip`) renders a coloured callout box.
  - **Tables**, **task lists**, **footnotes** (GFM extensions).
- "Save" button. Auto-save draft every 30 seconds.

**How the Learner sees it**:
- The rendered Markdown is displayed as clean, readable HTML.
- Heading levels generate an **in-page table of contents** shown in a sidebar (collapsible on mobile).
- Code blocks have a **"Copy code"** button.
- LaTeX math renders beautifully via KaTeX.
- Estimated read time shown at the top (calculated as word count ÷ 200 WPM).
- Progress: node marked "completed" when the learner scrolls past 80% of the page OR clicks "Mark as done".

---

### 4.5 Quiz Node

**Purpose**: Assess the learner's understanding of the material in an active-recall format.

**How the Creator builds it**:
- A quiz builder interface with a list of questions. Creator can add, remove, and drag-to-reorder questions.

**Per-question fields**:

| Field | Description |
|---|---|
| Question text | Rich text: supports Markdown + LaTeX (KaTeX rendering). No length limit. |
| Option A | Text: supports Markdown + LaTeX. |
| Option B | Text: supports Markdown + LaTeX. |
| Option C | Text: supports Markdown + LaTeX. |
| Option D | Text: supports Markdown + LaTeX. |
| Correct answer | Single-select: which option (A/B/C/D) is correct. |
| Explanation | Optional. Shown to the learner after they answer. Supports Markdown + LaTeX. Helps the learner understand why the correct answer is right. |

**Quiz-level settings**:

| Setting | Description |
|---|---|
| Timer | Optional. If set (in minutes), a countdown timer is shown. When time runs out, the quiz is auto-submitted. |
| Shuffle questions | Boolean. If true, question order is randomised per attempt. |
| Shuffle options | Boolean. If true, option order is randomised per attempt. |
| Show score on completion | Boolean. If false, only pass/fail is shown. |
| Passing percentage | 0–100. Default 60%. A learner must score ≥ this to mark the node as "completed". |
| Max attempts | Optional. If set, learner can only retake the quiz this many times. |

**How the Learner takes it**:
- One question displayed at a time (or all at once — creator chooses via a `display_mode` setting).
- Each question renders markdown + LaTeX correctly.
- Timer (if set) is shown as a countdown at the top, turns red in the last 60 seconds.
- After submitting:
  - Score shown: "You got X/Y correct (Z%)".
  - Per-question breakdown: correct answer highlighted in green, learner's wrong answer highlighted in red.
  - Explanation shown for every question (if creator provided it).
- If passed: node marked "completed". If failed (and retakes remain): a "Retake Quiz" button is shown.
- All attempts are recorded in the DB and visible in the learner's Report Card.

---

## 5. Comment / Doubt Section (Below Every Node)

Every node — regardless of type — has a **comment section** below its content. This serves dual purposes: peer discussion and formal doubt-raising to the Creator.

### 5.1 Comment Structure

- Top-level comments are posted by learners (or the creator).
- Each top-level comment can have **threaded replies** (one level deep — replies to replies are not shown separately; everything nests under the top-level comment to avoid deep threading confusion).
- A comment is composed of: author avatar + name, timestamp, comment body (supports Markdown, including code blocks and LaTeX), and action buttons.

### 5.2 Comment Actions

| Action | Who | Description |
|---|---|---|
| Post comment | Any enrolled learner, the course creator | Text input at the bottom of the section. Supports Markdown + LaTeX. |
| Reply | Any enrolled learner, the course creator | Opens an inline reply box under the comment. |
| Upvote | Any enrolled learner | A thumbs-up / upvote. Comment upvote count is shown. Top-voted comments float to the top. |
| Edit | Author of the comment | Can edit their own comment. Edited comments show a "(edited)" label. |
| Delete | Author of the comment, Creator, Admin | Soft-delete. Shows "This comment was removed." placeholder. |
| Mark as Resolved | Creator | On a doubt/question comment, the creator can mark it resolved. A green "✓ Resolved by Creator" badge is shown. |
| Pin | Creator | Creator can pin one comment to the top of the section (e.g., to pin their own important note or the most useful discussion). |

### 5.3 Comment Notifications

- When a learner posts a comment on a node: the **Creator is notified** (in-app + email digest).
- When the Creator (or anyone) replies to a learner's comment: the **learner is notified** (in-app + email).
- When someone replies to any comment in a thread the learner is participating in: that **learner is notified**.
- Email notifications for comments are batched into a digest (max one email per hour per user) to avoid flooding inboxes.

### 5.4 Comment Moderation

- **Creator**: can delete any comment on their own course nodes.
- **Admin**: can delete any comment platform-wide.
- **Reporting**: any learner can flag a comment as inappropriate. Flagged comments enter an admin moderation queue. Three flags auto-hides the comment pending review.

### 5.5 Comment Visibility

- Comments are only visible to enrolled learners and the creator. Unenrolled visitors browsing the free-preview node can see a teaser ("Join the course to see the discussion"), but cannot view or post comments.

---

## 6. Course Progress Tracking

### 6.1 Per-Node Completion

Each node independently tracks whether the learner has completed it:
- Video: watched ≥ 80% of duration.
- PDF: scrolled past 80% OR manually marked done.
- Markdown: scrolled past 80% OR manually marked done.
- Static Website: viewed for ≥ 30 seconds OR manually marked done.
- Quiz: achieved a passing score (≥ passing percentage set by creator).

### 6.2 Course Progress Percentage

`progress_percent = (completed_nodes / total_published_nodes) × 100`

Shown as a progress bar on the course card (in My Courses) and at the top of the course player.

### 6.3 Course Completion

When `progress_percent` reaches 100%:
- The enrollment record is marked `completed_at = NOW()`.
- If `certificate_enabled = true`: a certificate is generated (PDF, with unique verification URL).
- The course appears in the "Completed" tab of My Courses.
- The completion message set by the creator is displayed.
- An achievement badge may be triggered (see Achievements in `learner.md`).

---

## 7. Course Status State Machine

```
draft ──(submit for review)──► under_review ──(admin approves)──► published
                                     │
                               (admin rejects)
                                     │
                                     ▼
                                  draft  (creator is notified with rejection reason)

published ──(creator archives)──► archived
archived  ──(creator restores)──► draft
```

- A course in `draft` is fully editable by the creator.
- A course in `under_review` is locked from editing (to prevent changes mid-review). Creator can withdraw the submission (moves back to `draft`).
- A course in `published` can have its **curriculum edited** (nodes added/updated) without re-review. However, changes to the **title, category, or price** trigger a lightweight re-review notification to Admin (no full lock-down).
- A course in `archived` is hidden from the catalog but enrolled learners can still access it.

---

## 8. Course Detail Page (Unenrolled View)

URL: `/course/:courseId` or `/course/:courseId/:slug`

What an unenrolled visitor sees:
- Course banner (thumbnail or promo video autoplay on hover).
- Title, subtitle, creator info card (avatar, name, total students, rating).
- Rating summary: average star rating + histogram of 1–5 star counts + total review count.
- "What you'll learn" bullet points (entered by Creator as a plain list in course settings).
- "Prerequisites" bullet points (optional, entered by Creator).
- Full curriculum accordion: all modules and nodes listed with titles, types, duration (for videos), and lock icons on non-free-preview nodes. Free preview nodes have a "Preview" button.
- Course description (full rich text).
- Creator bio section.
- Reviews section: paginated list of learner reviews with star rating, date, and text body.
- **Sticky pricing sidebar** (desktop) / **sticky bottom bar** (mobile):
  - Price (with strike-through discounted price if applicable).
  - "Enroll Now" CTA (redirects to payment flow if paid; instant enrollment if free).
  - "Bookmark" icon (saves to bookmarks for later).
  - Course highlights: total modules, total nodes, total video hours, certificate availability.

---

## 9. Search & Discovery

### 9.1 Full-Text Search

- Search is executed against: course title, subtitle, description, and tags.
- Implemented using PostgreSQL `tsvector` with `GIN` index. The `tsquery` is built from the user's input with support for prefix matching (so "recur" matches "recursion").
- Results ranked by relevance (text similarity) × popularity (enrollment count) × recency.

### 9.2 Catalog Filters

Available on the Course Catalog page:

| Filter | Type | Options |
|---|---|---|
| Category | Multi-select checkbox | All platform categories |
| Price | Radio | Free / Paid / Any |
| Price range | Slider | ₹0 – ₹10,000 |
| Rating | Radio | 4★+, 3★+, Any |
| Level | Multi-select | Beginner, Intermediate, Advanced, All Levels |
| Language | Multi-select | All supported languages |
| Duration | Radio | < 2 hours, 2–10 hours, > 10 hours |

### 9.3 Sort Options

Relevance (default for searches) / Newest / Most Popular / Highest Rated / Price: Low to High / Price: High to Low.

### 9.4 Pagination

Page size: 20 courses per page. URL-based pagination (`?page=2`) so links are shareable. Infinite scroll is optional and can be toggled by the user.
