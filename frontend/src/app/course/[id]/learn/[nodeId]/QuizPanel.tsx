"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, CheckCircle2, ChevronLeft, History, Loader2, Maximize2,
  RotateCcw, Timer, Trophy, X, XCircle,
} from "lucide-react";
import { api, type CourseNode, type QuizAttempt, type QuizAnswerKey } from "@/lib/api";
import { cn, relativeTime } from "@/lib/utils";
import { SafeHtml } from "@/components/common/SafeHtml";

type Quiz = NonNullable<CourseNode["quiz_payload"]>;
type KeyMap = Map<string, { correctIndex: number; explanation?: string }>;

/**
 * Quiz lesson. Taking a quiz runs in a focused FULL-SCREEN runner that shows
 * ONE question at a time — you pick an answer, then advance; you cannot see the
 * other questions or go back (this is what stops the "read everything at once"
 * cheating). Answers are scored on the server; the result screen then reveals
 * the full review with correct answers + explanations. Past attempts stay
 * read-only.
 */
export function QuizPanel({
  nodeId, quiz, onResult,
}: {
  nodeId: string;
  quiz: Quiz;
  onResult: (r: { passed: boolean; courseProgressPercent?: number; courseCompleted?: boolean; courseJustCompleted?: boolean }) => void;
}) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "active" | "results">("idle");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [reviewAttempt, setReviewAttempt] = useState<QuizAttempt | null>(null);
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setMounted(true), []);

  const { data: attemptsData } = useQuery({
    queryKey: ["quiz-attempts", nodeId],
    queryFn: () => api.enrollments.quizAttempts(nodeId),
  });
  const attempts = attemptsData?.attempts;

  const submit = useMutation({
    mutationFn: () => api.enrollments.submitQuiz(nodeId, Object.entries(picked).map(([questionId, pickedIndex]) => ({ questionId, pickedIndex }))),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["quiz-attempts", nodeId] });
      setPhase("results");
      onResult(r);
    },
  });

  // Correct answers come from the server (after submitting, or attempts history)
  // — never embedded in the course payload (so they can't be read mid-quiz).
  const answerKey: QuizAnswerKey = submit.data?.answerKey ?? attemptsData?.answerKey ?? [];
  const keyByQ: KeyMap = useMemo(() => {
    const m: KeyMap = new Map();
    for (const k of answerKey) m.set(k.questionId, { correctIndex: k.correctIndex, explanation: k.explanation });
    return m;
  }, [answerKey]);

  const passingPercent = quiz.passingPercent || 60;
  const total = quiz.questions.length;
  const timed = !!quiz.timerSeconds && quiz.timerSeconds > 0;
  const answeredCount = Object.keys(picked).length;

  // ── Full-screen + body scroll lock while the runner/results are open ──
  useEffect(() => {
    if (phase === "idle") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [phase]);

  // Best-effort native fullscreen when the runner opens (overlay covers the
  // viewport regardless, so this is a progressive enhancement).
  useEffect(() => {
    if (phase !== "active") return;
    const el = overlayRef.current;
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => {});
    return () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, [phase]);

  // ── Countdown timer (only when the quiz declares one) ──
  useEffect(() => {
    if (phase !== "active" || !timed || remaining <= 0) return;
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, timed, remaining]);
  // Time's up → auto-submit whatever is answered (unanswered count as wrong).
  useEffect(() => {
    if (phase === "active" && timed && remaining === 0 && !submit.isPending && !submit.data) submit.mutate();
  }, [phase, timed, remaining]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = () => {
    setPicked({});
    setCurrent(0);
    setRemaining(quiz.timerSeconds || 0);
    submit.reset();
    setPhase("active");
  };
  const exitRunner = (confirmFirst: boolean) => {
    if (confirmFirst && !submit.data && !window.confirm("Leave the quiz? Your progress on this attempt will be lost.")) return;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setPhase("idle");
  };
  const goNext = () => {
    if (current < total - 1) setCurrent((c) => c + 1);
    else submit.mutate();
  };

  if (reviewAttempt) {
    return <ReviewPanel quiz={quiz} attempt={reviewAttempt} keyByQ={keyByQ} passingPercent={passingPercent} onBack={() => setReviewAttempt(null)} />;
  }

  const lastAttempt = attempts?.[0];
  const lastPct = lastAttempt && lastAttempt.max_score > 0 ? Math.round((lastAttempt.score / lastAttempt.max_score) * 100) : null;
  const everPassed = attempts?.some((a) => a.passed ?? (a.max_score > 0 && (a.score / a.max_score) * 100 >= passingPercent));

  // ── Intro / launch card (shown inline in the lesson) ──
  const intro = (
    <div className="mt-4 card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold">Quick Check Quiz</h3>
          <p className="mt-1 text-xs text-fg-dim">
            {total} questions · {timed ? `${Math.max(1, Math.round((quiz.timerSeconds || 0) / 60))} min` : "no time limit"} · pass at {passingPercent}%
          </p>
        </div>
        {everPassed && <span className="chip border-success/30 text-success"><CheckCircle2 className="h-3 w-3" /> Passed</span>}
      </div>

      <ul className="mt-4 space-y-1.5 text-sm text-fg-dim">
        <li className="flex items-center gap-2"><Maximize2 className="h-3.5 w-3.5 text-brand" /> Opens full screen, one question at a time.</li>
        <li className="flex items-center gap-2"><ArrowRight className="h-3.5 w-3.5 text-brand" /> Pick an answer, then move on — you can&apos;t go back.</li>
        {timed && <li className="flex items-center gap-2"><Timer className="h-3.5 w-3.5 text-brand" /> A {Math.max(1, Math.round((quiz.timerSeconds || 0) / 60))}-minute timer auto-submits when it ends.</li>}
        <li className="flex items-center gap-2"><Trophy className="h-3.5 w-3.5 text-brand" /> Full answers + explanations are revealed after you submit.</li>
      </ul>

      <button onClick={start} className="btn-primary mt-5">{everPassed ? "Retake quiz" : "Start quiz"}</button>

      {(attempts?.length ?? 0) > 0 && (
        <div className="mt-8 border-t border-border pt-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-fg-dim" /> Previous attempts</h4>
          <div className="mt-3 space-y-2">
            {attempts!.map((a, i) => {
              const pct = a.max_score > 0 ? Math.round((a.score / a.max_score) * 100) : 0;
              const passed = a.passed ?? pct >= passingPercent;
              return (
                <button key={a.id} onClick={() => setReviewAttempt(a)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-left text-sm transition hover:border-brand">
                  <span className="text-fg-dim">Attempt {attempts!.length - i} · {relativeTime(a.attempted_at)}</span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums font-medium">{a.score}/{a.max_score} ({pct}%)</span>
                    {passed
                      ? <span className="chip border-success/30 text-success"><CheckCircle2 className="h-3 w-3" /> Passed</span>
                      : <span className="chip border-danger/30 text-danger"><XCircle className="h-3 w-3" /> Failed</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {lastPct !== null && !everPassed && <p className="mt-3 text-xs text-fg-dim">Best so far: {lastPct}% — you need {passingPercent}% to pass.</p>}
    </div>
  );

  if (phase === "idle" || !mounted) return intro;

  // ── Full-screen runner / results (portaled to body so it escapes layout) ──
  const q = quiz.questions[current];
  const overlay = (
    <div ref={overlayRef} className="fixed inset-0 z-[80] flex flex-col bg-surface">
      {phase === "active" ? (
        <ActiveRunner
          quiz={quiz} current={current} total={total} picked={picked} timed={timed} remaining={remaining}
          submitting={submit.isPending} answeredCount={answeredCount} error={submit.isError ? (submit.error instanceof Error ? submit.error.message : "Could not submit") : null}
          onPick={(i) => setPicked((p) => ({ ...p, [q.id]: i }))}
          onNext={goNext}
          onExit={() => exitRunner(true)}
        />
      ) : (
        <ResultsScreen
          quiz={quiz} keyByQ={keyByQ}
          score={submit.data?.score ?? 0} max={submit.data?.max ?? total} passed={!!submit.data?.passed}
          passingPercent={passingPercent} picked={picked}
          onRetake={start} onClose={() => exitRunner(false)}
        />
      )}
    </div>
  );
  return <>{intro}{createPortal(overlay, document.body)}</>;
}

// ─────────────────────────── Active runner (one question) ───────────────────────────
function ActiveRunner({
  quiz, current, total, picked, timed, remaining, submitting, answeredCount, error, onPick, onNext, onExit,
}: {
  quiz: Quiz; current: number; total: number; picked: Record<string, number>;
  timed: boolean; remaining: number; submitting: boolean; answeredCount: number; error: string | null;
  onPick: (i: number) => void; onNext: () => void; onExit: () => void;
}) {
  const q = quiz.questions[current];
  const chosen = picked[q.id];
  const isLast = current === total - 1;
  const pct = Math.round(((current + (chosen != null ? 1 : 0)) / total) * 100);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const lowTime = timed && remaining <= 30;

  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Quick Check Quiz</p>
          <p className="text-xs text-fg-dim">Question {current + 1} of {total} · {answeredCount} answered</p>
        </div>
        <div className="flex items-center gap-3">
          {timed && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-sm tabular-nums",
              lowTime ? "border-danger/40 text-danger" : "border-border text-fg-dim")}>
              <Timer className="h-3.5 w-3.5" /> {mm}:{ss}
            </span>
          )}
          <button onClick={onExit} aria-label="Exit quiz" className="rounded-lg border border-border p-1.5 text-fg-dim transition hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <div className="h-1 w-full bg-surface-2">
        <div className="h-full bg-brand-gradient transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
          <div className="font-display text-xl font-semibold leading-snug"><SafeHtml html={q.prompt} /></div>
          <div className="mt-6 space-y-2.5">
            {q.options.map((opt, i) => {
              const selected = chosen === i;
              return (
                <button key={i} type="button" onClick={() => onPick(i)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition",
                    selected ? "border-brand bg-surface-2 ring-1 ring-brand" : "border-border bg-surface hover:border-brand/50 hover:bg-surface-2",
                  )}>
                  <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-xs",
                    selected ? "border-brand bg-brand-gradient text-white" : "border-border text-fg-dim")}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <SafeHtml html={opt} className="flex-1" />
                </button>
              );
            })}
          </div>
          {error && <p className="mt-4 text-xs text-danger">{error}</p>}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-1.5">
          {quiz.questions.map((qq, i) => (
            <span key={qq.id} className={cn("h-1.5 rounded-full transition-all",
              i === current ? "w-5 bg-brand" : picked[qq.id] != null ? "w-1.5 bg-brand/60" : "w-1.5 bg-surface-2")} />
          ))}
        </div>
        <button onClick={onNext} disabled={chosen == null || submitting} className="btn-primary disabled:opacity-40">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isLast ? "Finish & submit" : <>Next <ArrowRight className="h-4 w-4" /></>}
        </button>
      </footer>
    </>
  );
}

// ─────────────────────────── Results screen ───────────────────────────
function ResultsScreen({
  quiz, keyByQ, score, max, passed, passingPercent, picked, onRetake, onClose,
}: {
  quiz: Quiz; keyByQ: KeyMap; score: number; max: number; passed: boolean;
  passingPercent: number; picked: Record<string, number>; onRetake: () => void; onClose: () => void;
}) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <>
      <header className="flex items-center justify-end border-b border-border px-4 py-3 sm:px-6">
        <button onClick={onClose} aria-label="Close" className="rounded-lg border border-border p-1.5 text-fg-dim transition hover:text-fg"><X className="h-4 w-4" /></button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-10">
          <div className="flex flex-col items-center text-center">
            <span className={cn("flex h-16 w-16 items-center justify-center rounded-full", passed ? "bg-success/15 text-success" : "bg-danger/15 text-danger")}>
              {passed ? <Trophy className="h-8 w-8" /> : <XCircle className="h-8 w-8" />}
            </span>
            <h3 className="mt-4 font-display text-2xl font-semibold">{passed ? "Passed!" : "Not quite yet"}</h3>
            <p className="mt-1 text-sm text-fg-dim">You scored <span className="font-semibold text-fg">{score}/{max}</span> ({pct}%) · needed {passingPercent}% to pass.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={onRetake} className="btn-ghost text-sm"><RotateCcw className="h-4 w-4" /> Retake</button>
              <button onClick={onClose} className="btn-primary text-sm">{passed ? "Continue" : "Back to lesson"}</button>
            </div>
          </div>

          <h4 className="mt-10 mb-3 text-sm font-semibold text-fg-dim">Review — correct answers &amp; explanations</h4>
          <QuestionReview quiz={quiz} keyByQ={keyByQ} pickedByQuestion={new Map(Object.entries(picked))} />
        </div>
      </div>
    </>
  );
}

// Shared read-only per-question review (results screen + past-attempt review).
function QuestionReview({ quiz, keyByQ, pickedByQuestion }: { quiz: Quiz; keyByQ: KeyMap; pickedByQuestion: Map<string, number> }) {
  return (
    <div className="space-y-5">
      {quiz.questions.map((q, qi) => {
        const pickedIndex = pickedByQuestion.get(q.id);
        const correctIndex = keyByQ.get(q.id)?.correctIndex ?? q.correctIndex;
        const explanation = keyByQ.get(q.id)?.explanation ?? q.explanation;
        return (
          <div key={q.id}>
            <div className="flex gap-1.5 font-medium"><span>{qi + 1}.</span><SafeHtml html={q.prompt} className="flex-1" /></div>
            <div className="mt-2 space-y-1.5">
              {q.options.map((opt, i) => {
                const isCorrect = i === correctIndex;
                const isPicked = i === pickedIndex;
                return (
                  <div key={i}
                    className={cn("flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-sm",
                      isCorrect ? "border-success bg-success/10" : isPicked ? "border-danger bg-danger/10" : "border-border bg-surface")}>
                    <span className="flex flex-1 items-start gap-2"><span className="mt-0.5 font-mono text-xs">{String.fromCharCode(65 + i)}.</span><SafeHtml html={opt} className="flex-1" /></span>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      {isPicked && <span className="text-fg-dim">Your answer</span>}
                      {isCorrect && <span className="text-success">Correct</span>}
                    </span>
                  </div>
                );
              })}
            </div>
            {explanation && <div className="mt-2 text-xs text-fg-dim"><SafeHtml html={explanation} /></div>}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────── Past-attempt review (read-only) ───────────────────────────
function ReviewPanel({ quiz, attempt, keyByQ, passingPercent, onBack }: { quiz: Quiz; attempt: QuizAttempt; keyByQ: KeyMap; passingPercent: number; onBack: () => void }) {
  const pickedByQuestion = new Map(attempt.answers.map((a) => [a.questionId, a.pickedIndex]));
  const pct = attempt.max_score > 0 ? Math.round((attempt.score / attempt.max_score) * 100) : 0;
  const passed = attempt.passed ?? pct >= passingPercent;

  return (
    <div className="mt-4 card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <button onClick={onBack} className="inline-flex items-center gap-1 text-xs text-brand"><ChevronLeft className="h-3.5 w-3.5" /> Back to quiz</button>
          <h3 className="mt-1 font-display text-lg font-semibold">Attempt review</h3>
          <p className="text-xs text-fg-dim">{new Date(attempt.attempted_at).toLocaleString()} · read-only — past attempts cannot be changed</p>
        </div>
        <span className={`chip border ${passed ? "border-success/30 text-success" : "border-danger/30 text-danger"}`}>
          {passed ? "Passed" : "Failed"} · {attempt.score}/{attempt.max_score} ({pct}%)
        </span>
      </div>
      <QuestionReview quiz={quiz} keyByQ={keyByQ} pickedByQuestion={pickedByQuestion} />
    </div>
  );
}
