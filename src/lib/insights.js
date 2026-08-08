// Pure math for the Insights tab. No React, no fetch, no Date.now() —
// every function takes plain data in and returns plain values out, so all of
// it is unit-testable (see insights.test.js). Each historical bug in this
// math has a regression test; add a test before fixing the next one.

// A "row" is one complete-or-partial logged day:
//   { rawDate: "YYYY-MM-DD", deficit: number, cumulativeDeficit: number,
//     protein: number, calories: number, ... }

// One day's deficit. On days Whoop measured burn, deficit is vs. that burn.
// On days without Whoop data, fall back to maintenance — NOT the intake
// target, which is an eating goal and understates the real deficit.
export function dayDeficit(calories, burned, maintenanceKcal) {
  return burned ? burned - calories : maintenanceKcal - calories;
}

// Drop the trailing row only when it is actually today (a partial day whose
// "deficit" isn't real yet). Dropping unconditionally used to discard a
// finished day whenever today had no entries.
export function completeRows(allTimeData, todayYMD) {
  if (!allTimeData.length) return allTimeData;
  return allTimeData[allTimeData.length - 1].rawDate === todayYMD
    ? allTimeData.slice(0, -1)
    : allTimeData;
}

// Cumulative deficit at-or-before a date (rows sorted ascending by rawDate).
// An exact-date lookup used to fall back to 0 for dates with no food entries
// (e.g. a weigh-in on an unlogged day), which subtracted the ENTIRE history's
// deficit from that weigh-in and made est-now ~9 lb too low.
export function cumAtOrBefore(rows, date) {
  let c = 0;
  for (const row of rows) {
    if (row.rawDate <= date) c = row.cumulativeDeficit;
    else break;
  }
  return c;
}

// Average daily deficit over the trailing N complete days.
export function avgDeficitOver(complete, days) {
  const win = complete.slice(-days);
  return win.length ? win.reduce((s, d) => s + d.deficit, 0) / win.length : 0;
}

export function deficitToLbsPerWeek(avgDailyDeficit) {
  return (avgDailyDeficit * 7) / 3500;
}

// Estimated current weight: last weigh-in minus the deficit logged SINCE it,
// counting complete days only. Clamped so a weigh-in today (or newer than the
// last complete day) returns the weigh-in itself.
export function estimateCurrentWeight(lastWeigh, complete) {
  if (!lastWeigh) return null;
  const lastCompleteCum = complete.length ? complete[complete.length - 1].cumulativeDeficit : 0;
  const sinceCum = Math.max(0, lastCompleteCum - cumAtOrBefore(complete, lastWeigh.date));
  return lastWeigh.weight_lb - sinceCum / 3500;
}

// Weeks until a goal weight at the current rate. null when unknowable:
// no estimate, non-losing rate, or already at/below the goal.
export function weeksToGoal(estNow, lbsPerWeek, target) {
  if (estNow == null || lbsPerWeek <= 0 || estNow <= target) return null;
  return (estNow - target) / lbsPerWeek;
}

// Protein adherence over the trailing N complete days.
export function protStats(complete, days, targetProtein) {
  const win = complete.slice(-days);
  const hit = win.filter(d => d.protein >= targetProtein).length;
  return {
    n: win.length,
    hit,
    pct: win.length ? Math.round((hit / win.length) * 100) : 0,
    avg: win.length ? Math.round(win.reduce((s, d) => s + d.protein, 0) / win.length) : 0,
  };
}

// Rounded average of the last N values; null when empty.
export function avgLastN(values, n) {
  const win = values.slice(-n);
  return win.length ? Math.round(win.reduce((a, b) => a + b, 0) / win.length) : null;
}

// ---- Under-logging challenge ----
// A day logged far below the user's own typical intake is more likely a leaky
// log than a heroic fast. Threshold is per-user (median-relative) so each
// account gets challenged against their own normal.

// Median calories over the trailing N complete days (ignores zero-cal days —
// those are "didn't log", a different problem than "logged too little").
export function medianIntake(complete, days = 30) {
  const vals = complete.slice(-days).map(r => r.calories).filter(c => c > 0).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : Math.round((vals[mid - 1] + vals[mid]) / 2);
}

// Below 60% of your own median is suspicious; floor of 1200 so a low-median
// stretch can't drag the threshold into absurdity.
export function lowLogThreshold(median) {
  return median ? Math.max(1200, Math.round(median * 0.6)) : 1200;
}

export function isSuspiciouslyLow(calories, threshold) {
  return calories > 0 && calories < threshold;
}

// Dates in the trailing window that look under-logged.
export function suspiciousLowDays(complete, days, threshold) {
  return complete.slice(-days).filter(r => isSuspiciouslyLow(r.calories, threshold)).map(r => r.rawDate);
}
