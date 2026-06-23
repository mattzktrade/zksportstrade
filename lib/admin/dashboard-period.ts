export function currentMonthKeyUtc(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
}

export function currentYearUtc(): number {
  return new Date().getUTCFullYear()
}
