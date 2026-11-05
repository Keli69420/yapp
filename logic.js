// Everything that decides a value lives here, as plain functions, so it can be tested.

export const TYPES = ["push", "pull", "legs"];

// What a type starts with before he has logged it. `sets` is how many rows to offer,
// `weighted` whether it gets a kg field, and 0 sets means it's only a reminder: a name with
// nothing to fill in. Legs come from his leg note; Push and Pull from his workout notes,
// without the warm-ups. To change a list, change it here. He can also add and remove in the app.
const DEFAULT_SETS = 2;
const item = (name, unit, sets, weighted = false) => ({ name, unit, sets, weighted, ...(sets === 0 && { reminder: true }) });
// The reel the Hips button opens. `app` is the same reel for the Instagram app: the reel's page
// lists it as al:ios:url, so a new reel needs both changed.
const HIPS_REEL = { web: "https://www.instagram.com/reel/DdRus-ghNox/", app: "instagram://media?id=3986172546113657393" };
export const DEFAULTS = {
  push: [
    item("Handstand max hold", "sec", 2),
    item("Parallettes handstand", "sec", 2),
    item("HSPU", "reps", 2),
    item("90° HSPU", "reps", 2),
  ],
  pull: [
    item("Front lever", "sec", 2),
    item("FL max dropsets", "sec", 2),
    item("FL negatives", "reps", 2),
    item("1 arm pull up, band", "reps", 2),
    item("1 arm pull up, machine", "reps", 2, true),
    item("Weighted pull ups", "reps", 2, true),
  ],
  legs: [
    item("Squat", "reps", 2, true),
    item("Romanian Deadlift", "reps", 2, true),
    item("Split Squat", "reps", 2, true),
    item("Weighted Jumps", "reps", 2, true),
    item("Calves", "reps", 2, true),
    item("Wallsit", "sec", 1, true),
    item("Split squat L", "sec", 2, true),
    item("Split squat R", "sec", 2, true),
    { ...item("Hips", "sec", 0, true), reel: HIPS_REEL },
  ],
};

const blank = () => ({ kg: null, val: null });
export const sessionKey = (date, type) => `${date}_${type}`;
export const exKey = (name, unit) => `${name.trim().toLowerCase()}|${unit}`;

export const isEmptySet = (s) => s.kg == null && s.val == null;

export function isEmptySession(session) {
  return !(session.note || "").trim() && session.exercises.every((e) => e.sets.every(isEmptySet));
}

const realSets = (exercise) => exercise.sets.filter((s) => !isEmptySet(s)).map((s) => ({ ...s }));

// Abandoned sets go, but every exercise keeps at least one row. Reminders have none.
const tidySets = (exercise) => {
  if (exercise.reminder) return { ...exercise, sets: [] };
  const kept = realSets(exercise);
  return { ...exercise, sets: kept.length ? kept : [blank()] };
};

// A reminder on the list never has sets. Anything the list says has kg always gets it, so
// changing the list reaches phones that already saved the exercise without it. Sessions from before the kg rule have no flag:
// default push and pull exercises follow the list and lose any kg, and ones he added keep
// kg only if he logged some. Any other flag is his choice and stays.
const listedFor = (type, exercise) => DEFAULTS[type]?.find((d) => exKey(d.name, d.unit) === exKey(exercise.name, exercise.unit));
const asReminder = (d) => ({ name: d.name, unit: d.unit, reminder: true, sets: [], ...(d.reel && { reel: d.reel }) });

function withKgRule(exercise, type) {
  const listed = listedFor(type, exercise);
  if (listed?.reminder) return asReminder(listed);
  if (listed?.weighted) return { ...exercise, weighted: true };
  if (exercise.weighted !== undefined) return exercise;
  if (type === "legs") return { ...exercise, weighted: true };
  if (!listed) return { ...exercise, weighted: exercise.sets.some((s) => s.kg != null) };
  return { ...exercise, weighted: false, sets: exercise.sets.map((s) => ({ ...s, kg: null })) };
}

const copy = (x) => JSON.parse(JSON.stringify(x));

// Edit on a saved workout. Stop brings back the version from before the first edit.
export function reopenSession(session) {
  const { saved, ...current } = session;
  return { ...copy(current), done: false, saved: saved ?? copy(current) };
}

// Stop: a fresh session disappears, a reopened one goes back to how it was saved.
export function stopSession(all, key) {
  const out = { ...all };
  if (out[key]?.saved) out[key] = copy(out[key].saved);
  else delete out[key];
  return out;
}

const withoutTicks = (sets) => sets.map(({ wallsit, ...s }) => s);

// Ticks used to be saved per set. The one after the last set meant the gap before the next
// exercise, so that one moves to the exercise. The others no longer mean anything.
function tickOnExercise(exercise) {
  if (!exercise.sets.some((s) => s.wallsit)) return exercise;
  const lastTicked = exercise.sets[exercise.sets.length - 1].wallsit;
  return { ...exercise, sets: withoutTicks(exercise.sets), ...(lastTicked && { wallsit: true }) };
}

// Run when the data loads, never mid-typing. A workout still going today is left as it is,
// so reopening the app mid-session doesn't take away sets he hasn't filled in yet.
export function tidy(sessions, today) {
  const out = {};
  for (const [key, session] of Object.entries(sessions)) {
    const inProgress = session.date === today && !session.done;
    if (isEmptySession(session)) {
      if (session.saved) {
        out[key] = copy(session.saved); // he cleared an edit: the saved one stands
        continue;
      }
      if (!inProgress) continue;
    }
    const exercises = session.exercises.map((e) => tickOnExercise(withKgRule(e, session.type)));
    out[key] = { ...session, exercises: inProgress ? exercises : exercises.map(tidySets) };
  }
  return out;
}

// Leg day: a 2 min wall sit between exercises, up until Calves. It is only a tick saved on
// the exercise it follows (`wallsit: true`): it never counts as a set, a PR or progress.
// Returns how many exercises from the top get one. If Calves is gone, it stops at whatever
// comes after Calves in the default list.
export function wallSitCount(session) {
  if (session.type !== "legs") return 0;
  const names = DEFAULTS.legs.map((d) => d.name);
  const stop = new Set(names.slice(names.indexOf("Calves")).map((n) => n.toLowerCase()));
  const i = session.exercises.findIndex((e) => stop.has(e.name.trim().toLowerCase()));
  return i === -1 ? session.exercises.length : i;
}

// Leg day always starts with this and ends with its reminders, whatever the last session
// did with them. The first one keeps its numbers if he has any.
const ALWAYS_FIRST = { legs: "Squat" };

function pinEnds(exercises, type, date, all) {
  let list = exercises;
  const d = DEFAULTS[type].find((x) => x.name === ALWAYS_FIRST[type]);
  if (d) {
    const found = list.find((e) => exKey(e.name, e.unit) === exKey(d.name, d.unit));
    list = [found ?? newExercise(all, d.name, d.unit, date, d.weighted), ...list.filter((e) => e !== found)];
  }
  const reminders = DEFAULTS[type].filter((x) => x.reminder);
  const isReminder = (e) => reminders.some((r) => exKey(r.name, r.unit) === exKey(e.name, e.unit));
  return [...list.filter((e) => !isReminder(e)), ...reminders.map(asReminder)];
}

// Every exercise is offered at least its default number of sets, even if he did fewer last time.
function topUpSets(exercise, type) {
  const want = listedFor(type, exercise)?.sets ?? DEFAULT_SETS;
  const sets = exercise.sets.map((s) => ({ ...s }));
  while (sets.length < want) sets.push(blank());
  return { ...exercise, sets };
}

// The copy-paste: a new session starting from the last one's exercises and numbers.
export function prefillFrom(last, date, type, all = {}) {
  const exercises = last
    ? last.exercises.map(tickOnExercise).map(tidySets).map(({ wallsit, ...e }) => e)
    : DEFAULTS[type].map((d) => ({ name: d.name, unit: d.unit, weighted: d.weighted, sets: Array.from({ length: d.sets }, blank) }));
  return { date, type, exercises: pinEnds(exercises, type, date, all).map((e) => topUpSets(e, type)), note: "", updatedAt: null };
}

const realSessions = (all) => Object.values(all).filter((s) => !isEmptySession(s));
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

export function lastSessionBefore(all, type, date) {
  const earlier = realSessions(all).filter((s) => s.type === type && s.date < date).sort(byDate);
  return earlier.length ? earlier[earlier.length - 1] : null;
}

// Where the forward arrow goes: the next session of this type, then today, then nowhere.
export function nextLogged(all, type, date, today) {
  const later = realSessions(all).filter((s) => s.type === type && s.date > date && s.date <= today).sort(byDate);
  if (later.length) return later[0].date;
  return date < today ? today : null;
}

// The last time he really did this exercise, whichever session that was. He goes by
// feel, so last session may have skipped it. Real sets only.
export function lastExerciseBefore(all, name, unit, date) {
  const key = exKey(name, unit);
  const earlier = realSessions(all).filter((s) => s.date < date).sort(byDate).reverse();
  for (const session of earlier) {
    const found = session.exercises.find((e) => exKey(e.name, e.unit) === key);
    if (found) {
      const real = realSets(found);
      if (real.length) return { name: found.name, unit: found.unit, sets: real };
    }
  }
  return null;
}

// Adding an exercise: old numbers and spelling if he has done it before, else blank sets.
export function newExercise(all, name, unit, date, weighted) {
  const before = lastExerciseBefore(all, name, unit, date);
  if (!before) return { name: name.trim(), unit, weighted, sets: Array.from({ length: DEFAULT_SETS }, blank) };
  const sets = withoutTicks(before.sets);
  return { name: before.name, unit, weighted, sets: weighted ? sets : sets.map((s) => ({ ...s, kg: null })) };
}

// For the suggestions when he adds an exercise to this type.
export function knownExercises(all, type) {
  const seen = new Map();
  for (const d of DEFAULTS[type]) seen.set(exKey(d.name, d.unit), { name: d.name, unit: d.unit, weighted: d.weighted });
  for (const session of Object.values(all)) {
    if (session.type !== type) continue;
    for (const e of session.exercises) {
      const key = exKey(e.name, e.unit);
      if (!seen.has(key)) seen.set(key, { name: e.name, unit: e.unit, weighted: Boolean(e.weighted) });
    }
  }
  return [...seen.values()];
}

// More kg, or the same kg and more reps/sec. No weight counts as zero.
export function beats(a, b) {
  if (!a || !b || isEmptySet(a) || isEmptySet(b)) return false;
  const kg = a.kg ?? 0;
  const otherKg = b.kg ?? 0;
  return kg > otherKg || (kg === otherKg && (a.val ?? 0) > (b.val ?? 0));
}

export function bestSet(list) {
  let best = null;
  for (const s of list) {
    if (isEmptySet(s)) continue;
    if (!best || beats(s, best)) best = s;
  }
  return best ? { ...best } : null;
}

export function fmtSet(s, unit) {
  if (!s || isEmptySet(s)) return "";
  const shown = s.val == null ? "" : unit === "sec" ? `${s.val}s` : `${s.val}`;
  if (s.kg != null && s.val != null) return `${s.kg} × ${shown}`;
  if (s.kg != null) return `${s.kg} kg`;
  return unit === "sec" ? shown : `${shown} reps`;
}

// Accepts 27.5 and 27,5 because a Swiss iPhone can offer either. Junk becomes null.
export function parseNum(text) {
  const t = String(text).trim().replace(",", ".");
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}

const parts = (iso) => iso.split("-").map(Number);

export function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}

export function weekdayName(iso) {
  const [y, m, d] = parts(iso);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(y, m - 1, d).getDay()];
}

export function todayIso(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/* ---------- moving the first version's data (key legs.v1) ---------- */

const LEGACY_LIFTS = [["squat", "Squat"], ["rdl", "Romanian Deadlift"], ["split", "Split Squat"], ["jumps", "Weighted Jumps"], ["calves", "Calves"]];

export function migrateLegacy(days) {
  const out = {};
  for (const day of Object.values(days)) {
    const exercises = [];
    for (const [id, name] of LEGACY_LIFTS) {
      const rows = day.ex?.[id];
      if (rows) exercises.push({ name, unit: "reps", sets: rows.map((r) => ({ kg: r.kg, val: r.reps })) });
    }
    for (const r of day.ex?.iso ?? []) exercises.push({ name: r.name, unit: "sec", sets: [{ kg: r.kg, val: r.sec }] });
    out[sessionKey(day.date, "legs")] = { date: day.date, type: "legs", exercises, note: day.note ?? "", updatedAt: day.updatedAt ?? null };
  }
  return out;
}

/* ---------- weeks run Monday to Sunday ---------- */

const DAY_MS = 86400000;
const utc = (iso) => {
  const [y, m, d] = parts(iso);
  return Date.UTC(y, m - 1, d);
};

export function weekStart(iso) {
  const t = utc(iso);
  const sinceMonday = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

export const weeksAgo = (iso, today) => Math.round((utc(weekStart(today)) - utc(weekStart(iso))) / (7 * DAY_MS));

export const weeksAgoLabel = (n) => (n === 0 ? "this wk" : n === 1 ? "last wk" : `${n} wks ago`);

// Sessions and real sets per week across all types, oldest week first.
export function weeklyTotals(all, today, weeks = 8) {
  const out = Array.from({ length: weeks }, (_, i) => ({ weeksAgo: weeks - 1 - i, sessions: 0, sets: 0 }));
  for (const session of realSessions(all)) {
    const ago = weeksAgo(session.date, today);
    if (ago < 0 || ago >= weeks) continue;
    const bucket = out[weeks - 1 - ago];
    bucket.sessions += 1;
    bucket.sets += session.exercises.reduce((n, e) => n + realSets(e).length, 0);
  }
  return out;
}

/* ---------- PRs and comparing weeks ---------- */

export function exerciseStats(all, name, unit, today, weeks = 8) {
  const key = exKey(name, unit);
  let pr = null;
  let lastDate = null;
  const bestByWeek = new Map();
  for (const session of realSessions(all).sort(byDate)) {
    const found = session.exercises.find((e) => exKey(e.name, e.unit) === key);
    const best = found ? bestSet(found.sets) : null;
    if (!best) continue;
    lastDate = session.date;
    if (!pr || beats(best, pr.set)) pr = { set: best, date: session.date };
    const ago = weeksAgo(session.date, today);
    if (!bestByWeek.has(ago) || beats(best, bestByWeek.get(ago))) bestByWeek.set(ago, best);
  }
  const logged = [...bestByWeek.keys()].sort((a, b) => a - b);
  const at = (i) => (logged[i] === undefined ? null : { weeksAgo: logged[i], set: bestByWeek.get(logged[i]) });
  const latest = at(0);
  const previous = at(1);
  let trend = null;
  if (previous) trend = beats(latest.set, previous.set) ? "up" : beats(previous.set, latest.set) ? "down" : "same";
  const weekly = Array.from({ length: weeks }, (_, i) => bestByWeek.get(weeks - 1 - i) ?? null);
  return { name, unit, pr, latest, previous, trend, weekly, lastDate };
}

// Every exercise he has really done in this type, most recently done first.
export function statsForType(all, type, today, weeks = 8) {
  const seen = new Map();
  for (const session of realSessions(all).filter((s) => s.type === type).sort(byDate)) {
    for (const e of session.exercises) {
      if (realSets(e).length) seen.set(exKey(e.name, e.unit), { name: e.name, unit: e.unit });
    }
  }
  return [...seen.values()]
    .map((e) => exerciseStats(all, e.name, e.unit, today, weeks))
    .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
}

// What he sees after saving a workout. A PR has to beat everything before it, so a first
// time isn't one, and neither is a tie.
export function sessionSummary(all, session) {
  const earlier = realSessions(all).filter((s) => s.date < session.date);
  const prs = [];
  for (const e of session.exercises) {
    const best = bestSet(e.sets);
    if (!best) continue;
    const key = exKey(e.name, e.unit);
    const before = bestSet(earlier.flatMap((s) => s.exercises.filter((x) => exKey(x.name, x.unit) === key).flatMap((x) => x.sets)));
    if (before && beats(best, before)) prs.push({ name: e.name, unit: e.unit, set: best });
  }
  return { sets: session.exercises.reduce((n, e) => n + realSets(e).length, 0), prs };
}

/* ---------- daily push up counter ---------- */

export function addPushups(counts, date, by) {
  const next = Math.max(0, (counts[date] ?? 0) + by);
  const out = { ...counts };
  if (next) out[date] = next;
  else delete out[date];
  return out;
}

// One entry per day, oldest first, ending today. For the graph on the Progress page.
export function dailyPushups(counts, today, days = 14) {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(utc(today) - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    return { date, count: counts[date] ?? 0 };
  });
}

export function weekPushups(counts, today, ago) {
  return Object.entries(counts).reduce((n, [d, c]) => (weeksAgo(d, today) === ago ? n + c : n), 0);
}

// Reps count for a thousandth of a kilo, so this orders sets exactly the way beats() does
// and the line can never disagree with the ▲.
const score = (s) => (s.kg ?? 0) + (s.val ?? 0) / 1000;

// Where each week's dot goes. Skipped weeks are gaps.
export function sparkPoints(weekly, w, h, pad) {
  const scores = weekly.filter(Boolean).map(score);
  if (!scores.length) return [];
  const hi = Math.max(...scores);
  const lo = Math.min(...scores);
  const step = weekly.length > 1 ? (w - 2 * pad) / (weekly.length - 1) : 0;
  return weekly.flatMap((s, i) => {
    if (!s) return [];
    const y = hi === lo ? h / 2 : pad + ((hi - score(s)) / (hi - lo)) * (h - 2 * pad);
    return [{ i, x: pad + i * step, y }];
  });
}
