"use client"

import { Plus, Trash2 } from "lucide-react"
import {
  DEFAULT_PAYMENT_DUE_DAYS,
  MAX_PAYMENT_INSTALLMENTS,
  addUtcDays,
  emptyPaymentInstallment,
  formatMoneyAmount,
  formatPaymentTermsText,
  splitInstallmentAmounts,
  todayUtcDate,
  type BookingFormPaymentInstallment,
  type BookingFormPaymentSchedule,
} from "@/lib/booking-forms/payment-schedule"

const smallInputClass = "mt-1 h-10 w-full rounded-md border px-3 font-normal text-sm"
const textareaClass = "mt-2 w-full rounded-md border p-3 font-normal"

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function nextInstallment(schedule: BookingFormPaymentSchedule): BookingFormPaymentInstallment {
  const used = schedule.installments.reduce((sum, row) => sum + (Number(row.percent) || 0), 0)
  const remaining = Math.max(0, roundMoney(100 - used))
  const last = schedule.installments[schedule.installments.length - 1]
  if (last?.dueKind === "on_date" && last.dueOn) {
    return {
      ...emptyPaymentInstallment("on_date", DEFAULT_PAYMENT_DUE_DAYS, addUtcDays(last.dueOn, 30)),
      percent: remaining,
    }
  }
  const days = (last?.dueDaysAfterSigning ?? 0) + 30
  return {
    ...emptyPaymentInstallment("days_after_signing", days),
    percent: remaining,
  }
}

export function BookingFormPaymentScheduleFields({
  currency,
  total,
  schedule,
  onChange,
}: {
  currency: string
  total: number
  schedule: BookingFormPaymentSchedule
  onChange: (schedule: BookingFormPaymentSchedule) => void
}) {
  const percents = schedule.installments.map((row) => Number(row.percent) || 0)
  const amounts = splitInstallmentAmounts(total, percents)
  const percentTotal = roundMoney(percents.reduce((sum, value) => sum + value, 0))
  const balanced = Math.abs(percentTotal - 100) <= 0.01
  let preview = ""
  try {
    preview = formatPaymentTermsText(schedule, total, currency)
  } catch (error) {
    preview = error instanceof Error ? error.message : "Finish the payment schedule to preview the wording."
  }

  function updateRow(index: number, patch: Partial<BookingFormPaymentInstallment>) {
    onChange({
      ...schedule,
      installments: schedule.installments.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    })
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Payment schedule</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Default is 100% due {DEFAULT_PAYMENT_DUE_DAYS} days after signing. Split the percentages and dates
          if this booking should raise more than one invoice.
        </p>
      </div>

      {schedule.installments.map((row, index) => (
        <div key={index} className="rounded-md bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-500">
              Payment {index + 1}
              {row.label.trim() ? ` · ${row.label.trim()}` : ""}
            </p>
            {schedule.installments.length > 1 ? (
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...schedule,
                    installments: schedule.installments.filter((_, rowIndex) => rowIndex !== index),
                  })
                }
                className="inline-flex items-center gap-1 text-xs font-semibold text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="block text-xs font-semibold">
              Percent
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={Number.isFinite(row.percent) ? row.percent : ""}
                onChange={(event) => updateRow(index, { percent: Number(event.target.value) })}
                className={smallInputClass}
              />
            </label>
            <label className="block text-xs font-semibold">
              Amount ({currency})
              <input
                readOnly
                value={(amounts[index] ?? 0).toFixed(2)}
                className={`${smallInputClass} bg-white text-slate-600`}
              />
            </label>
            <label className="block text-xs font-semibold sm:col-span-2">
              Label (optional)
              <input
                value={row.label}
                onChange={(event) => updateRow(index, { label: event.target.value })}
                placeholder={index === 0 ? "Deposit" : "Balance"}
                maxLength={80}
                className={smallInputClass}
              />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold">
              Due
              <select
                value={row.dueKind}
                onChange={(event) => {
                  const dueKind = event.target.value === "on_date" ? "on_date" : "days_after_signing"
                  updateRow(index, {
                    dueKind,
                    dueOn: dueKind === "on_date" ? row.dueOn || todayUtcDate() : "",
                    dueDaysAfterSigning:
                      dueKind === "days_after_signing"
                        ? row.dueDaysAfterSigning || (index === 0 ? DEFAULT_PAYMENT_DUE_DAYS : 0)
                        : row.dueDaysAfterSigning,
                  })
                }}
                className={smallInputClass}
              >
                <option value="days_after_signing">Days after signing</option>
                <option value="on_date">On a specific date</option>
              </select>
            </label>
            {row.dueKind === "on_date" ? (
              <label className="block text-xs font-semibold">
                Due date
                <input
                  type="date"
                  value={row.dueOn}
                  onChange={(event) => updateRow(index, { dueOn: event.target.value })}
                  className={smallInputClass}
                />
              </label>
            ) : (
              <label className="block text-xs font-semibold">
                Days after signing
                <input
                  type="number"
                  min={0}
                  max={730}
                  step={1}
                  value={Number.isFinite(row.dueDaysAfterSigning) ? row.dueDaysAfterSigning : ""}
                  onChange={(event) => updateRow(index, { dueDaysAfterSigning: Number(event.target.value) })}
                  className={smallInputClass}
                />
              </label>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {schedule.installments.length < MAX_PAYMENT_INSTALLMENTS ? (
          <button
            type="button"
            onClick={() =>
              onChange({
                ...schedule,
                installments: [...schedule.installments, nextInstallment(schedule)],
              })
            }
            className="inline-flex items-center gap-1 text-sm font-semibold text-[#F90202]"
          >
            <Plus className="h-4 w-4" /> Add payment
          </button>
        ) : (
          <span />
        )}
        <p className={`text-xs font-semibold ${balanced ? "text-slate-600" : "text-red-600"}`}>
          {percentTotal.toFixed(2)}% · {formatMoneyAmount(currency, total)}
          {balanced ? "" : " — must add up to 100%"}
        </p>
      </div>

      <label className="block text-sm font-semibold">
        Extra payment notes
        <textarea
          value={schedule.notes}
          onChange={(event) => onChange({ ...schedule, notes: event.target.value })}
          rows={2}
          className={textareaClass}
          placeholder="Optional wording that should also appear on the booking form."
        />
      </label>

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-slate-500">Booking form wording</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">{preview}</p>
      </div>
    </div>
  )
}
