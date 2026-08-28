export function guestDetailsStatusFromNamedCount(
  namedCount: number,
  quantity: number,
  currentStatus: string,
): string {
  if (currentStatus === "not_required") return currentStatus
  const needed = Math.max(1, Math.floor(Number(quantity) || 1))
  const named = Math.max(0, Math.floor(Number(namedCount) || 0))
  if (named >= needed) return "complete"
  if (named > 0) return "partial"
  if (currentStatus === "complete" || currentStatus === "partial") return "requested"
  return currentStatus || "not_requested"
}
