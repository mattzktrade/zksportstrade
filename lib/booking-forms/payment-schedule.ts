export const DEFAULT_PAYMENT_DUE_DAYS = 7
export const MAX_PAYMENT_INSTALLMENTS = 6
export const MAX_PAYMENT_DUE_DAYS = 730
export const MAX_PAYMENT_SCHEDULE_NOTES = 2000

export type BookingFormPaymentDueKind = "days_after_signing" | "on_date"

export type BookingFormPaymentInstallment = {
  percent: number
  dueKind: BookingFormPaymentDueKind
  /** Used when dueKind is days_after_signing. 0 = due upon signing. */
  dueDaysAfterSigning: number
  /** YYYY-MM-DD when dueKind is on_date. */
  dueOn: string
  label: string
}

export type BookingFormPaymentSchedule = {
  installments: BookingFormPaymentInstallment[]
  notes: string
}

export type ResolvedPaymentInstallment = {
  index: number
  count: number
  percent: number
  amount: number
  dueDate: string
  label: string
  dueKind: BookingFormPaymentDueKind
  dueDaysAfterSigning: number
  dueOn: string
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function roundPercent(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function addUtcDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number)
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function todayUtcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function emptyPaymentInstallment(
  dueKind: BookingFormPaymentDueKind = "days_after_signing",
  dueDaysAfterSigning = DEFAULT_PAYMENT_DUE_DAYS,
  dueOn = "",
): BookingFormPaymentInstallment {
  return {
    percent: 0,
    dueKind,
    dueDaysAfterSigning,
    dueOn,
    label: "",
  }
}

export function defaultPaymentSchedule(): BookingFormPaymentSchedule {
  return {
    installments: [
      {
        percent: 100,
        dueKind: "days_after_signing",
        dueDaysAfterSigning: DEFAULT_PAYMENT_DUE_DAYS,
        dueOn: "",
        label: "",
      },
    ],
    notes: "",
  }
}

export function isDefaultPaymentSchedule(schedule: BookingFormPaymentSchedule | null | undefined): boolean {
  if (!schedule || schedule.notes.trim()) return false
  if (schedule.installments.length !== 1) return false
  const [first] = schedule.installments
  return (
    first.percent === 100 &&
    first.dueKind === "days_after_signing" &&
    first.dueDaysAfterSigning === DEFAULT_PAYMENT_DUE_DAYS &&
    !first.label.trim()
  )
}

export function splitInstallmentAmounts(total: number, percents: number[]): number[] {
  if (!percents.length) return []
  const amounts = percents.map((percent) => roundMoney((total * percent) / 100))
  if (amounts.length === 1) return [roundMoney(total)]
  const allocated = amounts.slice(0, -1).reduce((sum, amount) => sum + amount, 0)
  amounts[amounts.length - 1] = roundMoney(total - allocated)
  return amounts
}

function cleanLabel(value: string): string {
  const label = value.replaceAll("\u0000", "").trim()
  if (label.length > 80) throw new Error("A payment label is too long.")
  return label
}

function cleanNotes(value: string): string {
  const notes = value.replaceAll("\u0000", "").trim()
  if (notes.length > MAX_PAYMENT_SCHEDULE_NOTES) throw new Error("Payment notes are too long.")
  return notes
}

function parseDueOn(value: string): string {
  const dueOn = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) {
    throw new Error("Each dated payment needs a valid due date.")
  }
  const [year, month, day] = dueOn.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("Each dated payment needs a valid due date.")
  }
  return dueOn
}

export function normalizePaymentSchedule(
  value: BookingFormPaymentSchedule | null | undefined,
): BookingFormPaymentSchedule {
  const installments = (value?.installments ?? [])
    .slice(0, MAX_PAYMENT_INSTALLMENTS)
    .map((row): BookingFormPaymentInstallment => ({
      percent: roundPercent(Number(row.percent)),
      dueKind: row.dueKind === "on_date" ? "on_date" : "days_after_signing",
      dueDaysAfterSigning: Math.max(0, Math.min(MAX_PAYMENT_DUE_DAYS, Math.round(Number(row.dueDaysAfterSigning) || 0))),
      dueOn: String(row.dueOn ?? "").trim(),
      label: String(row.label ?? "").trim(),
    }))
  if (!installments.length) return defaultPaymentSchedule()
  return {
    installments,
    notes: String(value?.notes ?? "").trim(),
  }
}

export function validatePaymentSchedule(schedule: BookingFormPaymentSchedule): BookingFormPaymentSchedule {
  const normalized = normalizePaymentSchedule(schedule)
  if (!normalized.installments.length) throw new Error("Add at least one payment.")
  if (normalized.installments.length > MAX_PAYMENT_INSTALLMENTS) {
    throw new Error(`You can split a booking into at most ${MAX_PAYMENT_INSTALLMENTS} payments.`)
  }

  let percentTotal = 0
  for (const [index, row] of normalized.installments.entries()) {
    if (!Number.isFinite(row.percent) || row.percent <= 0 || row.percent > 100) {
      throw new Error(`Payment ${index + 1} needs a percentage greater than zero.`)
    }
    percentTotal += row.percent
    if (row.dueKind === "on_date") {
      parseDueOn(row.dueOn)
    } else if (
      !Number.isInteger(row.dueDaysAfterSigning) ||
      row.dueDaysAfterSigning < 0 ||
      row.dueDaysAfterSigning > MAX_PAYMENT_DUE_DAYS
    ) {
      throw new Error(`Payment ${index + 1} needs a due date within ${MAX_PAYMENT_DUE_DAYS} days of signing.`)
    }
    cleanLabel(row.label)
  }

  if (Math.abs(percentTotal - 100) > 0.01) {
    throw new Error("Payment percentages must add up to 100%.")
  }

  const notes = cleanNotes(normalized.notes)
  return {
    installments: normalized.installments.map((row, index) => ({
      ...row,
      percent: index === normalized.installments.length - 1
        ? roundPercent(row.percent + (100 - percentTotal))
        : row.percent,
      dueOn: row.dueKind === "on_date" ? parseDueOn(row.dueOn) : "",
      label: cleanLabel(row.label),
    })),
    notes,
  }
}

export function resolveInstallmentDueDate(
  installment: BookingFormPaymentInstallment,
  signingDate: string,
): string {
  if (installment.dueKind === "on_date") return parseDueOn(installment.dueOn)
  return addUtcDays(signingDate.slice(0, 10), installment.dueDaysAfterSigning)
}

export function resolvePaymentSchedule(
  schedule: BookingFormPaymentSchedule,
  total: number,
  signingDate: string,
): ResolvedPaymentInstallment[] {
  const valid = validatePaymentSchedule(schedule)
  const amounts = splitInstallmentAmounts(total, valid.installments.map((row) => row.percent))
  return valid.installments.map((row, index) => ({
    index: index + 1,
    count: valid.installments.length,
    percent: row.percent,
    amount: amounts[index] ?? 0,
    dueDate: resolveInstallmentDueDate(row, signingDate),
    label: row.label,
    dueKind: row.dueKind,
    dueDaysAfterSigning: row.dueDaysAfterSigning,
    dueOn: row.dueOn,
  }))
}

export function formatMoneyAmount(currency: string, amount: number): string {
  return `${currency} ${roundMoney(amount).toFixed(2)}`
}

export function formatInstallmentDueText(installment: BookingFormPaymentInstallment): string {
  if (installment.dueKind === "on_date") {
    const dueOn = parseDueOn(installment.dueOn)
    const [year, month, day] = dueOn.split("-").map(Number)
    const formatted = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
    return `due on ${formatted}`
  }
  if (installment.dueDaysAfterSigning <= 0) return "due upon signing"
  if (installment.dueDaysAfterSigning === 1) return "due 1 day after signing"
  return `due ${installment.dueDaysAfterSigning} days after signing`
}

export function formatPaymentTermsText(
  schedule: BookingFormPaymentSchedule,
  total: number,
  currency: string,
): string {
  const valid = validatePaymentSchedule(schedule)
  const amounts = splitInstallmentAmounts(total, valid.installments.map((row) => row.percent))
  const taxNote = "all tax included"
  const lines: string[] = []

  if (valid.installments.length === 1) {
    const [first] = valid.installments
    lines.push(
      `${formatMoneyAmount(currency, amounts[0] ?? total)} (${first.percent.toFixed(2)}%) ${formatInstallmentDueText(first)}, ${taxNote}.`,
    )
  } else {
    lines.push(
      `${formatMoneyAmount(currency, total)} payable in ${valid.installments.length} payments, ${taxNote}.`,
    )
    valid.installments.forEach((row, index) => {
      const label = row.label ? `${row.label}: ` : ""
      lines.push(
        `${index + 1}. ${label}${row.percent.toFixed(2)}% (${formatMoneyAmount(currency, amounts[index] ?? 0)}) ${formatInstallmentDueText(row)}.`,
      )
    })
  }

  if (valid.notes) lines.push(valid.notes)
  return lines.join("\n")
}

export function paymentScheduleFromUnknown(value: unknown): BookingFormPaymentSchedule | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const rawInstallments = Array.isArray(record.installments) ? record.installments : []
  if (!rawInstallments.length) return null
  try {
    return validatePaymentSchedule({
      installments: rawInstallments.map((entry) => {
        const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}
        const dueOn = typeof row.dueOn === "string" ? row.dueOn : ""
        const dueDays = Number(row.dueDaysAfterSigning)
        const dueKind =
          row.dueKind === "on_date" || (dueOn && row.dueKind !== "days_after_signing")
            ? "on_date"
            : "days_after_signing"
        return {
          percent: Number(row.percent),
          dueKind,
          dueDaysAfterSigning: Number.isFinite(dueDays) ? dueDays : DEFAULT_PAYMENT_DUE_DAYS,
          dueOn,
          label: typeof row.label === "string" ? row.label : "",
        }
      }),
      notes: typeof record.notes === "string" ? record.notes : "",
    })
  } catch {
    return null
  }
}

export function scheduleFromSnapshot(input: {
  paymentSchedule?: BookingFormPaymentSchedule | null
  paymentTerms?: string
}): BookingFormPaymentSchedule {
  const stored = paymentScheduleFromUnknown(input.paymentSchedule)
  if (stored) return stored
  return defaultPaymentSchedule()
}
