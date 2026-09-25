"use client"

import { fillEmptyFaqAnswers, type PackageFaq, type PackageFaqSource } from "@/lib/catalog/package-faqs"

export function PackageFaqFields({
  faqs,
  source,
  onChange,
}: {
  faqs: PackageFaq[]
  source: PackageFaqSource
  onChange: (faqs: PackageFaq[]) => void
}) {
  function update(id: string, patch: Partial<Pick<PackageFaq, "question" | "answer">>) {
    onChange(faqs.map((faq) => (faq.id === id ? { ...faq, ...patch } : faq)))
  }

  function addQuestion() {
    onChange([...faqs, { id: `custom-${Date.now()}`, question: "", answer: "" }])
  }

  function remove(id: string) {
    onChange(faqs.filter((faq) => faq.id !== id))
  }

  return (
    <div className="sm:col-span-2 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Questions a new agent would ask about this product and the race. Answers are filled from the description,
            inclusions, dates, and location when we already have them. Leave the rest blank until you know the answer.
            Answered questions show on the agent product page.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(fillEmptyFaqAnswers(faqs, source))}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted"
        >
          Fill empty answers
        </button>
      </div>
      <div className="space-y-3">
        {faqs.map((faq) => (
          <div key={faq.id} className="space-y-1.5 rounded-lg border border-border bg-background p-3">
            <div className="flex items-start gap-2">
              <input
                value={faq.question}
                onChange={(e) => update(faq.id, { question: e.target.value })}
                placeholder="Question"
                className="min-w-0 flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
              {faq.id.startsWith("custom-") ? (
                <button
                  type="button"
                  onClick={() => remove(faq.id)}
                  className="px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <textarea
              value={faq.answer}
              onChange={(e) => update(faq.id, { answer: e.target.value })}
              placeholder="No answer yet. Add one when you have it."
              className="w-full min-h-[72px] px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addQuestion}
        className="px-3 py-1.5 rounded-lg border border-border bg-background text-sm font-medium hover:bg-muted"
      >
        Add a question
      </button>
    </div>
  )
}
