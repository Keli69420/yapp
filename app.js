import {
  TYPES, sessionKey, exKey, isEmptySession, tidy, prefillFrom, lastSessionBefore,
  nextLogged, lastExerciseBefore, knownExercises, newExercise, beats, fmtSet, fmtDate, parseNum,
  weekdayName, todayIso, migrateLegacy, weeksAgoLabel, weeklyTotals, statsForType, sparkPoints,
  sessionSummary, reopenSession, stopSession, addPushups, weekPushups,
} from "./logic.js";

const KEY = "yapp.v2";
const LEGACY_KEY = "legs.v1"; // the first version's data. Read once, never deleted.
const SAVE_DELAY_MS = 300;
const ARMED_MS = 3000;
const WEEKS = 8;
const LABELS = { push: "Push", pull: "Pull", legs: "Legs" };

const main = document.getElementById("main");
const statusEl = document.getElementById("status");
const pagesEl = document.getElementById("pages");

let today = todayIso();
const loaded = load();
let sessions = loaded.sessions;
let pushups = loaded.pushups; // { "2026-11-04": 40 }, one number per day
let page = "log";
let type = startingType(loaded.lastType);
let date = today;
let adding = null; // { name, unit } while the add-exercise form is open
let pending = false;
let timer = null;

/* ---------- storage: this phone only ---------- */

function write(data, lastType, counts) {
  localStorage.setItem(KEY, JSON.stringify({ sessions: data, lastType, pushups: counts }));
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; } // storage blocked: run from memory
}

function load() {
  const raw = read(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.sessions) return { sessions: tidy(parsed.sessions), lastType: parsed.lastType, pushups: parsed.pushups ?? {} };
    } catch { /* unreadable: fall through */ }
  }
  let fresh = null;
  const legacy = read(LEGACY_KEY);
  if (legacy) {
    try { fresh = migrateLegacy(JSON.parse(legacy).days); } catch { /* unreadable: use the seed */ }
  }
  fresh = tidy(fresh ?? {});
  try { write(fresh, "legs", {}); } catch { /* same */ }
  return { sessions: fresh, lastType: "legs", pushups: {} };
}

// Whatever he is in the middle of today, otherwise whatever he picked last.
function startingType(lastType) {
  const todays = Object.values(sessions).filter((s) => s.date === today);
  todays.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  if (todays.length) return todays[0].type;
  return TYPES.includes(lastType) ? lastType : "legs";
}

// Everything saves as he types, so nothing is lost if the phone dies mid-set. The header
// only speaks up if saving fails; "Save workout" is the save he sees.
function persist() {
  clearTimeout(timer);
  timer = null;
  try {
    write(sessions, type, pushups);
    pending = false;
    statusEl.textContent = "";
    return true;
  } catch {
    statusEl.textContent = "not saved";
    return false;
  }
}

function changed() {
  const session = sessions[sessionKey(date, type)];
  if (session) session.updatedAt = new Date().toISOString();
  saveSoon();
}

function saveSoon() {
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(persist, SAVE_DELAY_MS);
}

function flush() {
  if (pending) persist();
}

/* ---------- shared bits ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => (n == null ? "" : esc(n));
const tri = (d) => `<svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
const TRI_PREV = tri("M9 1v10L1 6z");
const TRI_NEXT = tri("M1 1v10l8-5z");
const TICK = `<svg viewBox="0 0 16 12" width="16" height="12" aria-hidden="true"><path d="M1.5 6.5 6 10.5 14.5 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const typeBar = () => `
  <div class="seg" role="group" aria-label="Workout type">
    ${TYPES.map((t) => `<button type="button" class="segbtn" data-act="type" data-type="${t}" aria-pressed="${t === type}">${LABELS[t]}</button>`).join("")}
  </div>`;

function render() {
  for (const b of pagesEl.querySelectorAll("button")) {
    if (b.dataset.page === page) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  if (page === "progress") renderProgress();
  else renderLog();
}

/* ---------- page one: log ---------- */

function rowHtml(ex, i, j, set, lastSet) {
  const who = `${ex.name} set ${j + 1}`;
  const valInput = ex.unit === "sec" ? "seconds" : "reps";
  return `
    <div class="row" data-ex="${i}" data-i="${j}">
      <span class="n">${j + 1}</span>
      ${ex.weighted === false ? "" : `<input class="f" data-field="kg" type="text" inputmode="decimal" autocomplete="off" maxlength="6" aria-label="${esc(who)} kg" value="${num(set.kg)}">`}
      <input class="f" data-field="val" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="4" aria-label="${esc(who)} ${valInput}" value="${num(set.val)}">
      <span class="last"><span class="mark" title="Better than last time"${beats(set, lastSet) ? "" : " hidden"}>▲</span>${esc(fmtSet(lastSet, ex.unit))}</span>
    </div>`;
}

function blockHtml(ex, i) {
  const before = lastExerciseBefore(sessions, ex.name, ex.unit, date);
  return `
    <section class="block${ex.weighted === false ? " nokg" : ""}" data-block="${i}">
      <div class="bhead">
        <h2>${esc(ex.name)}</h2>
        <div class="bbtns">
          <div class="setpill" role="group" aria-label="${esc(ex.name)} sets">
            <button class="pillbtn" type="button" data-act="rmset" data-ex="${i}" aria-label="Remove the last ${esc(ex.name)} set"${ex.sets.length > 1 ? "" : " disabled"}>−</button>
            <span class="pilllbl">set</span>
            <button class="pillbtn" type="button" data-act="addset" data-ex="${i}" aria-label="Add a ${esc(ex.name)} set">+</button>
          </div>
          <button class="chip x" type="button" data-act="rm" data-ex="${i}" aria-label="Remove ${esc(ex.name)}">×</button>
        </div>
      </div>
      <div class="cols">
        <span></span>
        ${ex.weighted === false ? "" : `<span class="r">kg</span>`}
        <span class="r">${ex.unit === "sec" ? "sec" : "reps"}</span>
        <span class="r">last</span>
      </div>
      ${ex.sets.map((set, j) => rowHtml(ex, i, j, set, before?.sets[j] ?? null)).join("")}
    </section>`;
}

function addFormHtml(session) {
  const taken = new Set(session.exercises.map((e) => exKey(e.name, e.unit)));
  const options = knownExercises(sessions, type).filter((e) => !taken.has(exKey(e.name, e.unit)));
  return `
    <form class="block addform" id="addform" novalidate>
      <label class="fld"><span class="lbl">Exercise</span>
        <input class="t" id="newname" list="known" autocomplete="off" autocapitalize="sentences" enterkeyhint="done" maxlength="40" value="${esc(adding.name)}">
      </label>
      <datalist id="known">${options.map((e) => `<option value="${esc(e.name)}"></option>`).join("")}</datalist>
      <div class="seg tight" role="group" aria-label="Measured in">
        <button type="button" class="segbtn" data-act="unit" data-unit="reps" aria-pressed="${adding.unit === "reps"}">Reps</button>
        <button type="button" class="segbtn" data-act="unit" data-unit="sec" aria-pressed="${adding.unit === "sec"}">Seconds</button>
      </div>
      <p class="formerr" id="adderr" role="alert"></p>
      <div class="formbtns">
        <button type="button" class="chip kgtoggle" data-act="kgtoggle" aria-pressed="${adding.weighted}">With kg</button>
        <button type="button" class="chip" data-act="canceladd">Cancel</button>
        <button type="submit" class="chip solid">Add</button>
      </div>
    </form>`;
}

function savedCardHtml(session) {
  const { sets, prs } = sessionSummary(sessions, session);
  const bits = [count(sets, "set")];
  if (prs.length) bits.push(count(prs.length, "new PR"));
  return `
    <section class="block saved">
      <div class="bhead">
        <span class="knob small">${TICK}</span>
        <div class="savedtext">
          <h2>${LABELS[session.type]} saved</h2>
          <span class="lbl">${bits.join(" · ")}</span>
        </div>
        <button class="chip" type="button" data-act="reopen">Edit</button>
      </div>
      ${prs.map((p) => `<div class="savedpr"><span class="prtag">PR</span><span class="savedname">${esc(p.name)}</span><span class="prval">${esc(fmtSet(p.set, p.unit))}</span></div>`).join("")}
      <p class="savednext">Next time starts from these numbers.</p>
    </section>`;
}

function counterHtml() {
  const n = pushups[date] ?? 0;
  return `
    <section class="counter" aria-label="Push up counter">
      <div class="countinfo">
        <span class="lbl">${date === today ? "Push ups today" : "Push ups"}</span>
        <span class="countnum" id="pucount">${n}</span>
      </div>
      <div class="countbtns">
        <button type="button" data-act="pu" data-by="-1" id="puminus" aria-label="One push up less"${n ? "" : " disabled"}>−1</button>
        <button type="button" data-act="pu" data-by="10" aria-label="Add 10 push ups">+10</button>
        <button type="button" data-act="pu" data-by="1" aria-label="Add 1 push up">+1</button>
      </div>
    </section>`;
}

function renderLog() {
  const session = sessions[sessionKey(date, type)] ?? null;
  const last = lastSessionBefore(sessions, type, date);
  const next = nextLogged(sessions, type, date, today);
  const ghost = !session;
  const finished = Boolean(session?.done) && date === today;
  const shown = session ?? prefillFrom(last, date, type, sessions);

  main.innerHTML = `
    <section class="hero">
      <div class="date">${fmtDate(date)}</div>
      <div class="day">${date === today ? "Today" : weekdayName(date)}</div>
      <div class="lastbar">
        <div class="lastinfo">
          <span class="lbl">Last ${LABELS[type].toLowerCase()}</span>
          <span class="lastdate">${last ? fmtDate(last.date) : "None yet"}</span>
        </div>
        <div class="nav">
          <button type="button" data-act="go" data-to="${last?.date ?? ""}" aria-label="Earlier ${type} session"${last ? "" : " disabled"}>${TRI_PREV}</button>
          <button type="button" data-act="go" data-to="${next ?? ""}" aria-label="Later ${type} session"${next ? "" : " disabled"}>${TRI_NEXT}</button>
        </div>
      </div>
    </section>
    ${counterHtml()}
    ${typeBar()}
    ${ghost ? `<button class="start" type="button" data-act="start"><span>${last ? "Start from last time" : "Start"}</span><span class="knob">${TRI_NEXT}</span></button>` : ""}
    ${ghost || adding || finished ? "" : `
      <div class="exbar">
        ${date === today ? `<button class="chip" type="button" data-act="stop" data-confirm="${session.saved ? "Tap again to undo edits" : "Tap again to discard"}">${session.saved ? "Stop editing" : "Stop workout"}</button>` : ""}
        <button class="chip add" type="button" data-act="openadd">+ exercise</button>
      </div>`}
    ${adding && session ? addFormHtml(session) : ""}
    ${ghost ? `<ul class="exlist">${shown.exercises.map((ex) => `<li>${esc(ex.name)}</li>`).join("")}</ul>` : ""}
    ${ghost ? "" : finished ? savedCardHtml(session) : `
      <div class="blocks">
        ${shown.exercises.map((ex, i) => blockHtml(ex, i)).join("")}
      </div>`}
    ${ghost || finished ? "" : `
      <label class="notes"><span>Notes</span><textarea id="note" rows="2">${esc(session.note ?? "")}</textarea></label>
      ${date === today ? `
        <button class="start" type="button" data-act="finish"><span>Save workout</span><span class="knob">${TICK}</span></button>
        <p class="formerr center" id="finisherr" role="alert"></p>` : ""}
      ${date !== today || session.saved ? `<button class="textbtn" type="button" data-act="delete">Delete this session</button>` : ""}`}`;
}

/* ---------- page two: progress ---------- */

function tileHtml(value, one, many, diff, wide = false) {
  const delta = diff > 0 ? `▲ ${diff}` : diff < 0 ? `▼ ${-diff}` : "Same";
  return `
    <div class="tile${wide ? " wide" : ""}">
      <div class="big">${value}</div>
      <div class="lbl">${value === 1 ? one : many}</div>
      <div class="delta">${delta} vs last wk</div>
    </div>`;
}

function barsHtml(totals) {
  const max = Math.max(1, ...totals.map((t) => t.sets));
  return `
    <div class="chart" data-chart>
      <div class="clabel">Sets per week</div>
      <div class="bars" role="group" aria-label="Sets per week, last ${WEEKS} weeks">
        ${totals.map((t, i) => {
          const say = `${weeksAgoLabel(t.weeksAgo)} · ${count(t.sets, "set")}, ${count(t.sessions, "session")}`;
          return `<button type="button" class="bar${t.weeksAgo === 0 ? " on" : ""}" data-read="${esc(say)}" data-i="${i}" data-dot="${i}" aria-label="${esc(say)}"><i style="height:${Math.round((t.sets / max) * 100)}%"></i></button>`;
        }).join("")}
      </div>
      <div class="axis"><span class="read">${weeksAgoLabel(WEEKS - 1)}</span><span>this wk</span></div>
    </div>`;
}

function sparkHtml(st) {
  const W = 300, H = 56, PAD = 10;
  const pts = sparkPoints(st.weekly, W, H, PAD);
  if (!pts.length) return `<p class="none">Not done in the last ${WEEKS} weeks.</p>`;
  const step = (W - 2 * PAD) / (WEEKS - 1);
  const lastI = pts[pts.length - 1].i;
  const says = st.weekly.map((s, i) => `${weeksAgoLabel(WEEKS - 1 - i)} · ${s ? fmtSet(s, st.unit) : "not done"}`);
  return `
    <div class="chart spark" data-chart>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${st.name}, best set per week: ${says.join(", ")}`)}">
        ${pts.length > 1 ? `<polyline points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}"/>` : ""}
        ${pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="5" data-dot="${p.i}"${p.i === lastI ? ' class="on"' : ""}/>`).join("")}
        ${says.map((say, i) => `<rect x="${PAD + i * step - step / 2}" y="0" width="${step}" height="${H}" fill="transparent" data-read="${esc(say)}" data-i="${i}"><title>${esc(say)}</title></rect>`).join("")}
      </svg>
      <div class="axis"><span class="read">${weeksAgoLabel(WEEKS - 1)}</span><span>this wk</span></div>
    </div>`;
}

function statCardHtml(st) {
  const arrow = { up: "▲", down: "▼", same: "=" }[st.trend] ?? "";
  const word = { up: "better", down: "worse", same: "the same" }[st.trend] ?? "";
  const cell = (c) => `<div class="cell"><span class="lbl">${weeksAgoLabel(c.weeksAgo)}</span><span class="val">${esc(fmtSet(c.set, st.unit))}</span></div>`;
  return `
    <section class="block pcard">
      <div class="bhead">
        <h2>${esc(st.name)}</h2>
        <div class="pr"><span class="prtag">PR</span><span class="prval">${esc(fmtSet(st.pr.set, st.unit))}</span></div>
      </div>
      <div class="prdate">${fmtDate(st.pr.date)}</div>
      <div class="cmp${st.previous ? "" : " one"}">
        ${cell(st.latest)}
        ${st.previous ? `<div class="arrow ${st.trend}" role="img" aria-label="${word}">${arrow}</div>${cell(st.previous)}` : ""}
      </div>
      ${sparkHtml(st)}
    </section>`;
}

function renderProgress() {
  const totals = weeklyTotals(sessions, today, WEEKS);
  const now = totals[WEEKS - 1];
  const before = totals[WEEKS - 2];
  const stats = statsForType(sessions, type, today, WEEKS);
  main.innerHTML = `
    <section class="hero">
      <div class="ptitle">This week</div>
      <div class="tiles">
        ${tileHtml(now.sessions, "session", "sessions", now.sessions - before.sessions)}
        ${tileHtml(now.sets, "set", "sets", now.sets - before.sets)}
        ${tileHtml(weekPushups(pushups, today, 0), "push up", "push ups", weekPushups(pushups, today, 0) - weekPushups(pushups, today, 1), true)}
      </div>
      ${barsHtml(totals)}
    </section>
    ${typeBar()}
    <div class="blocks">
      ${stats.length ? stats.map(statCardHtml).join("") : `<section class="block empty">No ${LABELS[type].toLowerCase()} sessions yet. Log one and the PRs show up here.</section>`}
    </div>`;
}

/* ---------- actions ---------- */

// Removing is two taps with no pop-up: the first arms the button, the second does it.
function armed(btn, label) {
  if (btn.dataset.armed) return true;
  const was = btn.textContent;
  btn.dataset.armed = "1";
  btn.textContent = label;
  btn.classList.add("armed");
  setTimeout(() => {
    if (!btn.isConnected) return;
    delete btn.dataset.armed;
    btn.textContent = was;
    btn.classList.remove("armed");
  }, ARMED_MS);
  return false;
}

function showAddChoices() {
  for (const b of main.querySelectorAll('[data-act="unit"]')) b.setAttribute("aria-pressed", String(b.dataset.unit === adding.unit));
  main.querySelector('[data-act="kgtoggle"]')?.setAttribute("aria-pressed", String(adding.weighted));
}

const focusField = (ex, set) => main.querySelector(`.row[data-ex="${ex}"][data-i="${set}"] .f`)?.focus();

function showRead(el) {
  const chart = el.closest("[data-chart]");
  if (!chart) return;
  chart.querySelector(".read").textContent = el.dataset.read;
  for (const d of chart.querySelectorAll("[data-dot]")) d.classList.toggle("on", d.dataset.dot === el.dataset.i);
}

main.addEventListener("click", (e) => {
  const read = e.target.closest("[data-read]");
  if (read) { showRead(read); return; }
  const btn = e.target.closest("button[data-act]");
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const key = sessionKey(date, type);
  const session = sessions[key];

  if (act === "type") {
    flush();
    type = btn.dataset.type;
    date = today;
    adding = null;
    try { write(sessions, type, pushups); } catch { /* remembering the tab is not worth an error */ }
    render();
  } else if (act === "go") {
    flush();
    date = btn.dataset.to;
    adding = null;
    render();
    document.body.scrollTo(0, 0);
  } else if (act === "start") {
    sessions[key] = prefillFrom(lastSessionBefore(sessions, type, date), date, type, sessions);
    changed();
    render();
    // Ask the browser not to clear this site's storage when space runs low.
    navigator.storage?.persist?.().catch(() => {});
  } else if (act === "pu") {
    // No redraw, so the page stays exactly where it is while he taps.
    pushups = addPushups(pushups, date, Number(btn.dataset.by));
    saveSoon();
    document.getElementById("pucount").textContent = pushups[date] ?? 0;
    document.getElementById("puminus").disabled = !pushups[date];
  } else if (act === "rmset") {
    const sets = session.exercises[Number(btn.dataset.ex)].sets;
    if (sets.length > 1) {
      sets.pop();
      changed();
      render();
    }
  } else if (act === "addset") {
    const ex = Number(btn.dataset.ex);
    const sets = session.exercises[ex].sets;
    sets.push({ kg: null, val: null });
    changed();
    render();
    focusField(ex, sets.length - 1);
  } else if (act === "rm") {
    if (!armed(btn, "Remove?")) return;
    session.exercises.splice(Number(btn.dataset.ex), 1);
    if (!session.exercises.length) delete sessions[key];
    changed();
    render();
  } else if (act === "delete") {
    if (!armed(btn, "Tap again to delete")) return;
    delete sessions[key];
    date = today;
    changed();
    render();
    document.body.scrollTo(0, 0);
  } else if (act === "finish") {
    if (isEmptySession(session)) {
      document.getElementById("finisherr").textContent = "Nothing logged yet.";
      return;
    }
    const before = session.saved;
    session.done = true;
    delete session.saved;
    session.updatedAt = new Date().toISOString();
    // Only say it's saved if it really is.
    if (!persist()) {
      session.done = false;
      if (before) session.saved = before;
      document.getElementById("finisherr").textContent = "Couldn't save on this phone. Try again.";
      return;
    }
    render();
    document.body.scrollTo(0, 0);
  } else if (act === "reopen") {
    sessions[key] = reopenSession(session);
    changed();
    render();
  } else if (act === "stop") {
    if (!armed(btn, btn.dataset.confirm)) return;
    sessions = stopSession(sessions, key);
    persist();
    render();
    document.body.scrollTo(0, 0);
  } else if (act === "openadd") {
    adding = { name: "", unit: "reps", weighted: type === "legs" };
    render();
    document.getElementById("newname")?.focus();
  } else if (act === "canceladd") {
    adding = null;
    render();
  } else if (act === "unit") {
    adding.unit = btn.dataset.unit;
    showAddChoices();
  } else if (act === "kgtoggle") {
    adding.weighted = !adding.weighted;
    showAddChoices();
  }
});

// On a computer, hovering a week reads it out too.
main.addEventListener("mouseover", (e) => {
  const read = e.target.closest("[data-read]");
  if (read) showRead(read);
});

main.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = adding.name.trim();
  if (!name) {
    document.getElementById("adderr").textContent = "Type a name first.";
    document.getElementById("newname").focus();
    return;
  }
  const { unit, weighted } = adding;
  adding = null;
  const session = sessions[sessionKey(date, type)];
  const found = session.exercises.findIndex((x) => exKey(x.name, x.unit) === exKey(name, unit));
  if (found !== -1) {
    // Already in this session: take him there instead of adding it twice.
    render();
    main.querySelector(`[data-block="${found}"]`)?.scrollIntoView({ block: "center" });
    focusField(found, 0);
    return;
  }
  session.exercises.unshift(newExercise(sessions, name, unit, date, weighted));
  changed();
  render();
  focusField(0, 0);
});

main.addEventListener("input", (e) => {
  const el = e.target;
  if (el.id === "newname") {
    adding.name = el.value;
    document.getElementById("adderr").textContent = "";
    const match = knownExercises(sessions, type).find((k) => k.name.toLowerCase() === el.value.trim().toLowerCase());
    if (match) {
      adding.unit = match.unit;
      adding.weighted = match.weighted;
      showAddChoices();
    }
    return;
  }
  const session = sessions[sessionKey(date, type)];
  if (el.id === "note") {
    session.note = el.value;
    changed();
    return;
  }
  if (!el.matches(".f")) return;
  const rowEl = el.closest(".row");
  const ex = session.exercises[Number(rowEl.dataset.ex)];
  const i = Number(rowEl.dataset.i);
  ex.sets[i][el.dataset.field] = parseNum(el.value);
  const before = lastExerciseBefore(sessions, ex.name, ex.unit, date);
  rowEl.querySelector(".mark").hidden = !beats(ex.sets[i], before?.sets[i] ?? null);
  changed();
});

// Tapping a pre-filled number selects it, so typing replaces it. That is the whole
// point of the screen: overtype what changed, leave the rest. Safari puts the caret
// down on mouseup, so that first mouseup has to be cancelled too.
let justFocused = null;
main.addEventListener("focusin", (e) => {
  if (!e.target.matches(".f")) return;
  justFocused = e.target;
  e.target.setSelectionRange(0, e.target.value.length);
});
main.addEventListener("mouseup", (e) => {
  if (e.target === justFocused) {
    e.preventDefault();
    e.target.setSelectionRange(0, e.target.value.length);
  }
  justFocused = null;
});

// A field that doesn't hold a number goes blank when he leaves it, matching what was saved.
main.addEventListener("focusout", (e) => {
  if (e.target.matches(".f") && parseNum(e.target.value) === null) e.target.value = "";
});

pagesEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-page]");
  if (!btn || btn.dataset.page === page) return;
  flush();
  page = btn.dataset.page;
  adding = null;
  render();
  document.body.scrollTo(0, 0);
});

/* ---------- staying right when the app comes back ---------- */

function checkRollover() {
  const now = todayIso();
  if (now === today) return;
  flush();
  if (date === today) date = now;
  today = now;
  render();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) flush();
  else checkRollover();
});
window.addEventListener("pagehide", flush);
window.addEventListener("pageshow", checkRollover);

render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
