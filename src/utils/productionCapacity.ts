/** Existing OEE input-form CAPA: per-piece T/T, subtract breaks once, floor per shift. */
export function calculateCapacity(tactTimeSeconds: number, operatingMinutes: number, breakMinutes = 0): number {
  if (!Number.isFinite(tactTimeSeconds) || tactTimeSeconds <= 0 ||
      !Number.isFinite(operatingMinutes) || operatingMinutes <= 0 ||
      !Number.isFinite(breakMinutes) || breakMinutes < 0) return 0;
  return Math.floor((Math.max(0, operatingMinutes - breakMinutes) * 60) / tactTimeSeconds);
}

/** Sum rounded shifts, not a second rounding of the combined runtime. */
export function calculateDailyCapacity(tactTimeSeconds: number, shifts: readonly { operatingMinutes: number; breakMinutes: number }[]): number {
  return shifts.reduce((total, shift) => total + calculateCapacity(tactTimeSeconds, shift.operatingMinutes, shift.breakMinutes), 0);
}
