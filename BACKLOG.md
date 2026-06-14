# Fuel Log — Backlog

Pick one, say "let's do #N", and we'll build it.

## 1. Actual weight tracking
Add daily/weekly weight input. Overlay actual weight on the projected weight-loss chart so you can see whether your TDEE estimate is accurate and tune your calorie target.
- Status: blocked (no scale)
- Effort: ~30 min

## 2. Meal/plate photo extraction
Extend the AI prompt to handle photos of meals on a plate (not just nutrition labels). Useful for restaurants where there's no label.
- Effort: ~10 min (prompt change + brief UI tweak)

## 3. Saved meals / favorites ✅ done
Star button on each entry to favorite/unfavorite. Favorites chip row at top of add form — tap to log to today's date instantly.

## 4. Auto-backup of data files
Nightly snapshot of `data/entries.json`, `data/whoop.json`, `data/targets.json` to `data/backups/YYYY-MM-DD/`. Keep last 30 days, prune older.
- Effort: ~15 min

## 5. Notes/tags per entry
Optional free-text field on each entry — "post-workout", "ate out", "felt bloated". Display subtly under the entry. Searchable later.
- Effort: ~20 min
