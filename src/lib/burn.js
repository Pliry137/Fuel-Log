// Picks the burn number for a day from whichever source has trustworthy data.
// Whoop wins when it has a value (unchanged behavior). Apple Health fills in
// only when Whoop has nothing, and only if the day looks complete.
export const APPLE_FLOOR = 0.7; // tunable guess: below 70% of maintenance reads as a charging gap

export function appleBurned(row, date, today, maintenanceKcal, floor = APPLE_FLOOR) {
  if (!row || !row.burned) return null;
  if (date >= today) return null; // in-progress day is always partial
  if (maintenanceKcal && row.burned < floor * maintenanceKcal) return null;
  return row.burned;
}

export function pickBurned(whoopRow, appleRow, date, today, maintenanceKcal) {
  if (whoopRow?.burned) return { burned: whoopRow.burned, source: 'whoop' };
  const a = appleBurned(appleRow, date, today, maintenanceKcal);
  if (a) return { burned: a, source: 'apple' };
  return { burned: null, source: null };
}
