# Yapp

A workout log for someone who trains by feel. Pick **Push**, **Pull** or **Legs**, tap **Start from last time**, overtype what changed. A second page shows PRs and how this week compares to previous weeks.

**Live:** https://keli69420.github.io/yapp/

## Install on an iPhone

Open the link in Safari, then **⋯ → Share → View More → Add to Home Screen → Add** (leave "Open as Web App" on). Do this **before logging anything**, then always open it from the home-screen icon. The home-screen app and Safari keep separate data: anything logged in Safari won't appear in the app.

## Where things live

- **Hosting:** GitHub Pages on the Keli69420 account. Free, no renewals.
- **The logs:** on the phone only (localStorage, key `yapp.v2`). Nothing is sent anywhere, and this repo holds no logs and no personal numbers. Keep it that way: it is public. Removing the home-screen app deletes them.
- **Offline:** `sw.js` keeps a copy of the page, so it opens with no signal.

## How the numbers work

- **Better set:** more kg, or the same kg and more reps/seconds. No weight counts as zero. The ▲ on the Log page, the PRs and the trend lines all use this one rule (`beats()` in `logic.js`).
- **PR:** the best set ever for that exercise, with the date he first hit it.
- **Comparison:** each exercise compares its two most recent weeks with data, because he doesn't do everything every week. A week runs Monday to Sunday and counts its best set.
- **Exercises** match by name and unit, ignoring capitals. Renaming one starts a new history.
- **Saving:** every change saves as he types, so nothing is lost if the phone dies. **Save workout** just closes today's session and shows the summary. Blank sets are only tidied away once a workout is saved or its day has passed, so reopening mid-workout loses nothing. A session he forgets to close still counts. The date moves on by itself at midnight.
- **Before Start** the Log page only lists the exercise names. Sets and fields appear once he presses Start.
- **Stop workout** (two taps) discards a session he just started. After **Edit** on a saved workout it becomes **Stop editing**, which puts the saved version back.
- **Push up counter:** one number per day on the Log page. It shows 0 from midnight, and the old day keeps its number. The Progress page shows the week's total and a graph of the last 14 days.
- **Leg day always starts with Squat** (`ALWAYS_FIRST` in `logic.js`), even if the last session removed it.
- **Wall sit pill:** on leg day, a **Wall sit 2 min** pill sits between exercises, up until Calves. It's only a tick: it isn't a set, a PR or progress, and it starts unticked each session (`wallSitCount()` in `logic.js`).
- **Start from last time:** copies the last workout of that type as a template: its exercises, number of sets, kg and reps/seconds. He overtypes what changed. Notes and wall sit ticks start empty. Anything left unchanged counts as done, so he removes an exercise he skipped with × (two taps; it's then gone from the next template too, until he adds it back with **+ exercise**, which brings back its numbers). An exercise left empty last time brings back the last numbers he really had (`prefillFrom()` in `logic.js`).
- **Default sets:** an exercise with no numbers to copy starts with 2 empty sets. Wallsit starts with 1, and Hips has no sets (`DEFAULTS` in `logic.js`).
- **Hips button:** **Open in Instagram** opens the Hips reel. In the home-screen app it goes straight to the Instagram app. If Instagram isn't on the phone, iOS shows an error first, and OK opens the reel on the website (`openReel()` in `app.js`).
- **Sets:** **− set +** on each exercise removes the last set or adds one. Every exercise keeps at least one.
- **kg:** each exercise has a `weighted` flag. In Push and Pull only Weighted pull ups and 1 arm pull up, machine have kg; new exercises there start without it, and **With kg** in the add form turns it on. All of Legs has kg.

## How to change things

Tell Claude what to change. Everything worth changing is in one of these:

| Change | File |
|---|---|
| Starting exercise lists for Push, Pull, Legs, and which have kg | `DEFAULTS` at the top of `logic.js` |
| The reel the Hips button opens | `HIPS_REEL` at the top of `logic.js` |
| What counts as better | `beats()` in `logic.js` |
| How many weeks the charts show | `WEEKS` at the top of `app.js` |
| Colors, shadows, fonts | top of `styles.css` |
| Logo and app icon | `logo/logo.svg`, `icon.svg` and the shapes in `tools/make_icon.py`, which writes the PNGs |

**To publish a change:** commit and `git push`. It goes live within a minute or two, and the phone picks it up the next time the app opens with signal.

**Before pushing:**

```bash
node --test tests/logic.test.mjs
```

**To preview locally:**

```bash
python3 -m http.server 8911 --bind 127.0.0.1
```

## Don't touch

- The `yapp.v2` storage key. Renaming it makes existing logs look lost. If the data shape ever has to change, migrate on load the way `migrateLegacy()` moves the first version's `legs.v1` data, and leave the old key in place as a backup.

## Known limits

- One phone, one person. No backup: if the phone is wiped without an iCloud restore, the logs are gone.
- One session per type per day, and no way to log a missed past day.
- A trend line shows direction, not a scale. The exact numbers are in the card, or tap a week.
