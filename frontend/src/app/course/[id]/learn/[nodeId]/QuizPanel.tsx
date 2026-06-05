"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, History, Loader2, XCircle } from "lucide-react";
import { api, type CourseNode, type QuizAttempt, type QuizAnswerKey } from "@/lib/api";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/utils";
import { SafeHtml } from "@/components/common/SafeHtml";

type Quiz = NonNullable<CourseNode["quiz_payload"]>;

/**
 * Quiz lesson: take the quiz (completion only on a passing score) + review
 * mode for past attempts — read-only, shows picked vs correct answers and
 * explanations. Past attempts can never be edited.
 */
export function QuizPanel({
  nodeId, quiz, onResult,
}: {
  nodeId: string;
  quiz: Quiz;
  onResult: (r: { passed: boolean; courseProgressPercent?: number; courseCompleted?: boolean; courseJustCompleted?: boolean }) => void;
}) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [reviewAttempt, setReviewAttempt] = useState<QuizAttempt | null>(null);

  const { data: attemptsData } = useQuery({
    queryKey: ["quiz-attempts", nodeId],
    queryFn: () => api.enrollments.quizAttempts(nodeId),
  });
  const attempts = attemptsData?.attempts;

  const submit = useMutation({
    mutationFn: () => api.enrollments.submitQuiz(nodeId, Object.entries(picked).map(([questionId, pickedIndex]) => ({ questionId, pickedIndex }))),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["quiz-attempts", nodeId] });
      onResult(r);
    },
  });

  // Correct answers come from the server (after submitting, or the attempts
  // history) — they are no longer embedded in the course payload. Fall back to
  // any embedded value, which is only present when the creator/admin previews
  // their own course.
  const answerKey: QuizAnswerKey = submit.data?.answerKey ?? attemptsData?.answerKey ?? [];
  const keyByQ = useMemo(() => {
    const m = new Map<string, { correctIndex: number; explanation?: string }>();
    for (const k of answerKey) m.set(k.questionId, { correctIndex: k.correctIndex, explanation: k.explanation });
    return m;
  }, [answerKey]);

  const passingPercent = quiz.passingPercent || 60;

  if (reviewAttempt) {
    return (
      <ReviewPanel
        quiz={quiz}
        attempt={reviewAttempt}
        keyByQ={keyByQ}
        passingPercent={passingPercent}
        onBack={() => setReviewAttempt(null)}
      />
    );
  }

  return (
    <div className="mt-4 card">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold">Quick Check Quiz</h3>
          <p className="text-xs text-fg-dim">
            {quiz.questions.length} questions · {Math.floor((quiz.timerSeconds || 300) / 60)} min · pass at {passingPercent}%
          </p>
        </div>
        {submit.data && (
          <span className={`chip border ${submit.data.passed ? "border-success/30 text-success" : "border-danger/30 text-danger"}`}>
            {submit.data.passed ? "Passed" : "Failed"}: {submit.data.score}/{submit.data.max}
          </span>
        )}
      </div>

      <div className="space-y-5">
        {quiz.questions.map((q, qi) => {
          const submitted = !!submit.data;
          const isPicked = picked[q.id];
          // Prefer the server-provided key; the embedded value only exists when an
          // owner previews their own course.
          const correctIndex = keyByQ.get(q.id)?.correctIndex ?? q.correctIndex;
          const explanation = keyByQ.get(q.id)?.explanation ?? q.explanation;
          return (
            <div key={q.id}>
              <div className="flex gap-1.5 font-medium"><span>{qi + 1}.</span><SafeHtml html={q.prompt} className="flex-1" /></div>
              <div className="mt-2 space-y-1.5">
                {q.options.map((opt, i) => (
                  <div key={i} role="button" tabIndex={submitted ? -1 : 0}
                    onClick={() => { if (!submitted) setPicked((p) => ({ ...p, [q.id]: i })); }}
                    onKeyDown={(e) => { if (!submitted && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPicked((p) => ({ ...p, [q.id]: i })); } }}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm transition",
                      submitted ? "cursor-default" : "cursor-pointer",
                      submitted && i === correctIndex ? "border-success bg-success/10" :
                      submitted && i === isPicked ? "border-danger bg-danger/10" :
                      isPicked === i ? "border-brand bg-surface-2" : "border-border bg-surface hover:bg-surface-2",
                    )}>
                    <span className="mt-0.5 font-mono text-xs">{String.fromCharCode(65 + i)}.</span>
                    <SafeHtml html={opt} className="flex-1" />
                  </div>
                ))}
              </div>
              {submitted && explanation && <div className="mt-2 text-xs text-fg-dim"><SafeHtml html={explanation} /></div>}
            </div>
          );
        })}
      </div>

      {submit.isError && (
        <p className="mt-4 text-xs text-danger">{submit.error instanceof Error ? submit.error.message : "Could not submit the quiz"}</p>
      )}
      {!submit.data ? (
        <button onClick={() => submit.mutate()} disabled={Object.keys(picked).length !== quiz.questions.length || submit.isPending}
          className="btn-primary mt-6 disabled:opacity-40">
          {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}
        </button>
      ) : !submit.data.passed ? (
        <button onClick={() => { setPicked({}); submit.reset(); }} className="btn-ghost mt-6 text-sm">
          Retake quiz
        </button>
      ) : null}

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
    </div>
  );
}

function ReviewPanel({ quiz, attempt, keyByQ, passingPercent, onBack }: { quiz: Quiz; attempt: QuizAttempt; keyByQ: Map<string, { correctIndex: number; explanation?: string }>; passingPercent: number; onBack: () => void }) {
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
                      className={cn(
                        "flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-sm",
                        isCorrect ? "border-success bg-success/10" : isPicked ? "border-danger bg-danger/10" : "border-border bg-surface",
                      )}>
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
    </div>
  );
}
