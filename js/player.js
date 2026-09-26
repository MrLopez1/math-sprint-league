// Student page: live games with a code, solo practice anytime, and the leaderboard.
import {
  configured, auth, now, r, onAuthStateChanged, signInAnonymously,
  onValue, get, set, update, remove, serverTimestamp, increment, onDisconnect
} from "./fb.js";
import { CATS, LEVELS, problemStream, roundProblem, judge, frq, catName, lvlName, makeRng } from "./problems.js";
import { $, esc, normKey, coarse, keypad, seg, showOnly, sfx, rankOf, ordinal } from "./ui.js";
import { DURS, evKey, evLabel, watchEvent, watchStudent, saveScore, bestPerStudent, boardTable, accuracy, fmtDate } from "./board.js";

const SCREENS = ["s-setup", "s-loading", "s-join", "s-practice", "s-board", "s-lobby", "s-play", "s-presult", "s-msg"];
const TABS = ["s-join", "s-practice", "s-board"];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

let uid = null;
const ansEl = $("#ans");
if (coarse) ansEl.setAttribute("inputmode", "none");

/* ======================================================================
   Screens and tabs
   ====================================================================== */
function show(id) {
  showOnly(SCREENS, id);
  const isTab = TABS.includes(id);
  $("#tabs").hidden = !isTab;
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
  if (isTab) store.set("msl.tab", id);
}
$("#tabs").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab === "s-join") showJoin(); else show(b.dataset.tab);
});

if (!configured) {
  show("s-setup"); $("#tabs").hidden = true;
} else {
  onAuthStateChanged(auth, async user => {
    if (!user) {
      try { await signInAnonymously(auth); }
      catch (e) { show("s-join"); $("#joinErr").textContent = "Could not connect. Check the internet and reload the page."; }
      return;
    }
    if (uid === user.uid) return;
    uid = user.uid;
    boot();
  });
}

async function boot() {
  const urlCode = (new URLSearchParams(location.search).get("code") || "").replace(/\D/g, "").slice(0, 6);
  const saved = store.get("msl.code");
  const nm = store.get("msl.name") || "";
  $("#name").value = nm; $("#pname").value = nm;
  $("#code").value = urlCode;
  initPractice();
  if (saved && (!urlCode || urlCode === saved)) {
    try {
      const mine = await get(r(`rooms/${saved}/players/${uid}`));
      const st = await get(r(`rooms/${saved}/status`));
      if (mine.exists() && st.exists() && st.val() !== "ended") { enter(saved); return; }
    } catch (e) { /* fall through */ }
  }
  const tab = urlCode ? "s-join" : (store.get("msl.tab") || "s-join");
  if (tab === "s-join") showJoin(); else show(tab);
}

// One name for everything; remembered on this device.
function setName(n) {
  n = n.trim().replace(/\s+/g, " ").slice(0, 24);
  store.set("msl.name", n);
  if ($("#name").value.trim() !== n) $("#name").value = n;
  if ($("#pname").value.trim() !== n) $("#pname").value = n;
  watchMine(n);
  return n;
}
$("#pname").addEventListener("change", e => setName(e.target.value));
$("#name").addEventListener("change", e => setName(e.target.value));

/* ======================================================================
   LIVE GAME
   ====================================================================== */
let code = null, room = null, me = null;
let unsubRoom = null, unsubConn = null, tickT = null, phaseKey = "";
let sp = null;   // sprint race state: {seed, next, prob, score}
let rd = null;   // round state:       {seed, idx, prob, answered, points}

function showJoin(msg) {
  leaveRoom();
  show("s-join");
  $("#joinErr").textContent = msg || "";
  $("#meTag").textContent = "";
  ($("#code").value.length === 6 ? $("#name") : $("#code")).focus();
}

$("#code").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });

$("#joinForm").addEventListener("submit", async e => {
  e.preventDefault();
  const c = $("#code").value.replace(/\D/g, "");
  const name = $("#name").value.trim().replace(/\s+/g, " ").slice(0, 24);
  const err = $("#joinErr");
  if (c.length !== 6) { err.textContent = "The game code has 6 digits."; return; }
  if (!name) { err.textContent = "Type your name."; return; }
  if (!uid) { err.textContent = "Still connecting. Try again in a moment."; return; }
  $("#joinBtn").disabled = true; err.textContent = "";
  try {
    const s = await get(r("rooms/" + c));
    if (!s.exists()) { err.textContent = "No game with that code. Check the big screen."; return; }
    const rm = s.val();
    if (rm.status === "ended") { err.textContent = "That game has ended. Ask for the new code."; return; }
    const key = normKey(name);
    const taken = Object.entries(rm.players || {}).some(([id, p]) => id !== uid && p && p.key === key);
    if (taken) { err.textContent = "Someone already joined with that name. Add your last initial."; return; }
    const prev = (rm.players || {})[uid] || {};
    await set(r(`rooms/${c}/players/${uid}`), {
      name, key, score: prev.score || 0, correct: prev.correct || 0, misses: prev.misses || 0,
      online: true, joinedAt: serverTimestamp()
    });
    store.set("msl.code", c); setName(name);
    sfx.tick();
    enter(c);
  } catch (ex) {
    console.error(ex);
    err.textContent = "Could not join. Check the internet and try again.";
  } finally {
    $("#joinBtn").disabled = false;
  }
});

function enter(c) {
  leaveRoom();
  code = c;
  const presRef = r(`rooms/${c}/players/${uid}/online`);
  unsubConn = onValue(r(".info/connected"), s => {
    if (s.val() === true && code === c) {
      try { onDisconnect(presRef).set(false); } catch (e) {}
      if (me) set(presRef, true).catch(() => {});
    }
  });
  unsubRoom = onValue(r("rooms/" + c), s => {
    room = s.val();
    if (!room) { store.del("msl.code"); showJoin("Your teacher closed that game."); return; }
    me = room.players ? room.players[uid] : null;
    if (!me) { store.del("msl.code"); showJoin("You're no longer in that game. You can join again."); return; }
    $("#meTag").textContent = `${me.name} · game ${c}`;
    render();
  }, () => showJoin("Lost the connection to the game. Join again."));
  tickT = setInterval(render, 100);
}

function leaveRoom() {
  if (unsubRoom) { unsubRoom(); unsubRoom = null; }
  if (unsubConn) { unsubConn(); unsubConn = null; }
  if (tickT) { clearInterval(tickT); tickT = null; }
  code = null; room = null; me = null; phaseKey = "";
}

$("#leaveBtn").addEventListener("click", async () => {
  const c = code;
  store.del("msl.code");
  leaveRoom();
  try { await remove(r(`rooms/${c}/players/${uid}`)); } catch (e) {}
  showJoin("");
});

function phase() {
  const t = now(), s = room.settings || {};
  if (room.status === "lobby") return "lobby";
  if (room.status === "ended") return "ended";
  if (s.mode === "sprint") {
    if (room.status !== "playing") return "lobby";
    if (t < room.startAt) return "count";
    if (t < room.endAt) return "sprint";
    return "sprintdone";
  }
  const R = room.round;
  if (!R) return "lobby";
  const answered = (rd && rd.idx === R.index && rd.seed === room.seed && rd.answered) ||
    !!(room.answers && room.answers[R.key] && room.answers[R.key][uid]);
  if (room.status === "round") {
    if (answered) return "answered";
    if (t < R.startAt) return "rcount";
    if (t < R.endAt) return "rplay";
    return "rtimeout";
  }
  if (room.status === "reveal") return "reveal";
  return "lobby";
}

const roomEventLabel = () => { const s = room.settings || {}; return `${catName(s.cat)} · ${lvlName(s.level)}`; };

function render() {
  if (!room || !me) return;
  const p = phase(), t = now(), s = room.settings || {};
  const key = `${p}|${room.seed}|${room.round ? room.round.index : ""}`;
  const changed = key !== phaseKey;
  phaseKey = key;
  const players = room.players || {};
  const n = Object.keys(players).length;

  if (p === "lobby") {
    if (changed) {
      show("s-lobby");
      $("#lobbyEvent").textContent = `${roomEventLabel()} · ${s.mode === "sprint" ? "Sprint race" : "Rounds"}`;
      $("#lobbyName").textContent = me.name;
    }
    $("#lobbyCount").textContent = n === 1 ? "1 player has joined" : `${n} players have joined`;
    return;
  }

  if (p === "count" || p === "sprint" || p === "sprintdone") {
    if (!sp || sp.seed !== room.seed) sp = { seed: room.seed, next: problemStream(room.seed, s.cat, s.level), prob: null, score: me.score || 0 };
  }
  if (["rcount", "rplay", "answered", "rtimeout", "reveal"].includes(p)) {
    const R = room.round;
    if (!rd || rd.seed !== room.seed || rd.idx !== R.index) {
      rd = { seed: room.seed, idx: R.index, prob: roundProblem(room.seed, R.index, s.cat, s.level), answered: false, points: 0 };
    }
  }

  switch (p) {
    case "count":
    case "rcount": {
      if (changed) openPlay(p === "rcount" ? { round: true } : { score: sp.score });
      const start = p === "count" ? room.startAt : room.round.startAt;
      const c = $("#count"), secs = Math.max(1, Math.ceil((start - t) / 1000));
      c.hidden = false;
      if (c.textContent !== String(secs)) { c.textContent = secs; sfx.tick(); }
      ansEl.disabled = true;
      break;
    }
    case "sprint":
    case "rplay": {
      if (changed) {
        openPlay(p === "rplay" ? { round: true } : { score: sp.score });
        $("#count").hidden = true;
        ansEl.disabled = false;
        if (p === "sprint") { if (!sp.prob) sp.prob = sp.next(); showProb(sp.prob); }
        else showProb(rd.prob);
        sfx.go();
        focusAns();
      }
      const end = p === "sprint" ? room.endAt : room.round.endAt;
      const start = p === "sprint" ? room.startAt : room.round.startAt;
      drawTimer(Math.max(0, end - t), end - start, p === "sprint" ? 10000 : 5000);
      break;
    }
    case "sprintdone": {
      const { list, pos } = rankOf(players, uid);
      showMsg({ changed, pill: "Time!", title: "Your score", big: me.score || 0,
        detail: `You're ${ordinal(pos)} of ${list.length} right now. Look at the big screen.` });
      if (changed) sfx.win();
      break;
    }
    case "answered": {
      const pts = rd.points || (room.answers?.[room.round.key]?.[uid]?.points) || 0;
      showMsg({ changed, pill: "Correct!", pillCls: "good", title: "Nice work", big: "+" + pts, detail: "Waiting for the others…" });
      break;
    }
    case "rtimeout":
      showMsg({ changed, pill: "Time's up", pillCls: "bad", title: "Waiting for the answer…", detail: "Look at the big screen." });
      break;
    case "reveal": {
      const R = room.round, mine = room.answers?.[R.key]?.[uid];
      const { list, pos } = rankOf(players, uid);
      showMsg({ changed, pill: mine ? `+${mine.points} points` : "No points this round", pillCls: mine ? "good" : "bad",
        title: `Round ${R.index + 1} of ${s.rounds}`,
        prob: `${rd.prob.html} = ${frq(rd.prob.ans)}`,
        big: me.score || 0,
        detail: `Total points · you're ${ordinal(pos)} of ${list.length}` });
      if (changed) (mine ? sfx.ok : sfx.bad)();
      break;
    }
    case "ended": {
      const { list, pos } = rankOf(players, uid);
      const extra = s.mode === "sprint" ? " This score also counts on the leaderboard." : "";
      showMsg({ changed, pill: "Game over", title: pos === 1 ? "You won!" : "Final place", big: ordinal(pos),
        detail: `${me.score || 0} ${s.mode === "sprint" ? "correct" : "points"} · ${list.length} players · ${roomEventLabel()}.${extra}` });
      if (changed) sfx.win();
      break;
    }
  }
}

function showMsg({ changed, pill, pillCls, title, big, detail, prob }) {
  if (changed) show("s-msg");
  const pe = $("#msgPill");
  pe.hidden = !pill; pe.textContent = pill || ""; pe.className = "pill" + (pillCls ? " " + pillCls : "");
  $("#msgTitle").textContent = title || "";
  const b = $("#msgBig"); b.hidden = big === undefined; b.textContent = big ?? "";
  $("#msgDetail").textContent = detail || "";
  const pr = $("#msgProb"); pr.hidden = !prob; if (prob && pr.innerHTML !== prob) pr.innerHTML = prob;
}

/* ======================================================================
   Shared play screen
   ====================================================================== */
function openPlay({ round = false, score = 0, practice = false } = {}) {
  show("s-play");
  $("#playInner").classList.remove("hurry");
  $("#fb").textContent = "";
  $("#prob").innerHTML = "&nbsp;";
  $("#fracHint").hidden = true;
  ansEl.value = "";
  $("#skipRow").hidden = round;
  $("#pQuit").hidden = !practice;
  if (round) {
    $("#hudLeft").textContent = `${room.round.index + 1}/${room.settings.rounds}`;
    $("#hudLeftLabel").textContent = "Round";
  } else {
    $("#hudLeft").textContent = score;
    $("#hudLeftLabel").textContent = "Correct";
  }
  $("#bar").style.transform = "scaleX(1)";
}
function drawTimer(left, total, hurryAt) {
  $("#hudTime").textContent = Math.ceil(left / 1000);
  $("#bar").style.transform = `scaleX(${Math.max(0, left / total)})`;
  $("#playInner").classList.toggle("hurry", left < hurryAt);
}
function showProb(p) { $("#prob").innerHTML = p.html; ansEl.value = ""; $("#fracHint").hidden = !p.frac; }
function focusAns() { if (!coarse) ansEl.focus(); }
function flash(cls) { ansEl.classList.remove("ok", "bad"); void ansEl.offsetWidth; ansEl.classList.add(cls); }

// What the answer box is answering right now.
const liveMode = () => phaseKey.split("|")[0];
function current() {
  if (pr && pr.live) return { kind: "practice", prob: pr.prob };
  const m = liveMode();
  if (code && m === "sprint" && sp && sp.prob) return { kind: "sprint", prob: sp.prob };
  if (code && m === "rplay" && rd && !rd.answered) return { kind: "round", prob: rd.prob };
  return null;
}
const meRef = () => r(`rooms/${code}/players/${uid}`);

function onCorrect(cur) {
  flash("ok"); sfx.ok(); $("#fb").textContent = "";
  if (cur.kind === "practice") {
    pr.score++; pr.streak++; pr.best = Math.max(pr.best, pr.streak);
    $("#hudLeft").textContent = pr.score;
    nextPractice();
  } else if (cur.kind === "sprint") {
    sp.score++;
    $("#hudLeft").textContent = sp.score;
    update(meRef(), { score: increment(1), correct: increment(1) }).catch(() => {});
    sp.prob = sp.next(); showProb(sp.prob);
  } else {
    const R = room.round;
    const ms = Math.max(0, now() - R.startAt), total = R.endAt - R.startAt;
    const pts = Math.max(500, Math.round(1000 - 500 * ms / total));
    rd.answered = true; rd.points = pts;
    set(r(`rooms/${code}/answers/${R.key}/${uid}`), { ms: Math.round(ms), points: pts }).catch(() => {});
    update(meRef(), { score: increment(pts), correct: increment(1) }).catch(() => {});
    render();
  }
}
function onWrong(cur) {
  flash("bad"); sfx.bad();
  $("#fb").textContent = cur.kind === "round" ? "Not quite. Try again." : "Not quite. Fix it or skip.";
  ansEl.select();
  if (cur.kind === "practice") {
    pr.misses++; pr.streak = 0;
    if (!pr.wrongOnThis) { pr.missed.push({ html: pr.prob.html, ans: pr.prob.ans, given: ansEl.value.trim() }); pr.wrongOnThis = true; }
  } else update(meRef(), { misses: increment(1) }).catch(() => {});
}
function submit() {
  const cur = current(); if (!cur) return;
  const v = ansEl.value.trim(); if (!v) return;
  const j = judge(v, cur.prob);
  if (j === "ok") onCorrect(cur);
  else if (j === "simplify") { $("#fb").textContent = "Right value. Now simplify it."; flash("bad"); }
  else onWrong(cur);
}
ansEl.addEventListener("input", () => {
  ansEl.value = ansEl.value.replace(/[^0-9\-\/−]/g, "");
  const cur = current();
  if (cur && judge(ansEl.value, cur.prob) === "ok") onCorrect(cur);
});
ansEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
keypad($("#kp"), k => {
  if (!current()) return;
  if (k === "ok") return submit();
  if (k === "del") ansEl.value = ansEl.value.slice(0, -1); else ansEl.value += k;
  ansEl.dispatchEvent(new Event("input"));
});
$("#skipBtn").addEventListener("click", () => {
  const cur = current(); if (!cur || cur.kind === "round") return;
  $("#fb").innerHTML = "Answer was " + frq(cur.prob.ans);
  if (cur.kind === "practice") {
    pr.misses++; pr.streak = 0;
    if (!pr.wrongOnThis) pr.missed.push({ html: pr.prob.html, ans: pr.prob.ans, given: "skipped" });
    nextPractice(true);
  } else {
    update(meRef(), { misses: increment(1) }).catch(() => {});
    sp.prob = sp.next(); showProb(sp.prob);
  }
  focusAns();
});
$("#s-play").addEventListener("click", e => { if (!e.target.closest("button")) focusAns(); });

/* ======================================================================
   PRACTICE (anytime) + LEADERBOARD
   ====================================================================== */
const S = { cat: "mul", level: 2, dur: 60 };
try { Object.assign(S, JSON.parse(store.get("msl.pcfg") || "{}")); } catch (e) {}
let pr = null;                 // the practice run in progress
let evRows = [], unsubEv = null, evFor = "";
let myRows = [], unsubMine = null, mineFor = "";
const syncers = [];

function initPractice() {
  $("#pcats").innerHTML = CATS.map(c => `<button type="button" class="cat" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.sample)}</span></button>`).join("");
  $("#pcats").addEventListener("click", e => { const b = e.target.closest(".cat"); if (b) setEvent({ cat: b.dataset.id }); });
  $("#bCat").innerHTML = CATS.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  $("#bCat").addEventListener("change", e => setEvent({ cat: e.target.value }));
  syncers.push(seg($("#plvl"), LEVELS, () => S.level, v => setEvent({ level: +v })));
  syncers.push(seg($("#pdur"), DURS, () => S.dur, v => setEvent({ dur: +v })));
  syncers.push(seg($("#bLvl"), LEVELS, () => S.level, v => setEvent({ level: +v })));
  syncers.push(seg($("#bDur"), DURS, () => S.dur, v => setEvent({ dur: +v })));
  setEvent({});
  watchMine(store.get("msl.name") || "");
}
function setEvent(patch) {
  Object.assign(S, patch);
  store.set("msl.pcfg", JSON.stringify(S));
  syncers.forEach(f => f());
  document.querySelectorAll("#pcats .cat").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === S.cat)));
  $("#bCat").value = S.cat;
  const ev = evKey(S.cat, S.level, S.dur);
  if (ev !== evFor) {
    if (unsubEv) unsubEv();
    evFor = ev; evRows = [];
    unsubEv = watchEvent(ev, rows => { if (evFor === ev) { evRows = rows; renderBoards(); } });
  }
  renderBoards();
}
function watchMine(name) {
  const key = name ? normKey(name) : "";
  if (key === mineFor) return;
  if (unsubMine) { unsubMine(); unsubMine = null; }
  mineFor = key; myRows = [];
  if (key) unsubMine = watchStudent(key, rows => { if (mineFor === key) { myRows = rows || []; renderBoards(); } });
  renderBoards();
}
function renderBoards() {
  const label = evLabel(S.cat, S.level, S.dur);
  const empty = `No scores yet for ${label}. Finish a sprint to set the first record.`;
  $("#pMiniTitle").textContent = label;
  $("#pMini").innerHTML = boardTable(evRows, { limit: 10, meKey: mineFor, dates: false, emptyText: empty });
  $("#bTitle").textContent = label;
  $("#bFull").innerHTML = boardTable(evRows, { limit: 50, meKey: mineFor, emptyText: empty });

  // your best in the selected event
  const ev = evKey(S.cat, S.level, S.dur);
  const mineHere = bestPerStudent(myRows.filter(x => x.event === ev))[0];
  const list = evRows ? bestPerStudent(evRows) : [];
  const pos = mineHere ? list.findIndex(x => x.key === mineFor) + 1 : 0;
  $("#pMyBest").innerHTML = !mineFor ? "Type your name to track your record."
    : mineHere ? `Your record: <b>${mineHere.score}</b>${pos ? ` · ${ordinal(pos)} of ${list.length}` : ""}`
    : "You haven't played this event yet.";

  // your records across events
  if (!mineFor) { $("#myRecSub").textContent = "Type your name on the Practice tab to see your records."; $("#myRecs").innerHTML = ""; }
  else {
    const byEv = new Map();
    for (const x of myRows) { const b = byEv.get(x.event); if (!b || x.score > b.score || (x.score === b.score && x.ts < b.ts)) byEv.set(x.event, { ...x, runs: (b ? b.runs : 0) + 1 }); else b.runs++; }
    const recs = [...byEv.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
    $("#myRecSub").textContent = recs.length ? `${myRows.length} ${myRows.length === 1 ? "sprint" : "sprints"} played as ${myRows[0].name}` : `No sprints yet as “${$("#pname").value.trim()}”.`;
    $("#myRecs").innerHTML = recs.length ? `<table class="board"><thead><tr><th>Event</th><th class="r">Record</th><th class="r">Runs</th><th class="r">Set on</th></tr></thead><tbody>${
      recs.map(x => `<tr${x.event === ev ? ' class="me"' : ""}><td>${esc(evLabel(x.cat, x.level, x.dur))}</td><td class="r num">${x.score}</td><td class="r">${x.runs}</td><td class="r">${fmtDate(x.ts)}</td></tr>`).join("")
    }</tbody></table>` : "";
  }

  // names for autocomplete
  const names = new Map();
  for (const x of evRows || []) if (!names.has(x.key)) names.set(x.key, x.name);
  const opts = [...names.values()].map(n => `<option value="${esc(n)}"></option>`).join("");
  if ($("#knownNames").innerHTML !== opts) $("#knownNames").innerHTML = opts;
}

function startPractice() {
  const name = setName($("#pname").value);
  if (!name) { $("#pnameErr").textContent = "Type your name so your score counts."; $("#pname").focus(); return; }
  $("#pnameErr").textContent = "";
  const run = pr = {
    name, key: normKey(name), cat: S.cat, level: S.level, dur: S.dur,
    next: problemStream(Math.floor(Math.random() * 2147483647), S.cat, S.level),
    prob: null, score: 0, misses: 0, streak: 0, best: 0, missed: [], wrongOnThis: false, live: false
  };
  openPlay({ score: 0, practice: true });
  $("#hudTime").textContent = run.dur;
  ansEl.disabled = true;
  const c = $("#count"); let n = 3; c.hidden = false;
  const step = () => {
    if (pr !== run) { c.hidden = true; return; }
    if (n === 0) {
      c.textContent = "Go!"; sfx.go();
      setTimeout(() => {
        c.hidden = true; if (pr !== run) return;
        run.live = true; run.start = performance.now(); run.end = run.start + run.dur * 1000;
        ansEl.disabled = false; nextPractice(); focusAns(); practiceLoop();
      }, 420);
      return;
    }
    c.textContent = n; sfx.tick(); n--; setTimeout(step, 650);
  };
  step();
}
function nextPractice(keepFeedback) {
  pr.prob = pr.next(); pr.wrongOnThis = false; showProb(pr.prob);
  if (!keepFeedback) $("#fb").textContent = "";
}
function practiceLoop() {
  if (!pr || !pr.live) return;
  const left = pr.end - performance.now();
  if (left <= 0) { finishPractice(); return; }
  drawTimer(left, pr.dur * 1000, 10000);
  pr.raf = requestAnimationFrame(practiceLoop);
}
async function finishPractice() {
  const run = pr; run.live = false; cancelAnimationFrame(run.raf); ansEl.disabled = true;
  sfx.win();
  const ev = evKey(run.cat, run.level, run.dur);
  const prior = bestPerStudent(myRows.filter(x => x.event === ev))[0];
  const rec = { name: run.name, key: run.key, event: ev, cat: run.cat, level: run.level, dur: run.dur,
    score: run.score, misses: run.misses, streak: run.best, uid, source: "practice" };
  showPracticeResult(run, rec, prior, null);
  let status = "saved";
  try { await saveScore(rec); } catch (e) { console.error(e); status = "failed"; }
  if (pr === run) showPracticeResult(run, rec, prior, status);
}
function showPracticeResult(run, rec, prior, status) {
  show("s-presult");
  $("#prEvent").textContent = evLabel(run.cat, run.level, run.dur);
  $("#prName").textContent = run.name;
  $("#prScore").textContent = run.score;
  const pace = run.score ? (run.dur / run.score).toFixed(1) + " s" : "—";
  $("#prChips").innerHTML = [["Misses", run.misses], ["Accuracy", accuracy(rec)], ["Best streak", run.best], ["Per answer", pace]]
    .map(([k, v]) => `<div class="statchip"><b>${v}</b><span>${k}</span></div>`).join("");
  const others = bestPerStudent((evRows || []).filter(x => x.key !== rec.key));
  const myBest = !prior || rec.score > prior.score ? rec : prior;
  const list = bestPerStudent(others.concat([{ ...myBest, ts: myBest.ts || Date.now() }]));
  const pos = list.findIndex(x => x.key === rec.key) + 1;
  let news;
  if (!prior) news = `Your first score in this event. You're <mark>${ordinal(pos)}</mark> of ${list.length}.`;
  else if (rec.score > prior.score) news = `New record! Up from ${prior.score}. You're <mark>${ordinal(pos)}</mark> of ${list.length}.`;
  else if (rec.score === prior.score) news = `You tied your record of ${prior.score}. You're <mark>${ordinal(pos)}</mark> of ${list.length}.`;
  else news = `Your record is ${prior.score}. ${prior.score - rec.score} more to beat it. You're <mark>${ordinal(pos)}</mark> of ${list.length}.`;
  $("#prNews").innerHTML = news;
  const missed = run.missed.slice(-8);
  $("#prMissedWrap").hidden = !missed.length;
  $("#prMissed").innerHTML = missed.map(m => `<li><div class="q">${m.html} = ${frq(m.ans)}</div><small>${m.given === "skipped" ? "Skipped" : "You typed " + esc(m.given || "—")}</small></li>`).join("");
  $("#prSaved").textContent = status === null ? "Saving…" : status === "saved" ? "Saved to the leaderboard." : "Couldn't save this score. Check the internet connection.";
}
$("#pStart").addEventListener("click", startPractice);
$("#pname").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); startPractice(); } });
$("#pQuit").addEventListener("click", () => { if (pr) { pr.live = false; cancelAnimationFrame(pr.raf); } pr = null; show("s-practice"); });
$("#prAgain").addEventListener("click", startPractice);
$("#prChange").addEventListener("click", () => { pr = null; show("s-practice"); });
$("#prBoard").addEventListener("click", () => { pr = null; show("s-board"); });
