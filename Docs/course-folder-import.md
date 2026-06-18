# Course Folder Import

Use the importer when you have many lessons and do not want to add each one manually in the creator UI.

```bash

npm run course:import -- ./path/to/course --api https://learnrift.site/api
```

Add `--dry-run` first to validate the folder without creating anything.
Add `--yes --publish` to create and publish directly from the CLI:

```bash
npm run course:import -- ./path/to/course --api https://learnrift.site/api --yes --publish
```

## Authorization

The importer calls the normal LearnRift API, so it needs a LearnRift app session. If no saved CLI session exists, the command opens your browser automatically:

```bash
npm run course:import -- ./path/to/course --api https://learnrift.site/api
```

Sign in with Google in the browser. LearnRift sends the session back to the importer through a temporary localhost callback, then the CLI stores it at `~/.learnrift/credentials.json` for later runs. Future imports reuse the cached session and refresh it automatically when possible.

You can login or refresh the saved CLI session without importing:

```bash
unset LEARNRIFT_ACCESS_TOKEN ACCESS_TOKEN
npm run course:login -- --api https://learnrift.site/api
```

If you previously exported a copied token in the same terminal, remove it before retrying:

```bash
unset LEARNRIFT_ACCESS_TOKEN ACCESS_TOKEN
npm run course:login -- --api https://learnrift.site/api
```

Useful auth options:

- `--login` opens the browser even when a cached token exists.
- `--site <url>` sets the LearnRift web URL if it cannot be derived from `--api`.
- `--token-file <path>` stores the CLI session somewhere other than `~/.learnrift/credentials.json`.
- `--no-browser-login` disables the browser flow for scripts or CI.

For automation, you can still pass `--token <access-token>` or set `LEARNRIFT_ACCESS_TOKEN`.

## Folder Shape

Top-level folders become modules. Folders inside modules become curriculum folders, and they can be nested as deeply as you want. Files inside any folder become lessons when the file type is supported.

If any folder contains direct HTML/CSS/JS files, the importer treats that whole folder as a single static website lesson instead of recursing into it.

```text
my-course/
  course.json
  01 Introduction/
    01 Welcome.md
    02 Setup.pdf
  02 Arrays/
    01 Two Pointers/
      01 Pattern Overview.md
      02 Problems/
        01 Majority Element/
          index.html
          style.css
          script.js
```

Static lessons may use any direct `.html`/`.htm` file, preferring `index.html` or `index.htm`. If there is no HTML file, `index.js` can be used as the HTML/body source for the older LearnRift static-lesson format. CSS is read from `style.css`, `styles.css`, or the first `.css` file found within four folder levels. JavaScript is read from `script.js`, `main.js`, `app.js`, `index.js`, or the first `.js`/`.mjs` file found within four folder levels. The search skips `node_modules`, `.git`, `.next`, `dist`, `build`, and `coverage`.

Supported lesson files:

- `.md`, `.markdown`, `.txt` -> markdown lesson
- `.pdf` -> PDF lesson, uploaded through the signed-upload API
- `.quiz.json` -> real quiz lesson (a LearnRift `quiz` node — see "Quiz lessons" below)
- nested folder -> curriculum folder
- static site folder -> static website lesson

Unsupported files are skipped with warnings so repo folders containing files like `package.json` or images do not break the import. Static website lessons currently store the HTML/CSS/JS payload only; binary assets are not bundled into the static lesson.

## Quiz lessons

A `*.quiz.json` file is imported as a **real LearnRift quiz node** (`type: "quiz"`), not as markdown and not as a static website. Use the naming convention:

```text
01 Quiz — Topic Name.quiz.json
```

The number prefix orders it like any other lesson; the title comes from the JSON `title` field if present, otherwise from the file name (with the `.quiz.json` suffix stripped).

Two JSON shapes are accepted.

**1. Full wrapper** (recommended — lets you set the timer, passing score, and title):

```json
{
  "title": "Quiz: Regression",
  "timerSeconds": 600,
  "passingPercent": 70,
  "questions": [
    {
      "id": "regression-q01",
      "prompt": "Question text",
      "options": ["A", "B", "C", "D"],
      "correctIndex": 1,
      "explanation": "Why this answer is correct."
    }
  ]
}
```

**2. Bare question array:**

```json
[
  {
    "id": "regression-q01",
    "prompt": "Question text",
    "options": ["A", "B", "C", "D"],
    "correctIndex": 1,
    "explanation": "Why this answer is correct."
  }
]
```

Validation (the importer fails the import with a clear message if any rule is broken, so problems get fixed rather than silently skipped):

- At least **5 questions** per quiz.
- Every question needs a non-empty `id`, a `prompt`, `options`, and a `correctIndex`. Ids must be unique within the quiz (e.g. `regression-q01`, `regression-q02`).
- `options` must be **exactly 4** non-empty strings — the backend `quiz_payload` schema requires length 4.
- `correctIndex` must be an integer `0`, `1`, `2`, or `3`.
- `explanation` is optional but strongly recommended; a question without one imports fine but emits a warning.
- `timerSeconds` and `passingPercent` are optional integers (used only in the wrapper shape).

The dry-run plan counts quizzes separately, e.g. `… lessons (40 markdown, 4 pdf, 21 static sites, 14 quizzes)`.

## Optional Metadata

`course.json`:

```json
{
  "title": "DSA for Placements",
  "subtitle": "Visual, interactive, and C++ based",
  "description": "Course description",
  "language": "English",
  "level": "All Levels",
  "tags": ["DSA", "C++"],
  "price": 0,
  "certificate_enabled": true,
  "certificate_min_progress": 100,
  "certificate_require_quiz_pass": false
}
```

`module.json` inside a module folder:

```json
{ "title": "Introduction and Roadmap" }
```

`folder.json` inside a curriculum folder:

```json
{ "title": "Two Pointers" }
```

`site.json` inside a static website lesson folder:

```json
{ "title": "Minimum Arrows to Burst Balloons" }
```

## Atomicity

The importer creates the course as a draft, then imports modules and nodes. If `--publish` is provided, it publishes the course after every module and node is imported. If any API call fails, it deletes the draft course it just created by default.

Use `--keep-partial` only when you want to inspect a failed partial import.

PDF uploads are streamed to Supabase Storage before the PDF node is saved, so a failed import after a PDF upload can still leave an uploaded object behind. Markdown, folder, and static website lesson rows are rolled back by deleting the draft course.
