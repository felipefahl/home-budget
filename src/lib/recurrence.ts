/** Suggested value for this month's recurring entry: mean of the last 3, in cents. */
export function suggestedAmount(history: number[]): number {
  const last = history.slice(-3)
  return last.length ? Math.round(last.reduce((a, b) => a + b, 0) / last.length) : 0
}
