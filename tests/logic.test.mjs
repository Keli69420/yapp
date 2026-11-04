import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TYPES, DEFAULTS, sessionKey, isEmptySet, isEmptySession, tidy, prefillFrom,
  lastSessionBefore, nextLogged, lastExerciseBefore, knownExercises, newExercise, beats, bestSet,
  fmtSet, parseNum, fmtDate, weekdayName, todayIso, migrateLegacy, weekStart, weeksAgo,
  weeksAgoLabel, weeklyTotals, exerciseStats, statsForType, sparkPoints, sessionSummary,
  reopenSession, stopSession,
} from "../logic.js";

const set = (kg, val) => ({ kg, val });
const BLANK = set(null, null);
const ex = (name, sets, unit = "reps") => ({ name, unit, sets });
const sess = (date, type, exercises, note = "") => ({ date, type, exercises, note, updatedAt: null });
const db = (...list) => Object.fromEntries(list.map((s) => [sessionKey(s.date, s.type), s]));
const SAMPLE = sess("2026-10-10", "legs", [ex("Squat", [set(80, 6), set(70, 6)]), ex("Wallsit", [set(22, 40)], "sec"), ex("Hips", [BLANK], "sec")]);

/* ---------- the three lists ---------- */

test("three workout types, in the order he picks from", () => {
  assert.deepEqual(TYPES, ["push", "pull", "legs"]);
});

test("the default lists come from his notes, with the right units", () => {
  const names = (t) => DEFAULTS[t].map((e) => e.name);
  assert.deepEqual(names("legs"), ["Squat", "Romanian Deadlift", "Split Squat", "Weighted Jumps", "Calves", "Wallsit", "Split squat L", "Split squat R", "Hips"]);
  assert.deepEqual(names("push"), ["Handstand max hold", "Parallettes handstand", "HSPU", "90° HSPU"]);
  assert.deepEqual(names("pull"), ["Front lever", "FL max dropsets", "FL negatives", "1 arm pull up, band", "1 arm pull up, machine", "Weighted pull ups"]);
  const unit = (t, n) => DEFAULTS[t].find((e) => e.name === n).unit;
  assert.equal(unit("legs", "Squat"), "reps");
  assert.equal(unit("legs", "Wallsit"), "sec");
  assert.equal(unit("push", "Handstand max hold"), "sec");
  assert.equal(unit("push", "HSPU"), "reps");
  assert.equal(unit("pull", "Weighted pull ups"), "reps");
});

test("the set counts he wrote carry over: 3x negatives, 2x weighted pull ups", () => {
  const sets = (t, n) => DEFAULTS[t].find((e) => e.name === n).sets;
  assert.equal(sets("pull", "FL negatives"), 3);
  assert.equal(sets("pull", "Weighted pull ups"), 2);
  assert.equal(sets("legs", "Wallsit"), 1);
});

/* ---------- finding the right session ---------- */

test("lastSessionBefore stays inside the workout type", () => {
  const s = db(
    sess("2026-10-01", "legs", [ex("Squat", [set(60, 5)])]),
    sess("2026-10-10", "pull", [ex("Weighted pull ups", [set(20, 8)])]),
    sess("2026-11-01", "legs", [ex("Squat", [set(70, 5)])]),
  );
  assert.equal(lastSessionBefore(s, "legs", "2026-11-04").date, "2026-11-01");
  assert.equal(lastSessionBefore(s, "legs", "2026-11-01").date, "2026-10-01");
  assert.equal(lastSessionBefore(s, "pull", "2026-11-04").date, "2026-10-10");
  assert.equal(lastSessionBefore(s, "push", "2026-11-04"), null);
  assert.equal(lastSessionBefore(s, "legs", "2026-10-01"), null);
});

test("lastSessionBefore skips a session he cleared out", () => {
  const s = db(sess("2026-10-10", "legs", [ex("Squat", [set(60, 5)])]), sess("2026-11-01", "legs", [ex("Squat", [BLANK])]));
  assert.equal(lastSessionBefore(s, "legs", "2026-11-04").date, "2026-10-10");
});

test("nextLogged walks forward inside the type and ends on today", () => {
  const s = db(
    sess("2026-10-01", "legs", [ex("Squat", [set(60, 5)])]),
    sess("2026-10-05", "pull", [ex("Weighted pull ups", [set(20, 8)])]),
    sess("2026-10-10", "legs", [ex("Squat", [set(60, 5)])]),
  );
  assert.equal(nextLogged(s, "legs", "2026-10-01", "2026-11-04"), "2026-10-10");
  assert.equal(nextLogged(s, "legs", "2026-10-10", "2026-11-04"), "2026-11-04");
  assert.equal(nextLogged(s, "legs", "2026-11-04", "2026-11-04"), null);
});

test("a day can hold one session of each type", () => {
  assert.notEqual(sessionKey("2026-11-04", "push"), sessionKey("2026-11-04", "pull"));
});

/* ---------- the copy-paste ---------- */

test("prefillFrom copies the last session: same numbers, new date, no note, nothing shared", () => {
  const last = sess("2026-10-10", "pull", [ex("Weighted pull ups", [set(20, 8), set(20, 6)])], "felt heavy");
  const next = prefillFrom(last, "2026-11-04", "pull");
  assert.equal(next.date, "2026-11-04");
  assert.equal(next.type, "pull");
  assert.equal(next.note, "");
  assert.deepEqual(next.exercises[0].sets, [set(20, 8), set(20, 6)]);
  next.exercises[0].sets[0].kg = 999;
  assert.equal(last.exercises[0].sets[0].kg, 20);
});

test("prefillFrom keeps exercises he added and leaves out ones he removed", () => {
  const last = sess("2026-10-10", "push", [ex("Planche lean", [set(null, 20)], "sec")]);
  const next = prefillFrom(last, "2026-11-04", "push");
  assert.deepEqual(next.exercises.map((e) => e.name), ["Planche lean"]);
  assert.equal(next.exercises[0].unit, "sec");
});

test("prefillFrom drops blank sets but keeps a row, and keeps Hips with no numbers", () => {
  const last = sess("2026-10-10", "legs", [
    ex("Squat", [set(60, 5), BLANK, set(50, 5)]),
    ex("Calves", [BLANK]),
    ex("Hips", [BLANK], "sec"),
  ]);
  const next = prefillFrom(last, "2026-11-04", "legs");
  assert.deepEqual(next.exercises[0].sets, [set(60, 5), set(50, 5)]);
  assert.deepEqual(next.exercises[1].sets, [BLANK]);
  assert.deepEqual(next.exercises[2].sets, [BLANK]);
});

test("prefillFrom with nothing before starts from the default list, blank", () => {
  const next = prefillFrom(null, "2026-11-04", "pull");
  assert.equal(next.exercises.length, DEFAULTS.pull.length);
  const neg = next.exercises.find((e) => e.name === "FL negatives");
  assert.equal(neg.sets.length, 3);
  assert.deepEqual(neg.sets[0], BLANK);
});

/* ---------- last time, per exercise ---------- */

test("lastExerciseBefore finds it even if the last session skipped it, because he goes random", () => {
  const s = db(
    sess("2026-10-01", "pull", [ex("FL negatives", [set(null, 3)])]),
    sess("2026-10-20", "pull", [ex("Weighted pull ups", [set(20, 8)])]),
  );
  assert.deepEqual(lastExerciseBefore(s, "FL negatives", "reps", "2026-11-04").sets, [set(null, 3)]);
  assert.equal(lastExerciseBefore(s, "FL negatives", "reps", "2026-10-01"), null);
});

test("lastExerciseBefore ignores case, needs the same unit, and skips blank sets", () => {
  const s = db(
    sess("2026-10-01", "legs", [ex("Hips", [set(5, 30)], "sec")]),
    sess("2026-10-20", "legs", [ex("Hips", [BLANK], "sec")]),
  );
  assert.deepEqual(lastExerciseBefore(s, " hips ", "sec", "2026-11-04").sets, [set(5, 30)]);
  assert.equal(lastExerciseBefore(s, "Hips", "reps", "2026-11-04"), null);
});

test("newExercise brings back old numbers if he has done it before, otherwise one blank set", () => {
  const s = db(sess("2026-10-01", "pull", [ex("Muscle up", [set(null, 5), set(null, 4)])]));
  assert.deepEqual(newExercise(s, "  muscle up ", "reps", "2026-11-04", false).sets, [set(null, 5), set(null, 4)]);
  assert.equal(newExercise(s, "  muscle up ", "reps", "2026-11-04", false).name, "Muscle up");
  const fresh = newExercise(s, "Dips", "reps", "2026-11-04", true);
  assert.deepEqual(fresh, { name: "Dips", unit: "reps", weighted: true, sets: [BLANK] });
});

test("knownExercises offers the defaults plus anything he has added to that type", () => {
  const s = db(sess("2026-10-01", "push", [ex("Planche lean", [set(null, 20)], "sec")]), sess("2026-10-02", "pull", [ex("Muscle up", [set(null, 5)])]));
  const known = knownExercises(s, "push");
  assert.ok(known.some((e) => e.name === "HSPU" && e.unit === "reps" && e.weighted === false));
  assert.ok(known.some((e) => e.name === "Planche lean" && e.unit === "sec"));
  assert.ok(!known.some((e) => e.name === "Muscle up"));
  assert.equal(known.filter((e) => e.name === "HSPU").length, 1);
});

/* ---------- better or worse ---------- */

test("beats: more kg, or the same kg and more reps/sec", () => {
  const last = set(80, 10);
  assert.equal(beats(set(85, 8), last), true);
  assert.equal(beats(set(80, 11), last), true);
  assert.equal(beats(set(80, 10), last), false);
  assert.equal(beats(set(80, 9), last), false);
  assert.equal(beats(set(75, 20), last), false);
});

test("beats: nothing to compare means false", () => {
  assert.equal(beats(set(85, 8), null), false);
  assert.equal(beats(set(85, 8), BLANK), false);
  assert.equal(beats(BLANK, set(80, 10)), false);
});

test("beats: no weight counts as zero, so bodyweight and holds still compare", () => {
  assert.equal(beats(set(null, 40), set(null, 30)), true);
  assert.equal(beats(set(10, 30), set(null, 30)), true);
});

test("bestSet picks the best real set, or null", () => {
  assert.deepEqual(bestSet([set(60, 5), set(70, 3), BLANK, set(70, 2)]), set(70, 3));
  assert.equal(bestSet([BLANK]), null);
  assert.equal(bestSet([]), null);
});

test("fmtSet is short enough for the Last column", () => {
  assert.equal(fmtSet(set(80, 10), "reps"), "80 × 10");
  assert.equal(fmtSet(set(22, 40), "sec"), "22 × 40s");
  assert.equal(fmtSet(set(80, null), "reps"), "80 kg");
  assert.equal(fmtSet(set(null, 10), "reps"), "10 reps");
  assert.equal(fmtSet(set(null, 50), "sec"), "50s");
  assert.equal(fmtSet(BLANK, "sec"), "");
  assert.equal(fmtSet(null, "reps"), "");
});

/* ---------- small things ---------- */

test("fmtDate writes dates the way his note does", () => {
  assert.equal(fmtDate("2026-10-10"), "10.10.26");
  assert.equal(fmtDate("2026-11-04"), "04.11.26");
});

test("weekdayName and todayIso", () => {
  assert.equal(weekdayName("2026-11-04"), "Wednesday");
  assert.equal(todayIso(new Date(2026, 0, 5)), "2026-01-05");
});

test("parseNum takes both decimal separators and refuses junk", () => {
  assert.equal(parseNum("120"), 120);
  assert.equal(parseNum("27,5"), 27.5);
  assert.equal(parseNum("27.5"), 27.5);
  assert.equal(parseNum(" 8 "), 8);
  assert.equal(parseNum("0"), 0);
  assert.equal(parseNum(""), null);
  assert.equal(parseNum("."), null);
  assert.equal(parseNum("abc"), null);
  assert.equal(parseNum("1.2.3"), null);
  assert.equal(parseNum("-5"), null);
});

test("isEmptySet and isEmptySession", () => {
  assert.equal(isEmptySet(BLANK), true);
  assert.equal(isEmptySet(set(0, null)), false);
  assert.equal(isEmptySession(sess("2026-11-01", "legs", [ex("Squat", [BLANK])])), true);
  assert.equal(isEmptySession(sess("2026-11-01", "legs", [])), true);
  assert.equal(isEmptySession(sess("2026-11-01", "legs", [ex("Squat", [BLANK])], "sick")), false);
  assert.equal(isEmptySession(sess("2026-11-01", "legs", [ex("Squat", [set(60, 5)])])), false);
});

test("tidy removes abandoned sets and empty sessions, and never loses numbers", () => {
  const s = db(
    sess("2026-10-10", "legs", [ex("Squat", [set(60, 5), BLANK, set(50, 5), BLANK]), ex("Hips", [BLANK], "sec")]),
    sess("2026-11-01", "legs", [ex("Squat", [BLANK])]),
  );
  const out = tidy(s);
  assert.deepEqual(Object.keys(out), [sessionKey("2026-10-10", "legs")]);
  const kept = out[sessionKey("2026-10-10", "legs")];
  assert.deepEqual(kept.exercises[0].sets, [set(60, 5), set(50, 5)]);
  assert.deepEqual(kept.exercises[1].sets, [BLANK]);
});

/* ---------- moving the first version's data ---------- */

test("migrateLegacy turns old leg days into leg sessions without losing a number", () => {
  const days = {
    "2026-10-10": {
      date: "2026-10-10",
      note: "good one",
      updatedAt: "2026-10-10T18:00:00Z",
      ex: {
        squat: [{ kg: 85, reps: 10 }, { kg: 70, reps: 8 }],
        rdl: [{ kg: 61, reps: 7 }],
        split: [{ kg: null, reps: null }],
        jumps: [{ kg: 31, reps: 9 }],
        calves: [{ kg: 47.5, reps: 12 }],
        iso: [{ name: "Wallsit", kg: 22, sec: 40 }, { name: "Hips", kg: null, sec: null }],
      },
    },
  };
  const out = migrateLegacy(days);
  const s = out[sessionKey("2026-10-10", "legs")];
  assert.equal(s.type, "legs");
  assert.equal(s.note, "good one");
  const find = (n) => s.exercises.find((e) => e.name === n);
  assert.deepEqual(find("Squat").sets, [set(85, 10), set(70, 8)]);
  assert.deepEqual(find("Calves").sets, [set(47.5, 12)]);
  assert.equal(find("Wallsit").unit, "sec");
  assert.deepEqual(find("Wallsit").sets, [set(22, 40)]);
  assert.deepEqual(find("Hips").sets, [BLANK]);
  assert.deepEqual(s.exercises.map((e) => e.name), ["Squat", "Romanian Deadlift", "Split Squat", "Weighted Jumps", "Calves", "Wallsit", "Hips"]);
});

/* ---------- weeks, Monday to Sunday ---------- */

test("weeks run Monday to Sunday", () => {
  assert.equal(weekStart("2026-11-04"), "2026-11-02");
  assert.equal(weekStart("2026-11-02"), "2026-11-02");
  assert.equal(weekStart("2026-11-08"), "2026-11-02");
  assert.equal(weekStart("2027-01-01"), "2026-12-28");
});

test("weeksAgo counts calendar weeks, across the clock change too", () => {
  assert.equal(weeksAgo("2026-11-04", "2026-11-04"), 0);
  assert.equal(weeksAgo("2026-11-02", "2026-11-08"), 0);
  assert.equal(weeksAgo("2026-11-01", "2026-11-02"), 1);
  assert.equal(weeksAgo("2026-10-10", "2026-11-04"), 4);
});

test("weeksAgoLabel", () => {
  assert.equal(weeksAgoLabel(0), "this wk");
  assert.equal(weeksAgoLabel(1), "last wk");
  assert.equal(weeksAgoLabel(3), "3 wks ago");
});

test("weeklyTotals counts sessions and real sets across all types, oldest week first", () => {
  const s = db(
    sess("2026-11-03", "legs", [ex("Squat", [set(60, 5), set(50, 5), BLANK])]),
    sess("2026-11-04", "pull", [ex("Weighted pull ups", [set(20, 8)])]),
    sess("2026-10-28", "push", [ex("HSPU", [set(null, 5)])]),
    sess("2026-11-01", "legs", [ex("Squat", [BLANK])]),
  );
  const w = weeklyTotals(s, "2026-11-04", 8);
  assert.equal(w.length, 8);
  assert.deepEqual(w[7], { weeksAgo: 0, sessions: 2, sets: 3 });
  assert.deepEqual(w[6], { weeksAgo: 1, sessions: 1, sets: 1 });
  assert.deepEqual(w[0], { weeksAgo: 7, sessions: 0, sets: 0 });
});

/* ---------- PRs and comparing weeks ---------- */

const squatHistory = db(
  sess("2026-09-01", "legs", [ex("Squat", [set(90, 3)])]), // older than the 8-week window
  sess("2026-10-12", "legs", [ex("Squat", [set(60, 5)])]),
  sess("2026-10-28", "legs", [ex("Squat", [set(70, 8), set(60, 8)])]),
  sess("2026-11-03", "legs", [ex("Squat", [set(80, 5)])]),
);

test("the PR is the best set ever, even from before the chart window, with its date", () => {
  const st = exerciseStats(squatHistory, "Squat", "reps", "2026-11-04");
  assert.deepEqual(st.pr, { set: set(90, 3), date: "2026-09-01" });
});

test("a tied PR keeps the date he first hit it", () => {
  const s = db(sess("2026-10-01", "legs", [ex("Squat", [set(60, 5)])]), sess("2026-10-20", "legs", [ex("Squat", [set(60, 5)])]));
  assert.equal(exerciseStats(s, "Squat", "reps", "2026-11-04").pr.date, "2026-10-01");
});

test("the comparison uses the two most recent weeks he actually did it", () => {
  const st = exerciseStats(squatHistory, "Squat", "reps", "2026-11-04");
  assert.deepEqual(st.latest, { weeksAgo: 0, set: set(80, 5) });
  assert.deepEqual(st.previous, { weeksAgo: 1, set: set(70, 8) });
  assert.equal(st.trend, "up");
});

test("trend goes down, stays the same, or is null with one week of data", () => {
  const down = db(sess("2026-10-28", "pull", [ex("Muscle up", [set(null, 6)])]), sess("2026-11-03", "pull", [ex("Muscle up", [set(null, 4)])]));
  assert.equal(exerciseStats(down, "Muscle up", "reps", "2026-11-04").trend, "down");
  const same = db(sess("2026-10-28", "pull", [ex("Muscle up", [set(null, 6)])]), sess("2026-11-03", "pull", [ex("Muscle up", [set(null, 6)])]));
  assert.equal(exerciseStats(same, "Muscle up", "reps", "2026-11-04").trend, "same");
  const one = db(sess("2026-10-12", "pull", [ex("Muscle up", [set(null, 6)])]));
  const st = exerciseStats(one, "Muscle up", "reps", "2026-11-04");
  assert.equal(st.trend, null);
  assert.equal(st.previous, null);
  assert.equal(st.latest.weeksAgo, 3);
});

test("two sessions in one week count as that week's best", () => {
  const s = db(sess("2026-11-02", "legs", [ex("Squat", [set(60, 5)])]), sess("2026-11-04", "legs", [ex("Squat", [set(50, 5)])]));
  const st = exerciseStats(s, "Squat", "reps", "2026-11-04");
  assert.deepEqual(st.latest.set, set(60, 5));
  assert.equal(st.previous, null);
});

test("weekly holds each week's best, oldest first, null for weeks he skipped it", () => {
  const st = exerciseStats(squatHistory, "Squat", "reps", "2026-11-04");
  assert.equal(st.weekly.length, 8);
  assert.deepEqual(st.weekly[7], set(80, 5));
  assert.deepEqual(st.weekly[6], set(70, 8));
  assert.equal(st.weekly[5], null);
  assert.deepEqual(st.weekly[4], set(60, 5));
  assert.equal(st.weekly[0], null);
});

test("statsForType lists that type's exercises, most recently done first, skipping blanks", () => {
  const s = db(
    sess("2026-10-12", "legs", [ex("Squat", [set(60, 5)]), ex("Hips", [BLANK], "sec")]),
    sess("2026-11-03", "legs", [ex("Calves", [set(50, 10)])]),
    sess("2026-11-04", "pull", [ex("Muscle up", [set(null, 5)])]),
  );
  assert.deepEqual(statsForType(s, "legs", "2026-11-04").map((e) => e.name), ["Calves", "Squat"]);
  assert.deepEqual(statsForType(s, "push", "2026-11-04"), []);
});

test("sparkPoints: better sets sit higher, gaps are skipped, a flat line sits in the middle", () => {
  const pts = sparkPoints([null, set(60, 5), null, set(70, 5)], 300, 60, 10);
  assert.equal(pts.length, 2);
  assert.equal(pts[0].i, 1);
  assert.equal(pts[1].i, 3);
  assert.equal(pts[1].x, 290);
  assert.ok(pts[1].y < pts[0].y);
  assert.equal(sparkPoints([set(60, 5), set(60, 5)], 300, 60, 10)[0].y, 30);
  const reps = sparkPoints([set(60, 5), set(60, 6)], 300, 60, 10);
  assert.ok(reps[1].y < reps[0].y, "same weight, more reps still goes up");
  assert.deepEqual(sparkPoints([null, null], 300, 60, 10), []);
});

/* ---------- the summary when he saves a workout ---------- */

const today = (exercises) => sess("2026-11-04", "legs", exercises);

test("sessionSummary counts real sets only", () => {
  const s = today([ex("Squat", [set(60, 5), BLANK, set(50, 5)]), ex("Hips", [BLANK], "sec")]);
  assert.equal(sessionSummary(db(s), s).sets, 2);
});

test("beating the best ever is a new PR, with the set that did it", () => {
  const before = sess("2026-10-10", "legs", [ex("Squat", [set(80, 10)])]);
  const s = today([ex("Squat", [set(85, 8), set(70, 8)])]);
  assert.deepEqual(sessionSummary(db(before, s), s).prs, [{ name: "Squat", unit: "reps", set: set(85, 8) }]);
});

test("the first time ever is not a PR, because there is nothing to beat", () => {
  const s = today([ex("Squat", [set(85, 8)])]);
  assert.deepEqual(sessionSummary(db(s), s).prs, []);
});

test("matching the best is not a PR, and neither is only beating last time", () => {
  const old = sess("2026-09-01", "legs", [ex("Squat", [set(90, 3)])]);
  const last = sess("2026-10-10", "legs", [ex("Squat", [set(80, 10)])]);
  const beatsLastOnly = today([ex("Squat", [set(85, 8)])]);
  assert.deepEqual(sessionSummary(db(old, last, beatsLastOnly), beatsLastOnly).prs, []);
  const matches = today([ex("Squat", [set(90, 3)])]);
  assert.deepEqual(sessionSummary(db(old, last, matches), matches).prs, []);
});

test("later sessions don't count against a PR when looking back at an old one", () => {
  const s = sess("2026-10-10", "legs", [ex("Squat", [set(80, 10)])]);
  const earlier = sess("2026-10-01", "legs", [ex("Squat", [set(70, 10)])]);
  const later = sess("2026-11-01", "legs", [ex("Squat", [set(100, 1)])]);
  assert.equal(sessionSummary(db(earlier, s, later), s).prs.length, 1);
});

/* ---------- kg only where it belongs ---------- */

const weighted = (t) => DEFAULTS[t].filter((e) => e.weighted).map((e) => e.name);

test("in push and pull only the machine and weighted pull ups have kg; every leg exercise does", () => {
  assert.deepEqual(weighted("push"), []);
  assert.deepEqual(weighted("pull"), ["1 arm pull up, machine", "Weighted pull ups"]);
  assert.equal(weighted("legs").length, DEFAULTS.legs.length);
});

test("a blank start copies the kg rule from the default list", () => {
  const next = prefillFrom(null, "2026-11-04", "pull");
  assert.equal(next.exercises.find((e) => e.name === "Weighted pull ups").weighted, true);
  assert.equal(next.exercises.find((e) => e.name === "FL negatives").weighted, false);
});

test("starting from last time keeps each exercise's kg rule", () => {
  const last = sess("2026-10-10", "pull", [{ ...ex("Weighted dips", [set(20, 8)]), weighted: true }, { ...ex("Muscle up", [set(null, 5)]), weighted: false }]);
  const next = prefillFrom(last, "2026-11-04", "pull");
  assert.deepEqual(next.exercises.map((e) => e.weighted), [true, false]);
});

test("loading old data: default push and pull lose their kg, weighted pull ups keep theirs", () => {
  const s = db(sess("2026-11-03", "pull", [ex("FL negatives", [set(5, 3)]), ex("Weighted pull ups", [set(20, 8)])]));
  const [neg, wpu] = tidy(s)[sessionKey("2026-11-03", "pull")].exercises;
  assert.equal(neg.weighted, false);
  assert.deepEqual(neg.sets, [set(null, 3)]);
  assert.equal(wpu.weighted, true);
  assert.deepEqual(wpu.sets, [set(20, 8)]);
});

test("loading old data: an exercise he added keeps kg only if he logged some, nothing is lost", () => {
  const s = db(sess("2026-11-03", "push", [ex("Weighted dips", [set(20, 8)]), ex("Planche lean", [set(null, 20)], "sec")]));
  const [dips, lean] = tidy(s)[sessionKey("2026-11-03", "push")].exercises;
  assert.equal(dips.weighted, true);
  assert.deepEqual(dips.sets, [set(20, 8)]);
  assert.equal(lean.weighted, false);
});

test("loading old data: legs always keep kg, and a choice he already made is left alone", () => {
  const s = db(
    sess("2026-11-03", "legs", [ex("Squat", [set(60, 5)]), ex("Hips", [BLANK], "sec")]),
    sess("2026-11-04", "pull", [{ ...ex("FL negatives", [set(5, 3)]), weighted: true }]),
  );
  const out = tidy(s);
  assert.equal(out[sessionKey("2026-11-03", "legs")].exercises[1].weighted, true);
  assert.deepEqual(out[sessionKey("2026-11-04", "pull")].exercises[0].sets, [set(5, 3)]);
});

test("a phone that saved the machine without kg gets the kg field back, and it carries forward", () => {
  const old = sess("2026-11-04", "pull", [{ ...ex("1 arm pull up, machine", [set(null, 5)]), weighted: false }]);
  const loaded = tidy(db(old))[sessionKey("2026-11-04", "pull")];
  assert.equal(loaded.exercises[0].weighted, true);
  assert.deepEqual(loaded.exercises[0].sets, [set(null, 5)]);
  assert.equal(prefillFrom(loaded, "2026-11-05", "pull").exercises[0].weighted, true);
});

test("adding one back without kg drops the old kg from what it brings back", () => {
  const s = db(sess("2026-10-01", "push", [{ ...ex("Dips", [set(10, 8)]), weighted: true }]));
  const added = newExercise(s, "Dips", "reps", "2026-11-04", false);
  assert.equal(added.weighted, false);
  assert.deepEqual(added.sets, [set(null, 8)]);
  assert.deepEqual(newExercise(s, "Dips", "reps", "2026-11-04", true).sets, [set(10, 8)]);
});

test("knownExercises remembers whether something he added uses kg", () => {
  const s = db(sess("2026-10-01", "push", [{ ...ex("Weighted dips", [set(20, 8)]), weighted: true }]));
  assert.equal(knownExercises(s, "push").find((e) => e.name === "Weighted dips").weighted, true);
});

/* ---------- stopping a workout ---------- */

const KEY = sessionKey("2026-11-04", "legs");

test("stopping a workout he just started removes it completely", () => {
  const started = prefillFrom(SAMPLE, "2026-11-04", "legs");
  started.exercises[0].sets[0].kg = 999;
  const all = db(SAMPLE, started);
  const out = stopSession(all, KEY);
  assert.equal(out[KEY], undefined);
  assert.ok(out[sessionKey("2026-10-10", "legs")]);
  assert.equal(SAMPLE.exercises[0].sets[0].kg, 80);
});

test("stopping after Edit undoes the edits and keeps the saved workout", () => {
  const saved = { ...today([ex("Squat", [set(85, 8)])], "legs"), note: "strong", done: true, doneAt: "2026-11-04T18:00:00Z" };
  const editing = reopenSession(saved);
  assert.equal(editing.done, false);
  editing.exercises[0].sets[0].kg = 999;
  editing.exercises.push(ex("Mistake", [set(1, 1)]));
  editing.note = "changed";
  const restored = stopSession(db(editing), KEY)[KEY];
  assert.deepEqual(restored.exercises, [ex("Squat", [set(85, 8)])]);
  assert.equal(restored.note, "strong");
  assert.equal(restored.done, true);
  assert.equal(restored.doneAt, "2026-11-04T18:00:00Z");
  assert.equal(restored.saved, undefined);
});

test("reopening twice keeps the first saved version, not a half-edited one", () => {
  const saved = { ...today([ex("Squat", [set(85, 8)])]), done: true };
  const first = reopenSession(saved);
  first.exercises[0].sets[0].kg = 999;
  const again = reopenSession(first);
  assert.deepEqual(stopSession(db(again), KEY)[KEY].exercises, [ex("Squat", [set(85, 8)])]);
});

test("clearing everything during an edit, then reloading, brings the saved workout back", () => {
  const editing = reopenSession({ ...today([ex("Squat", [set(85, 8)])]), done: true });
  editing.exercises[0].sets[0] = set(null, null);
  const out = tidy(db(editing));
  assert.deepEqual(out[KEY].exercises[0].sets, [set(85, 8)]);
  assert.equal(out[KEY].done, true);
});
