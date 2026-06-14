import Link from "next/link";
import {
  BookOpen, Layers, FileText, Video, ListChecks, FileType2, Code2,
  IndianRupee, HardDrive, ShieldCheck, Sparkles, ArrowRight, CheckCircle2, Lightbulb,
} from "lucide-react";
import { Navbar } from "@/components/common/Navbar";
import { Footer } from "@/components/common/Footer";
import { CommissionPct, CreatorSharePct } from "@/components/common/PlatformRates";

export const metadata = { title: "Creator Guide · LearnRift" };

const LESSON_TYPES = [
  { icon: <Video className="h-5 w-5 text-brand" />, name: "Video", desc: "Hosted on our CDN — doesn't count against your storage quota. Best for walkthroughs and demos." },
  { icon: <FileText className="h-5 w-5 text-brand" />, name: "Markdown article", desc: "Rich written lessons with headings, code blocks, and images. Great for theory and references." },
  { icon: <ListChecks className="h-5 w-5 text-brand" />, name: "Quiz", desc: "Check understanding with multiple-choice questions. Learners get instant feedback." },
  { icon: <FileType2 className="h-5 w-5 text-brand" />, name: "PDF", desc: "Attach slides or worksheets. PDFs use your storage quota." },
  { icon: <Code2 className="h-5 w-5 text-brand" />, name: "Live HTML/CSS/JS sandbox", desc: "An interactive, editable web playground rendered live in the lesson — ideal for hands-on coding." },
];

const STEPS = [
  { n: 1, title: "Create the course shell", desc: "From Courses → New course, set a title (min 3 characters), a short subtitle, a thumbnail, and a price. These are what learners see in the catalog." },
  { n: 2, title: "Add modules", desc: "Modules group related lessons (e.g. \"Getting started\", \"Advanced\"). Add as many as you need — they appear in the order you arrange them." },
  { n: 3, title: "Add lessons inside each module", desc: "A lesson can be a video, markdown article, quiz, PDF, or a live HTML/CSS/JS sandbox. Mix types to keep things engaging." },
  { n: 4, title: "Arrange the order", desc: "Drag modules and lessons into the order you want, then Save — the sequence learners follow is the order shown in the builder." },
  { n: 5, title: "Publish", desc: "Hit Publish when it's ready. First publish announces the course to your followers; editing and re-publishing later notifies your enrolled learners that the course was updated." },
];

const CHECKLIST = [
  "Title is at least 3 characters and clearly describes the outcome",
  "At least one module and one lesson exist (required to publish)",
  "A thumbnail and subtitle are set so the catalog listing looks complete",
  "Price (and any discounted price) is correct — a discounted price must be lower than the full price",
  "Lessons are in a sensible order and each one plays/loads",
];

const TIPS = [
  "Lead with outcomes: tell learners exactly what they'll be able to do by the end.",
  "Keep lessons short and focused — one idea per lesson is easier to finish.",
  "Use a quiz at the end of a module to reinforce what was just taught.",
  "Re-publishing an edited course notifies enrolled learners, so batch your edits before republishing to avoid pinging them repeatedly.",
  "Respond to doubts quickly — engaged creators get better ratings and more enrolments.",
];

export default function CreatorGuidePage() {
  return (
    <>
      <Navbar variant="creator" />
      <main className="mx-auto max-w-5xl px-4 py-10 md:px-6">
        {/* Hero */}
        <section className="rounded-3xl border border-brand/40 bg-brand/10 p-8 shadow-glow">
          <div className="flex items-center gap-2 text-brand">
            <Sparkles className="h-5 w-5" />
            <span className="text-xs font-semibold uppercase tracking-widest">Creator Guide</span>
          </div>
          <h1 className="heading-1 mt-3">How to create a great course</h1>
          <p className="mt-3 max-w-2xl text-fg-dim">
            Everything you need to go from an empty studio to a published course — how courses are
            structured, the lesson types you can use, what to check before publishing, and the
            important points that keep your learners (and your earnings) happy.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/creator/courses/new" className="btn-primary px-5 py-2 text-sm">
              Create a course <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/creator/courses" className="btn-ghost px-5 py-2 text-sm">View my courses</Link>
          </div>
        </section>

        {/* Anatomy */}
        <section className="mt-10">
          <h2 className="heading-2 flex items-center gap-2"><Layers className="h-5 w-5 text-brand" /> How a course is structured</h2>
          <p className="mt-2 text-fg-dim">A course is a simple three-level hierarchy:</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <AnatomyCard icon={<BookOpen className="h-5 w-5 text-brand" />} title="Course" desc="The top level — has a title, subtitle, thumbnail, and price. This is the catalog listing." />
            <AnatomyCard icon={<Layers className="h-5 w-5 text-brand" />} title="Modules" desc="Sections that group related lessons together, shown in the order you arrange them." />
            <AnatomyCard icon={<FileText className="h-5 w-5 text-brand" />} title="Lessons" desc="The actual content learners work through, one lesson at a time." />
          </div>
          <p className="mt-3 text-sm text-fg-dim">
            <strong className="text-fg">Course → Modules → Lessons.</strong> Build it in the course builder, where the left pane is your course tree and the right pane edits the selected item.
          </p>
        </section>

        {/* Lesson types */}
        <section className="mt-10">
          <h2 className="heading-2">Lesson types</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {LESSON_TYPES.map((t) => (
              <div key={t.name} className="card flex gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2">{t.icon}</span>
                <div>
                  <p className="font-display font-semibold">{t.name}</p>
                  <p className="mt-0.5 text-sm text-fg-dim">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Step-by-step */}
        <section className="mt-10">
          <h2 className="heading-2">Build it step by step</h2>
          <ol className="mt-4 space-y-3">
            {STEPS.map((s) => (
              <li key={s.n} className="card flex gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-sm font-bold text-white">{s.n}</span>
                <div>
                  <p className="font-display font-semibold">{s.title}</p>
                  <p className="mt-0.5 text-sm text-fg-dim">{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Publish checklist */}
        <section className="mt-10">
          <h2 className="heading-2 flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-success" /> Before you publish</h2>
          <div className="card mt-4">
            <ul className="space-y-2.5">
              {CHECKLIST.map((c) => (
                <li key={c} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Money + storage */}
        <section className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="card">
            <h3 className="heading-3 flex items-center gap-2"><IndianRupee className="h-5 w-5 text-brand" /> Pricing, payouts &amp; refunds</h3>
            <ul className="mt-3 space-y-2 text-sm text-fg-dim">
              <li>You keep <strong className="text-fg"><CreatorSharePct />%</strong> of every sale; the platform commission is <CommissionPct />%.</li>
              <li>A discounted price, if set, must be lower than the full price.</li>
              <li>Earnings land in your wallet — withdraw to your bank after completing KYC.</li>
              <li>Refunds have a 7-day window and are automatically deducted from your balance.</li>
            </ul>
          </div>
          <div className="card">
            <h3 className="heading-3 flex items-center gap-2"><HardDrive className="h-5 w-5 text-brand" /> Storage</h3>
            <ul className="mt-3 space-y-2 text-sm text-fg-dim">
              <li>PDFs, static sites, rich images, and lesson attachments use your storage quota (you start with a small free allotment and can buy more anytime).</li>
              <li>Video lessons live on our CDN separately, so they <strong className="text-fg">don&apos;t</strong> count against storage.</li>
              <li>Check your usage on the Storage page in the creator nav.</li>
            </ul>
          </div>
        </section>

        {/* Important points */}
        <section className="mt-10">
          <h2 className="heading-2 flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-400" /> Important points &amp; best practices</h2>
          <div className="card mt-4">
            <ul className="space-y-2.5">
              {TIPS.map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-sm">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Closing */}
        <section className="mt-10 flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface-2 p-8 text-center">
          <ShieldCheck className="h-6 w-6 text-brand" />
          <p className="text-fg-dim">Ready to build? Start your first course and come back here anytime.</p>
          <Link href="/creator/courses/new" className="btn-primary px-5 py-2 text-sm">Create a course <ArrowRight className="h-4 w-4" /></Link>
          <p className="text-xs text-fg-dim">Stuck? Email <a href="mailto:support@learnrift.site" className="underline">support@learnrift.site</a>.</p>
        </section>
      </main>
      <Footer />
    </>
  );
}

function AnatomyCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">{icon}</span>
      <p className="mt-3 font-display font-semibold">{title}</p>
      <p className="mt-1 text-sm text-fg-dim">{desc}</p>
    </div>
  );
}
