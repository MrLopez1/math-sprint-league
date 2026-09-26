// Teacher page: create games, run them on the projector, and keep the history.
import {
  configured, auth, now, r, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
  onValue, get, set, update, remove, push, serverTimestamp
} from "./fb.js";
import { CATS, LEVELS, catName, lvlName, roundProblem, frq } from "./problems.js";
import { $, esc, seg, showOnly, sfx, sound, ordinal } from "./ui.js";

const VIEWS = ["v-setup", "v-loading", "v-signin", "v-denied", "v-home", "v-lobby", "v-live", "v-round", "v-reveal", "v-final"];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};
const cfg = { mode: "sprint", cat: "mul", level: 2, dur: 60, rounds: 10, roundSec: 20 };
try { Object.assign(cfg, JSON.parse(store.get("msl.cfg") || "{}")); } catch (e) {}

let user = null, code = null, room = null, unsub = null, tickT = null, viewKey = "";
let busy = false;           // guards finish / reveal so they run once
let qrFor = "";
const newSeed = () => Math.floor(Math.random() * 2147483647);
const modeName = m => (m === "sprint" ? "Sprint race" : "Rounds");
const settingsLabel = s => `${catName(s.cat)} · ${lvlName(s.level)} · ${s.mode === "sprint" ? `${s.dur} s sprint` : `${s.rounds} rounds of ${s.roundSec} s`}`;
const joinBase = () => new URL("./", location.href).href;

/* ---------- auth ---------- */
if (!configured) showOnly(VIEWS, "v-setup");
else onAuthStateChanged(auth, async u => {
  if (!u || u.isAnonymous) {
    user = null; $("#whoEmail").textContent = ""; $("#signOutBtn").hidden = true;
    showOnly(VIEWS, "v-signin"); return;
  }
  user = u;
  $("#whoEmail").textContent = u.email || "";
  $("#signOutBtn").hidden = false;
  try { await get(r("history")); }
  catch (e) { $("#deniedEmail").textContent = u.email || "(no email)"; showOnly(VIEWS, "v-denied"); return; }
  cleanupRooms();
  const resume = store.get("msl.host");
  if (resume) {
    try {
      const s = await get(r("rooms/" + resume));
      if (s.exists() && s.val().status !== "ended") { enterRoom(resume); return; }
    } catch (e) {}
    store.del("msl.host");
  }
  goHome();
});

$("#googleBtn").addEventListener("click", async () => {
  $("#signinErr").textContent = "";
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) {
    $("#signinErr").textContent = e && e.code === "auth/unauthorized-domain"
      ? "Firebase blocked this website. Add its domain in Firebase → Authentication → Settings → Authorized domains."
      : "Sign-in didn't finish. Try again.";
  }
});
$("#signOutBtn").addEventListener("click", async () => { leaveRoom(); await signOut(auth); });

async function cleanupRooms() {
  try {
    const s = await get(r("rooms"));
    const all = s.val() || {}, cutoff = now() - 12 * 3600 * 1000;
    for (const [c, rm] of Object.entries(all)) if (!rm || (rm.createdAt || 0) < cutoff) remove(r("rooms/" + c)).catch(() => {});
  } catch (e) {}
}

/* ---------- home: setup ---------- */
function goHome() {
  leaveRoom();
  showOnly(VIEWS, "v-home");
  selectTab("t-new");
}
function selectTab(id) {
  ["t-new", "t-history"].forEach(t => { $("#" + t).hidden = t !== id; });
  document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === id)));
  if (id === "t-history") loadHistory();
}
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) selectTab(b.dataset.tab); });

const saveCfg = () => store.set("msl.cfg", JSON.stringify(cfg));
function syncModeFields() {
  $("#durWrap").hidden = cfg.mode !== "sprint";
  $("#roundsWrap").hidden = cfg.mode === "sprint";
  $("#secWrap").hidden = cfg.mode === "sprint";
}
seg($("#modeSeg"), [{ v: "sprint", label: "Sprint race" }, { v: "rounds", label: "Rounds" }], () => cfg.mode, v => { cfg.mode = v; syncModeFields(); saveCfg(); });
seg($("#lvlSeg"), LEVELS, () => cfg.level, v => { cfg.level = +v; saveCfg(); });
seg($("#durSeg"), [30, 60, 90, 120].map(v => ({ v, label: v === 120 ? "2 min" : v + " s" })), () => cfg.dur, v => { cfg.dur = +v; saveCfg(); });
seg($("#roundsSeg"), [5, 10, 15, 20].map(v => ({ v, label: String(v) })), () => cfg.rounds, v => { cfg.rounds = +v; saveCfg(); });
seg($("#secSeg"), [10, 15, 20, 30].map(v => ({ v, label: v + " s" })), () => cfg.roundSec, v => { cfg.roundSec = +v; saveCfg(); });
$("#cats").innerHTML = CATS.map(c => `<button type="button" class="cat" data-id="${c.id}"><b>${esc(c.name)}</b><span>${esc(c.sample)}</span></button>`).join("");
const syncCats = () => document.querySelectorAll("#cats .cat").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === cfg.cat)));
$("#cats").addEventListener("click", e => { const b = e.target.closest(".cat"); if (b) { cfg.cat = b.dataset.id; syncCats(); saveCfg(); } });
syncCats(); syncModeFields();

$("#createBtn").addEventListener("click", async () => {
  const btn = $("#createBtn"); btn.disabled = true; $("#createErr").textContent = "";
  try {
    let c = "";
    for (let i = 0; i < 10; i++) {
      c = String(100000 + Math.floor(Math.random() * 900000));
      if (!(await get(r("rooms/" + c))).exists()) break;
    }
    const settings = cfg.mode === "sprint"
      ? { mode: "sprint", cat: cfg.cat, level: cfg.level, dur: cfg.dur }
      : { mode: "rounds", cat: cfg.cat, level: cfg.level, rounds: cfg.rounds, roundSec: cfg.roundSec };
    await set(r("rooms/" + c), { hostUid: user.uid, createdAt: serverTimestamp(), status: "lobby", seed: newSeed(), settings });
    store.set("msl.host", c);
    sfx.tick();
    enterRoom(c);
  } catch (e) {
    console.error(e);
    $("#createErr").textContent = "Couldn't create the game. Check the internet and the database rules.";
  } finally { btn.disabled = false; }
});

/* ---------- running a room ---------- */
function enterRoom(c) {
  leaveRoom();
  code = c;
  unsub = onValue(r("rooms/" + c), s => {
    room = s.val();
    if (!room) { store.del("msl.host"); goHome(); return; }
    render();
  });
  tickT = setInterval(tick, 200);
}
function leaveRoom() {
  if (unsub) { unsub(); unsub = null; }
  if (tickT) { clearInterval(tickT); tickT = null; }
  code = null; room = null; viewKey = ""; busy = false;
}

const playersArr = () => Object.entries(room.players || {}).map(([id, p]) => ({ id, ...p }));
const ranked = () => playersArr().sort((a, b) => (b.score || 0) - (a.score || 0) || (a.misses || 0) - (b.misses || 0) || (a.name || "").localeCompare(b.name || ""));
const online = () => playersArr().filter(p => p.online !== false);

function tick() {
  if (!room) return;
  const t = now(), s = room.settings;
  if (room.status === "playing" && s.mode === "sprint" && t > room.endAt + 1500) finish();
  if (room.status === "round" && room.round) {
    const R = room.round, ans = (room.answers && room.answers[R.key]) || {};
    const on = online();
    const all = on.length > 0 && on.every(p => ans[p.id]);
    if (t > R.endAt + 400 || (all && t > R.startAt)) reveal();
  }
  render();
}

function render() {
  if (!room) return;
  const s = room.settings, t = now();
  const key = `${room.status}|${room.seed}|${room.round ? room.round.index : ""}`;
  const changed = key !== viewKey; viewKey = key;

  if (room.status === "lobby") {
    if (changed) showOnly(VIEWS, "v-lobby");
    renderLobby();
  } else if (room.status === "playing") {
    if (changed) { showOnly(VIEWS, "v-live"); $("#liveEvent").textContent = settingsLabel(s); }
    const before = t < room.startAt, left = Math.max(0, room.endAt - t);
    const cd = $("#liveCountdown");
    cd.hidden = !before;
    if (before) { const n = Math.ceil((room.startAt - t) / 1000); if (cd.textContent !== String(n)) { cd.textContent = n; sfx.tick(); } }
    $("#liveTime").textContent = before ? s.dur : Math.ceil(left / 1000);
    $("#liveBar").style.transform = `scaleX(${before ? 1 : left / (room.endAt - room.startAt)})`;
    $("#liveInner").classList.toggle("hurry", !before && left < 10000);
    const n = playersArr().length;
    $("#liveCount").textContent = left > 0 ? `${n} ${n === 1 ? "student" : "students"} racing` : "Time! Collecting the last answers…";
    drawBars($("#liveBars"), ranked().slice(0, 12), p => p.score || 0);
  } else if (room.status === "round") {
    const R = room.round;
    if (changed) {
      showOnly(VIEWS, "v-round");
      $("#roundTitle").textContent = `Round ${R.index + 1} of ${s.rounds}`;
      $("#roundEvent").textContent = `${catName(s.cat)} · ${lvlName(s.level)}`;
      $("#roundProb").innerHTML = roundProblem(room.seed, R.index, s.cat, s.level).html;
    }
    const before = t < R.startAt, left = Math.max(0, R.endAt - t);
    const cd = $("#roundCountdown");
    cd.hidden = !before;
    if (before) { const n = Math.ceil((R.startAt - t) / 1000); if (cd.textContent !== String(n)) { cd.textContent = n; sfx.tick(); } }
    $("#roundTime").textContent = before ? s.roundSec : Math.ceil(left / 1000);
    $("#roundBar").style.transform = `scaleX(${before ? 1 : left / (R.endAt - R.startAt)})`;
    $("#roundInner").classList.toggle("hurry", !before && left < 5000);
    const ans = (room.answers && room.answers[R.key]) || {};
    const players = room.players || {};
    const done = Object.entries(ans).filter(([id]) => players[id]).sort((a, b) => a[1].ms - b[1].ms);
    $("#roundAnswered").textContent = `${done.length}/${online().length}`;
    const html = done.map(([id]) => `<span class="chip" style="padding-right:14px">${esc(players[id].name)}</span>`).join("");
    if ($("#roundChips").innerHTML !== html) $("#roundChips").innerHTML = html;
  } else if (room.status === "reveal") {
    if (changed) { showOnly(VIEWS, "v-reveal"); sfx.ok(); }
    renderReveal();
  } else if (room.status === "ended") {
    if (changed) { showOnly(VIEWS, "v-final"); sfx.win(); }
    renderFinal();
  }
}

function drawBars(el, list, val) {
  if (!list.length) { el.innerHTML = `<div class="empty">No students yet.</div>`; return; }
  const max = Math.max(1, ...list.map(val));
  const html = list.map((p, i) => `<div class="brow${i === 0 && val(p) > 0 ? " lead" : ""}">
      <span class="rank">${i + 1}</span>
      <div class="lane"><div class="fill" style="width:${(100 * val(p) / max).toFixed(1)}%"></div><span>${esc(p.name)}</span></div>
      <span class="num">${val(p)}</span></div>`).join("");
  if (el.innerHTML !== html) el.innerHTML = html;
}

function renderLobby() {
  const s = room.settings;
  $("#joinCode").textContent = code.replace(/(\d{3})(\d{3})/, "$1 $2");
  $("#joinUrl").textContent = joinBase().replace(/^https?:\/\//, "");
  $("#lobbyEvent").textContent = settingsLabel(s);
  if (qrFor !== code && window.QRCode) {
    const q = $("#qr"); q.innerHTML = "";
    try { new window.QRCode(q, { text: `${joinBase()}?code=${code}`, width: 220, height: 220 }); qrFor = code; } catch (e) {}
  }
  const list = playersArr().sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  $("#lobbyCount").textContent = list.length ? `${list.length} ${list.length === 1 ? "student" : "students"} joined` : "Waiting for students…";
  $("#startBtn").disabled = list.length === 0;
  const html = list.map(p => `<span class="chip${p.online === false ? " off" : ""}" data-id="${esc(p.id)}">${esc(p.name)}<button type="button" aria-label="Remove ${esc(p.name)}" title="Remove">×</button></span>`).join("");
  const box = $("#lobbyChips");
  if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
}
$("#lobbyChips").addEventListener("click", e => {
  const chip = e.target.closest(".chip"); if (!chip || !e.target.closest("button")) return;
  if (!chip.classList.contains("arm")) { chip.classList.add("arm"); setTimeout(() => chip.classList.remove("arm"), 3000); return; }
  remove(r(`rooms/${code}/players/${chip.dataset.id}`)).catch(() => {});
});

function renderReveal() {
  const s = room.settings, R = room.round, p = roundProblem(room.seed, R.index, s.cat, s.level);
  const last = R.index + 1 >= s.rounds;
  $("#revTitle").textContent = `Round ${R.index + 1} of ${s.rounds}`;
  $("#revSub").textContent = `${catName(s.cat)} · ${lvlName(s.level)}`;
  $("#nextBtn").textContent = last ? "Final results" : "Next round";
  const probHtml = `${p.html} = <span class="hl">${frq(p.ans)}</span>`;
  if ($("#revProb").innerHTML !== probHtml) $("#revProb").innerHTML = probHtml;
  drawBars($("#revBars"), ranked().slice(0, 8), x => x.score || 0);
  const ans = (room.answers && room.answers[R.key]) || {}, players = room.players || {};
  const fast = Object.entries(ans).filter(([id]) => players[id]).sort((a, b) => a[1].ms - b[1].ms);
  const n = playersArr().length;
  const html = fast.length
    ? `<table class="board"><tbody>${fast.slice(0, 5).map(([id, a], i) => `<tr class="${i < 3 ? "top3" : ""}"><td><span class="rank">${i + 1}</span></td><td class="nm">${esc(players[id].name)}</td><td class="r num">${(a.ms / 1000).toFixed(1)} s</td><td class="r">+${a.points}</td></tr>`).join("")}</tbody></table><p class="sub">${fast.length} of ${n} got it right</p>`
    : `<div class="empty">Nobody got this one. Worth working through it together.</div>`;
  if ($("#revFast").innerHTML !== html) $("#revFast").innerHTML = html;
}

function renderFinal() {
  const s = room.settings, list = ranked();
  $("#finEvent").textContent = settingsLabel(s);
  const unit = s.mode === "sprint" ? "correct" : "points";
  const pod = [list[1], list[0], list[2]].map((p, i) => {
    if (!p) return `<div></div>`;
    const place = [2, 1, 3][i];
    return `<div class="pod p${place}"><div class="place">${ordinal(place)}</div><div class="who">${esc(p.name)}</div><div class="num">${p.score || 0} ${unit}</div></div>`;
  }).join("");
  if ($("#podium").innerHTML !== pod) $("#podium").innerHTML = pod;
  const tbl = `<table class="board"><thead><tr><th>#</th><th>Student</th><th class="r">${s.mode === "sprint" ? "Score" : "Points"}</th><th class="r">Correct</th><th class="r">Misses</th></tr></thead><tbody>${
    list.map((p, i) => `<tr class="${i < 3 ? "top3" : ""}"><td><span class="rank">${i + 1}</span></td><td class="nm">${esc(p.name)}</td><td class="r num">${p.score || 0}</td><td class="r">${p.correct || 0}</td><td class="r">${p.misses || 0}</td></tr>`).join("")
  }</tbody></table>`;
  if ($("#finTable").innerHTML !== tbl) $("#finTable").innerHTML = tbl;
  $("#finSaved").textContent = room.historyId ? "Saved to History." : list.length ? "" : "No students played, so nothing was saved.";
}

/* ---------- actions ---------- */
async function start() {
  if (!room || room.status !== "lobby" || !playersArr().length) return;
  const s = room.settings;
  if (s.mode === "sprint") {
    const st = now() + 4000;
    await update(r("rooms/" + code), { status: "playing", startAt: st, endAt: st + s.dur * 1000 });
  } else startRound(0);
}
function startRound(i) {
  const st = now() + 3000;
  return update(r("rooms/" + code), { status: "round", round: { index: i, key: "r" + i, startAt: st, endAt: st + room.settings.roundSec * 1000 } });
}
async function reveal() {
  if (busy || room.status !== "round") return;
  busy = true;
  try { await update(r("rooms/" + code), { status: "reveal" }); } finally { busy = false; }
}
async function next() {
  if (busy || !room || room.status !== "reveal") return;
  const i = room.round.index + 1;
  if (i < room.settings.rounds) { busy = true; try { await startRound(i); } finally { busy = false; } }
  else finish();
}
async function finish() {
  if (busy || !room || room.status === "ended") return;
  busy = true;
  const c = code, rm = room;
  try {
    const list = ranked();
    let historyId = null;
    if (list.length) {
      const results = list.map((p, i) => ({ rank: i + 1, name: p.name, key: p.key || p.name.toLowerCase(), score: p.score || 0, correct: p.correct || 0, misses: p.misses || 0 }));
      const h = push(r("history"));
      historyId = h.key;
      await set(h, { code: c, endedAt: serverTimestamp(), settings: rm.settings, results });
    }
    await update(r("rooms/" + c), { status: "ended", historyId });
    store.del("msl.host");
  } catch (e) { console.error(e); }
  finally { busy = false; }
}
async function playAgain() {
  if (!room) return;
  const upd = { status: "lobby", seed: newSeed(), round: null, answers: null, startAt: null, endAt: null, historyId: null };
  for (const id of Object.keys(room.players || {})) {
    upd[`players/${id}/score`] = 0; upd[`players/${id}/correct`] = 0; upd[`players/${id}/misses`] = 0;
  }
  store.set("msl.host", code);
  await update(r("rooms/" + code), upd);
}

$("#startBtn").addEventListener("click", start);
$("#nextBtn").addEventListener("click", next);
$("#revealNowBtn").addEventListener("click", reveal);
$("#endNowBtn").addEventListener("click", () => { if (room && room.status === "playing") update(r("rooms/" + code), { endAt: Math.min(room.endAt, now()) }); });
$("#againBtn").addEventListener("click", playAgain);
$("#newGameBtn").addEventListener("click", () => { store.del("msl.host"); goHome(); });
$("#cancelBtn").addEventListener("click", async e => {
  const b = e.currentTarget;
  if (!b.dataset.arm) { b.dataset.arm = "1"; b.textContent = "Tap again to cancel"; setTimeout(() => { delete b.dataset.arm; b.textContent = "Cancel game"; }, 3000); return; }
  const c = code; store.del("msl.host"); goHome();
  remove(r("rooms/" + c)).catch(() => {});
});
document.addEventListener("keydown", e => {
  if (e.target.closest && e.target.closest("input,select,textarea")) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  if (!room) return;
  if (room.status === "lobby") { e.preventDefault(); start(); }
  else if (room.status === "reveal") { e.preventDefault(); next(); }
});

/* ---------- history ---------- */
let historyCache = {};
async function loadHistory() {
  $("#gamesList").innerHTML = `<p class="sub">Loading…</p>`;
  try { historyCache = (await get(r("history"))).val() || {}; }
  catch (e) { $("#gamesList").innerHTML = `<div class="note bad">Couldn't load the history.</div>`; return; }
  // Firebase may hand saved lists back as objects keyed "0", "1", …; turn them back into arrays.
  for (const g of Object.values(historyCache)) {
    if (g && g.results && !Array.isArray(g.results)) g.results = Object.values(g.results);
  }
  renderHistory();
}
function renderHistory() {
  const games = Object.entries(historyCache).map(([id, g]) => ({ id, ...g })).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
  const fmt = ts => new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  $("#gamesList").innerHTML = games.length ? games.map(g => {
    const res = g.results || [], w = res[0];
    return `<details class="game"><summary><b>${esc(fmt(g.endedAt))}</b><span>${esc(settingsLabel(g.settings || {}))}</span><span>${res.length} students · winner ${esc(w ? w.name : "—")}</span></summary>
      <div class="tbl" style="margin-top:8px"><table class="board"><thead><tr><th>#</th><th>Student</th><th class="r">Score</th><th class="r">Correct</th><th class="r">Misses</th></tr></thead><tbody>${
        res.map(p => `<tr class="${p.rank <= 3 ? "top3" : ""}"><td><span class="rank">${p.rank}</span></td><td class="nm">${esc(p.name)}</td><td class="r num">${p.score}</td><td class="r">${p.correct}</td><td class="r">${p.misses}</td></tr>`).join("")
      }</tbody></table></div>
      <div class="btns" style="margin-top:8px"><button class="ghost small danger" type="button" data-del="${esc(g.id)}">Delete this game</button></div></details>`;
  }).join("") : `<div class="empty">No finished games yet.</div>`;

  const m = new Map();
  for (const g of games.slice().reverse()) for (const p of g.results || []) {
    const e = m.get(p.key) || { name: p.name, games: 0, wins: 0, podiums: 0, places: 0, correct: 0, misses: 0 };
    e.name = p.name; e.games++; e.places += p.rank; e.correct += p.correct; e.misses += p.misses;
    if (p.rank === 1) e.wins++; if (p.rank <= 3) e.podiums++;
    m.set(p.key, e);
  }
  const studs = [...m.values()].sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || a.places / a.games - b.places / b.games);
  $("#studentsTbl").innerHTML = studs.length ? `<table class="board"><thead><tr><th>Student</th><th class="r">Games</th><th class="r">Wins</th><th class="r">Top 3</th><th class="r">Avg place</th><th class="r">Accuracy</th></tr></thead><tbody>${
    studs.map(s => `<tr><td class="nm">${esc(s.name)}</td><td class="r">${s.games}</td><td class="r num">${s.wins}</td><td class="r">${s.podiums}</td><td class="r">${(s.places / s.games).toFixed(1)}</td><td class="r">${s.correct + s.misses ? Math.round(100 * s.correct / (s.correct + s.misses)) + "%" : "—"}</td></tr>`).join("")
  }</tbody></table>` : `<div class="empty">Students appear here after the first finished game.</div>`;
}
$("#gamesList").addEventListener("click", async e => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  if (!b.dataset.arm) { b.dataset.arm = "1"; b.textContent = "Tap again to delete"; setTimeout(() => { delete b.dataset.arm; b.textContent = "Delete this game"; }, 3000); return; }
  try { await remove(r("history/" + b.dataset.del)); delete historyCache[b.dataset.del]; renderHistory(); } catch (err) { b.textContent = "Couldn't delete"; }
});
$("#csvBtn").addEventListener("click", () => {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["date", "format", "event", "level", "rank", "student", "score", "correct", "misses"]];
  Object.values(historyCache).sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0)).forEach(g => {
    const s = g.settings || {};
    (g.results || []).forEach(p => rows.push([new Date(g.endedAt).toISOString().slice(0, 16).replace("T", " "), modeName(s.mode), catName(s.cat), lvlName(s.level), p.rank, p.name, p.score, p.correct, p.misses]));
  });
  const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `math-sprint-results-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

/* ---------- header tools ---------- */
$("#soundBtn").addEventListener("click", e => { sound.on = !sound.on; e.currentTarget.textContent = sound.on ? "Sound on" : "Sound off"; e.currentTarget.setAttribute("aria-pressed", String(sound.on)); });
if (!document.fullscreenEnabled) $("#fsBtn").hidden = true;
$("#fsBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
});
document.addEventListener("fullscreenchange", () => { $("#fsBtn").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
