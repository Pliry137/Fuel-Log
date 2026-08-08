import { describe, it, expect } from 'vitest';
import {
  dayDeficit, completeRows, cumAtOrBefore, avgDeficitOver,
  deficitToLbsPerWeek, estimateCurrentWeight, weeksToGoal,
  protStats, avgLastN,
  medianIntake, lowLogThreshold, isSuspiciouslyLow, suspiciousLowDays,
} from './insights.js';

// Build rows from [{date, deficit, protein?}] with running cumulativeDeficit.
const mkRows = (days) => {
  let cum = 0;
  return days.map(d => {
    cum += d.deficit;
    return { rawDate: d.date, deficit: d.deficit, cumulativeDeficit: cum, protein: d.protein ?? 0 };
  });
};

describe('dayDeficit', () => {
  it('uses measured burn when Whoop has data', () => {
    expect(dayDeficit(2000, 2800, 2700)).toBe(800);
  });
  // REGRESSION: non-Whoop days used the intake TARGET as burn, understating
  // the deficit by hundreds of kcal.
  it('falls back to maintenance, not the intake target, when burn is missing', () => {
    expect(dayDeficit(2000, null, 2800)).toBe(800);
    expect(dayDeficit(2000, 0, 2800)).toBe(800); // 0 burn treated as missing
  });
});

describe('completeRows', () => {
  const rows = mkRows([
    { date: '2026-08-01', deficit: 500 },
    { date: '2026-08-02', deficit: 400 },
  ]);
  // REGRESSION: today's partial log (375 kcal at 9am) used to count as a
  // ~1800 kcal "deficit" and bend every trailing average.
  it("drops the last row when it is today's partial day", () => {
    expect(completeRows(rows, '2026-08-02')).toHaveLength(1);
    expect(completeRows(rows, '2026-08-02')[0].rawDate).toBe('2026-08-01');
  });
  it('keeps all rows when today has no entries yet (last row is a finished day)', () => {
    expect(completeRows(rows, '2026-08-03')).toHaveLength(2);
  });
  it('handles empty input', () => {
    expect(completeRows([], '2026-08-03')).toHaveLength(0);
  });
});

describe('cumAtOrBefore', () => {
  const rows = mkRows([
    { date: '2026-08-01', deficit: 500 },  // cum 500
    { date: '2026-08-02', deficit: 400 },  // cum 900
    { date: '2026-08-04', deficit: 300 },  // cum 1200 (08-03 unlogged)
  ]);
  it('returns exact cumulative on a logged date', () => {
    expect(cumAtOrBefore(rows, '2026-08-02')).toBe(900);
  });
  // REGRESSION: the ??0 bug — an unlogged date returned 0, so the entire
  // history's deficit was attributed to "since the weigh-in" (~9 lb error).
  it('returns the nearest PRIOR cumulative for an unlogged date, never 0', () => {
    expect(cumAtOrBefore(rows, '2026-08-03')).toBe(900);
  });
  it('returns 0 only for dates before all logging', () => {
    expect(cumAtOrBefore(rows, '2026-07-15')).toBe(0);
  });
});

describe('estimateCurrentWeight', () => {
  const complete = mkRows([
    { date: '2026-08-01', deficit: 700 },  // cum 700
    { date: '2026-08-02', deficit: 700 },  // cum 1400
    { date: '2026-08-04', deficit: 700 },  // cum 2100 (08-03 unlogged)
    { date: '2026-08-05', deficit: 700 },  // cum 2800
  ]);
  it('subtracts only the deficit since the weigh-in', () => {
    // Weighed 211.0 on 08-02 (cum 1400). Since then: 2800-1400 = 1400 kcal = 0.4 lb.
    expect(estimateCurrentWeight({ date: '2026-08-02', weight_lb: 211 }, complete)).toBeCloseTo(210.6, 5);
  });
  // REGRESSION: the 202.2-vs-211 bug — weigh-in on the unlogged 08-03 used to
  // subtract the ENTIRE cum (2800/3500 = 0.8 lb here; ~9 lb with real data).
  it('weigh-in on an unlogged day anchors to the nearest prior day', () => {
    // cumAtOrBefore(08-03) = 1400, so since = 1400 kcal = 0.4 lb, NOT 2800.
    expect(estimateCurrentWeight({ date: '2026-08-03', weight_lb: 211 }, complete)).toBeCloseTo(210.6, 5);
  });
  it('weigh-in on the last complete day returns the weigh-in itself', () => {
    expect(estimateCurrentWeight({ date: '2026-08-05', weight_lb: 209 }, complete)).toBe(209);
  });
  it('weigh-in newer than every complete day (e.g. today) clamps to the weigh-in', () => {
    expect(estimateCurrentWeight({ date: '2026-08-06', weight_lb: 208.5 }, complete)).toBe(208.5);
  });
  it('returns null with no weigh-ins', () => {
    expect(estimateCurrentWeight(null, complete)).toBeNull();
  });
  it('handles a weigh-in with zero logged days', () => {
    expect(estimateCurrentWeight({ date: '2026-08-01', weight_lb: 212 }, [])).toBe(212);
  });
});

describe('avgDeficitOver / deficitToLbsPerWeek', () => {
  const complete = mkRows([
    { date: '2026-08-01', deficit: 300 },
    { date: '2026-08-02', deficit: 500 },
    { date: '2026-08-03', deficit: 700 },
  ]);
  it('averages the trailing window', () => {
    expect(avgDeficitOver(complete, 2)).toBe(600);
    expect(avgDeficitOver(complete, 3)).toBe(500);
  });
  it('uses all rows when fewer than the window', () => {
    expect(avgDeficitOver(complete, 21)).toBe(500);
  });
  it('returns 0 for no data', () => {
    expect(avgDeficitOver([], 7)).toBe(0);
  });
  it('converts kcal/day to lb/week', () => {
    expect(deficitToLbsPerWeek(500)).toBe(1);       // 3500/wk = 1 lb
    expect(deficitToLbsPerWeek(-500)).toBe(-1);     // surplus = gaining
  });
});

describe('weeksToGoal', () => {
  it('computes weeks at the current rate', () => {
    expect(weeksToGoal(202, 1, 195)).toBe(7);
    expect(weeksToGoal(202, 0.5, 195)).toBe(14);
  });
  it('null when already at or below the goal', () => {
    expect(weeksToGoal(195, 1, 195)).toBeNull();
    expect(weeksToGoal(190, 1, 195)).toBeNull();
  });
  it('null when not losing (zero or gaining)', () => {
    expect(weeksToGoal(202, 0, 195)).toBeNull();
    expect(weeksToGoal(202, -0.5, 195)).toBeNull();
  });
  it('null with no weight estimate', () => {
    expect(weeksToGoal(null, 1, 195)).toBeNull();
  });
});

describe('protStats', () => {
  const complete = mkRows([
    { date: '2026-08-01', deficit: 0, protein: 170 },
    { date: '2026-08-02', deficit: 0, protein: 150 },
    { date: '2026-08-03', deficit: 0, protein: 168 },
    { date: '2026-08-04', deficit: 0, protein: 100 },
  ]);
  it('counts days at/above target and averages', () => {
    const s = protStats(complete, 4, 168);
    expect(s).toEqual({ n: 4, hit: 2, pct: 50, avg: 147 });
  });
  it('windows to the trailing N days', () => {
    const s = protStats(complete, 2, 168);
    expect(s.n).toBe(2);
    expect(s.hit).toBe(1); // only 08-03 hits in the last 2
  });
  it('empty data → zeros, no NaN', () => {
    expect(protStats([], 7, 168)).toEqual({ n: 0, hit: 0, pct: 0, avg: 0 });
  });
});

describe('avgLastN', () => {
  it('averages the last N and rounds', () => {
    expect(avgLastN([50, 60, 71], 2)).toBe(66);
  });
  it('null on empty', () => {
    expect(avgLastN([], 7)).toBeNull();
  });
});

describe('under-logging challenge', () => {
  const mkCal = (cals) => cals.map((c, i) => ({ rawDate: `2026-08-${String(i + 1).padStart(2, '0')}`, calories: c, deficit: 0, cumulativeDeficit: 0, protein: 0 }));

  it('medianIntake: odd and even counts', () => {
    expect(medianIntake(mkCal([1800, 2000, 1900]))).toBe(1900);
    expect(medianIntake(mkCal([1800, 2000, 1900, 2100]))).toBe(1950);
  });
  it('medianIntake ignores zero-cal (unlogged) days', () => {
    expect(medianIntake(mkCal([0, 1800, 0, 2000]))).toBe(1900);
  });
  it('medianIntake: null with no data', () => {
    expect(medianIntake([])).toBeNull();
    expect(medianIntake(mkCal([0, 0]))).toBeNull();
  });
  it('threshold is 60% of median with a 1200 floor', () => {
    expect(lowLogThreshold(1900)).toBe(1200);   // 60% = 1140 → floor wins
    expect(lowLogThreshold(2400)).toBe(1440);
    expect(lowLogThreshold(null)).toBe(1200);
  });
  it('flags a low day but never a zero (unlogged) day', () => {
    expect(isSuspiciouslyLow(900, 1200)).toBe(true);
    expect(isSuspiciouslyLow(1300, 1200)).toBe(false);
    expect(isSuspiciouslyLow(0, 1200)).toBe(false);
  });
  it('suspiciousLowDays windows and collects dates', () => {
    const rows = mkCal([1800, 900, 1900, 800, 2000]);
    expect(suspiciousLowDays(rows, 5, 1200)).toEqual(['2026-08-02', '2026-08-04']);
    expect(suspiciousLowDays(rows, 2, 1200)).toEqual(['2026-08-04']);
  });
});
