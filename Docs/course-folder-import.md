# Course Folder Import

Use the importer when you have many lessons and do not want to add each one manually in the creator UI.

```bash
npm run course:import -- ./path/to/course --api https://learnrift.site/api --token "$LEARNRIFT_ACCESS_TOKEN"
```

Add `--dry-run` first to validate the folder without creating anything.

## Authorization

The importer calls the normal LearnRift API, so it needs your logged-in access token.

For Google sign-in:

1. Sign in to LearnRift in Chrome.
2. Open DevTools on `learnrift.site`.
3. Go to Application -> Local Storage -> `https://learnrift.site`.
4. Copy the value of `access_token`.
5. Run:

```bash
export LEARNRIFT_ACCESS_TOKEN='paste-token-here'
npm run course:import -- ./path/to/course --api https://learnrift.site/api
```

You can also get it from the console:

```js
localStorage.getItem("access_token")
```

The token is short lived. If the import says unauthorized, refresh LearnRift, copy a fresh token, and rerun.

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
- nested folder -> curriculum folder
- static site folder -> static website lesson

Unsupported files are skipped with warnings so repo folders containing files like `package.json` or images do not break the import. Static website lessons currently store the HTML/CSS/JS payload only; binary assets are not bundled into the static lesson.

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

The importer creates the course as a draft, then imports modules and nodes. If any API call fails, it deletes the draft course it just created by default.

Use `--keep-partial` only when you want to inspect a failed partial import.

PDF uploads are streamed to Supabase Storage before the PDF node is saved, so a failed import after a PDF upload can still leave an uploaded object behind. Markdown, folder, and static website lesson rows are rolled back by deleting the draft course.
