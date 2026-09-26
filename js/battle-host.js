// Coordinate Battleship, teacher side. The teacher's screen is the referee:
// it alone can read every hidden fleet and the hidden ammo, so it settles every shot.
import { now, r, onValue, get, set, update, remove, push, serverTimestamp } from "./fb.js";
import { $, esc, sfx } from "./ui.js";
import {
  SHIPS, QUAD, QCOL, SPECIAL, FLEET_POINTS, K, fromK, pt, fmtSec, shotCells, unpackFleet, packFleet, randomFleet, validFleet,
  planeSVG, legendHTML, mathHTML, whoHTML, fleetTable, ammoChips, feedHTML, standings
} from "./battle-core.js";

const TIMES = [{ v: 30, l: "30 s" }, { v: 60, l: "1 min" }, { v: 120, l: "2 min" }, { v: 180, l: "3 min" }, { v: 300, l: "5 min" }];
const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

let code = null, room = null, hooks = {};
let fleets = {}, specials = [], answers = {}, answersFor = "", marks = {};
let unsubs = [], unsubAns = null, busy = false, lastHTML = "", showAmmo = false;

export function battleInit(h) { hooks = h || {}; }

function attach(c) {
  if (code === c && unsubs.length) return;
  battleDetach();
  code = c;
  unsubs.push(onValue(r("bships/" + c), s => {
    const v = s.val() || {};
    fleets = Object.fromEntries(Object.entries(v).map(([uid, f]) => [uid, unpackFleet(f)]));
  }));
  unsubs.push(onValue(r("bsecret/" + c), s => { specials = (s.val() && s.val().specials) || []; if (!Array.isArray(specials)) specials = Object.values(specials); }));
}
export function battleDetach() {
  unsubs.forEach(u => u()); unsubs = [];
  if (unsubAns) { unsubAns(); unsubAns = null; }
  code = null; room = null; fleets = {}; specials = []; answers = {}; answersFor = ""; marks = {}; busy = false; lastHTML = "";
}
function watchAnswers(roundKey) {
  if (answersFor === roundKey) return;
  if (unsubAns) unsubAns();
  answersFor = roundKey; answers = {}; marks = {};
  unsubAns = onValue(r(`banswers/${code}/${roundKey}`), s => { answers = s.val() || {}; });
}

const nameOf = uid => (room.players && room.players[uid] && room.players[uid].name) || (room.bstate.players[uid] || {}).name || "?";
const feedKey = () => push(r(`rooms/${code}/bstate/feed`)).key;
const aliveIds = b => Object.entries(b.players || {}).filter(([, p]) => !p.out).map(([id]) => id);

/* ---------------- starting, resetting ---------------- */
export async function battleStart(c, rm) {
  const list = Object.entries(rm.players || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0)).slice(0, 4);
  const players = {}, upd = {};
  list.forEach(([uid, p], i) => {
    players[uid] = { q: i + 1, name: p.name, out: false, shots: 0, inv: { h: 0, v: 0, sq: 0 }, hits: 0, damage: 0, correct: 0 };
    upd[`players/${uid}/ready`] = false;
  });
  // Hidden ammo: one point on the x-axis, one on the y-axis, one on a random axis (never the origin).
  const used = new Set();
  const onX = () => { let x; do x = R(1, 10) * (Math.random() < 0.5 ? -1 : 1); while (used.has(K(x, 0))); used.add(K(x, 0)); return { x, y: 0 }; };
  const onY = () => { let y; do y = R(1, 10) * (Math.random() < 0.5 ? -1 : 1); while (used.has(K(0, y))); used.add(K(0, y)); return { x: 0, y }; };
  const sp = [{ kind: "h", ...onX() }, { kind: "v", ...onY() }, { kind: "sq", ...(Math.random() < 0.5 ? onX() : onY()) }];
  await set(r("bsecret/" + c), { specials: sp });
  await remove(r("bships/" + c)).catch(() => {});
  await remove(r("banswers/" + c)).catch(() => {});
  upd.status = "battle";
  upd.req = null;
  upd.bstate = { phase: "place", round: 1, roundKey: "r1", ansSec: 60, shootSec: rm.settings.shootSec || 60, players };
  await update(r("rooms/" + c), upd);
  attach(c);
}
export async function battleReset(c, rm) {
  const upd = { status: "lobby", bstate: null, req: null, historyId: null, seed: Math.floor(Math.random() * 2147483647) };
  for (const id of Object.keys(rm.players || {})) upd[`players/${id}/ready`] = false;
  await remove(r("bships/" + c)).catch(() => {});
  await remove(r("banswers/" + c)).catch(() => {});
  await remove(r("bsecret/" + c)).catch(() => {});
  await update(r("rooms/" + c), upd);
}
export function battleCleanup(c) {
  ["bships/", "banswers/", "bsecret/"].forEach(p => remove(r(p + c)).catch(() => {}));
}

/* ---------------- game flow ---------------- */
async function setPhase(extra) { await update(r(`rooms/${code}/bstate`), extra); }
function addFeed(upd, text, cls = "") { upd[`bstate/feed/${feedKey()}`] = { text, cls }; }

async function beginRounds() {
  const b = room.bstate, upd = {};
  upd["bstate/phase"] = "ask";
  addFeed(upd, "The battle begins. All fleets are hidden.", "big");
  await update(r("rooms/" + code), upd);
}
async function autoPlace() {
  const b = room.bstate, upd = {};
  for (const [uid, p] of Object.entries(b.players)) {
    if (room.players?.[uid]?.ready && validFleet(p.q, fleets[uid])) continue;
    await set(r(`bships/${code}/${uid}`), packFleet(randomFleet(p.q)));
    upd[`players/${uid}/ready`] = true;
  }
  await update(r("rooms/" + code), upd);
}
async function startAnswering(sec) {
  const b = room.bstate, t = now(), key = "r" + b.round;
  const upd = { "bstate/phase": "answer", "bstate/roundKey": key, "bstate/ansSec": sec, "bstate/timerStart": t, "bstate/timerEnd": t + sec * 1000, "bstate/results": null };
  addFeed(upd, `Round ${b.round}: answering started (${fmtSec(sec * 1000)}).`);
  await update(r("rooms/" + code), upd);
}
async function toReview() {
  const b = room.bstate; if (b.phase !== "answer" || busy) return;
  busy = true;
  const upd = { "bstate/phase": "review" };
  addFeed(upd, `Round ${b.round}: time's up. The teacher is checking the answers.`);
  try { await update(r("rooms/" + code), upd); } finally { busy = false; }
}
async function giveShots() {
  const b = room.bstate, alive = new Set(aliveIds(b));
  const sent = Object.entries(answers).filter(([id]) => alive.has(id)).sort((a, c) => a[1].t - c[1].t);
  const correct = sent.filter(([id]) => marks[id] === true);
  const upd = {};
  correct.forEach(([id], k) => {
    upd[`bstate/players/${id}/shots`] = k === 0 ? 4 : 3;
    upd[`bstate/players/${id}/correct`] = (b.players[id].correct || 0) + 1;
  });
  if (!correct.length) {
    addFeed(upd, `Round ${b.round}: nobody answered correctly, so nobody shoots.`, "big");
    upd["bstate/round"] = b.round + 1; upd["bstate/phase"] = "ask";
  } else {
    addFeed(upd, `Round ${b.round}: ${correct.map(([id], k) => `${nameOf(id)} ${k === 0 ? 4 : 3} shots`).join(", ")}.`, "big");
    const t = now();
    upd["bstate/phase"] = "shoot"; upd["bstate/timerStart"] = t; upd["bstate/timerEnd"] = t + (b.shootSec || 60) * 1000;
  }
  marks = {};
  await update(r("rooms/" + code), upd);
}
async function endShooting(force) {
  const b = room.bstate; if (b.phase !== "shoot" || busy) return;
  busy = true;
  try {
    const upd = {};
    for (const [id, p] of Object.entries(b.players)) {
      if (p.shots > 0) addFeed(upd, `${nameOf(id)} ran out of time with ${p.shots} unused ${p.shots === 1 ? "shot" : "shots"}.`);
      upd[`bstate/players/${id}/shots`] = 0;
    }
    upd.req = null;
    if (aliveIds(b).length <= 1) { await update(r("rooms/" + code), upd); busy = false; return finishBattle(); }
    upd["bstate/round"] = b.round + 1; upd["bstate/phase"] = "ask";
    await update(r("rooms/" + code), upd);
  } finally { busy = false; }
}
async function finishBattle() {
  const b = room.bstate; if (b.phase === "over" || busy) return;
  busy = true;
  try {
    const st = standings(b);
    const upd = { "bstate/phase": "over", status: "ended", req: null };
    addFeed(upd, `${nameOf(st[0].id)} wins the battle!`, "big");
    const results = st.map((p, i) => ({ rank: i + 1, name: nameOf(p.id), key: (room.players?.[p.id]?.key) || nameOf(p.id).toLowerCase(), score: p.left, correct: p.correct || 0, misses: 0, hits: p.hits || 0 }));
    const h = push(r("history"));
    await set(h, { code, endedAt: serverTimestamp(), settings: room.settings, rounds: b.round, results });
    upd.historyId = h.key;
    for (const p of Object.values(b.players)) void p;
    await update(r("rooms/" + code), upd);
    if (hooks.onFinished) hooks.onFinished();
  } catch (e) { console.error(e); } finally { busy = false; }
}

/* ---------------- settling shots ---------------- */
async function processShots() {
  const b = room.bstate, reqs = room.req || {};
  const pending = [];
  for (const [uid, list] of Object.entries(reqs)) for (const [id, q] of Object.entries(list || {})) pending.push({ uid, id, ...q });
  if (!pending.length || busy) return;
  busy = true;
  pending.sort((a, c) => (a.id < c.id ? -1 : 1));
  // local working copies
  const shots = { ...(b.shots || {}) };
  const P = JSON.parse(JSON.stringify(b.players));
  const found = { ...(b.found || {}) };
  const sunkNow = {};
  const upd = {};
  const owners = {};
  for (const [uid, f] of Object.entries(fleets)) for (const s of SHIPS) for (const c of f[s.id] || []) owners[K(c[0], c[1])] = { uid, ship: s.id };
  const isSunk = (uid, shipId) => (fleets[uid][shipId] || []).every(c => shots[K(c[0], c[1])] && shots[K(c[0], c[1])].res === "hit");

  for (const q of pending) {
    upd[`req/${q.uid}/${q.id}`] = null;
    const me = P[q.uid], res = k => { upd[`bstate/results/${q.uid}/${q.id}`] = k; };
    const x = Math.trunc(q.x), y = Math.trunc(q.y), kind = ["h", "v", "sq"].includes(q.kind) ? q.kind : "";
    if (b.phase !== "shoot" || !me || me.out || (me.shots || 0) <= 0) { res({ label: pt(x, y), line: "No shots left.", cls: "" }); continue; }
    if (Math.abs(x) > 10 || Math.abs(y) > 10) { res({ label: pt(x, y), line: "Off the board. Not counted.", cls: "" }); continue; }
    if (kind && !((me.inv || {})[kind] > 0)) { res({ label: pt(x, y), line: "You don't have that special ammo.", cls: "" }); continue; }
    if (!kind && shots[K(x, y)]) { res({ label: pt(x, y), line: "Already shot there. Not counted.", cls: "" }); continue; }

    me.shots--; if (kind) me.inv[kind]--;
    const cells = shotCells(kind, x, y);
    let hits = 0, ownHit = null, foundKinds = [], hitName = null, misses = 0;
    for (const [cx, cy] of cells) {
      const k = K(cx, cy);
      if (shots[k]) continue;
      if (cx === 0 || cy === 0) {
        const sp = specials.find(s => s.x === cx && s.y === cy && !found[s.kind]);
        if (sp) {
          found[sp.kind] = { by: q.uid, x: cx, y: cy }; me.inv[sp.kind] = (me.inv[sp.kind] || 0) + 1;
          shots[k] = { by: q.uid, res: "special", kind: sp.kind };
          foundKinds.push(sp.kind);
          addFeed(upd, `${nameOf(q.uid)} found hidden ammo on the ${cx === 0 ? "y" : "x"}-axis at ${pt(cx, cy)}: ${SPECIAL[sp.kind].name}!`, "sp");
        } else { shots[k] = { by: q.uid, res: "miss" }; misses++; }
        continue;
      }
      const o = owners[k];
      if (o) {
        shots[k] = { by: q.uid, res: "hit", owner: o.uid };
        hits++; me.hits = (me.hits || 0) + 1; P[o.uid].damage = (P[o.uid].damage || 0) + 1;
        const own = o.uid === q.uid;
        if (own) ownHit = SHIPS.find(s => s.id === o.ship).name; else hitName = nameOf(o.uid);
        addFeed(upd, own ? `${nameOf(q.uid)} hit their own ship at ${pt(cx, cy)}!` : `${nameOf(q.uid)} hit ${nameOf(o.uid)} at ${pt(cx, cy)}.`, "hit");
        if (isSunk(o.uid, o.ship)) {
          const shipName = SHIPS.find(s => s.id === o.ship).name;
          upd[`bstate/sunk/${o.uid}/${o.ship}`] = packFleet({ [o.ship]: fleets[o.uid][o.ship] })[o.ship];
          sunkNow[o.uid] = (sunkNow[o.uid] || 0) + 1;
          addFeed(upd, own ? `${nameOf(q.uid)} sank their own ${shipName}!` : `${nameOf(q.uid)} sank ${nameOf(o.uid)}'s ${shipName}!`, "hit big");
          const allSunk = SHIPS.every(s => isSunk(o.uid, s.id));
          if (allSunk && !P[o.uid].out) { P[o.uid].out = true; P[o.uid].shots = 0; addFeed(upd, `${nameOf(o.uid)}'s whole fleet is sunk. They're out.`, "big"); }
        }
      } else { shots[k] = { by: q.uid, res: "miss" }; misses++; }
    }
    const label = kind ? `${SPECIAL[kind].name} at ${pt(x, y)}` : pt(x, y);
    let line;
    if (!kind) line = hits ? (ownHit ? `Hit your own ${ownHit}!` : `Hit! ${hitName}'s quadrant`) : foundKinds.length ? `Found special ammo: ${SPECIAL[foundKinds[0]].name}!` : "Miss";
    else line = `${hits} ${hits === 1 ? "hit" : "hits"}${foundKinds.length ? `, found ${foundKinds.map(f => SPECIAL[f].name).join(" and ")}` : ""}, ${misses} ${misses === 1 ? "miss" : "misses"}`;
    res({ label, line, cls: hits ? "hit" : foundKinds.length ? "sp" : "", cells: cells.map(c => K(c[0], c[1])).join("|") });
  }
  upd["bstate/shots"] = shots;
  upd["bstate/found"] = found;
  upd["bstate/players"] = P;
  try { await update(r("rooms/" + code), upd); }
  catch (e) { console.error(e); }
  finally { busy = false; }
  if (Object.keys(sunkNow).length) sfx.win(); else sfx.ok();
}

/* ---------------- tick ---------------- */
export function battleTick(rm, c) {
  attach(c); room = rm;
  const b = rm.bstate; if (!b) return;
  if (b.roundKey) watchAnswers(b.roundKey);
  const t = now();
  if (b.phase === "answer") {
    const alive = aliveIds(b).filter(id => rm.players?.[id]?.online !== false);
    const all = alive.length > 0 && alive.every(id => answers[id]);
    if (t >= b.timerEnd || all) toReview();
  }
  if (b.phase === "shoot") {
    if (rm.req) processShots();
    else if (!busy) {
      const alive = aliveIds(b);
      if (alive.length <= 1) finishBattle();
      else if (t >= b.timerEnd || Object.values(b.players).every(p => (p.shots || 0) <= 0)) endShooting();
    }
  }
  tickTimers();
}
function tickTimers() {
  const b = room && room.bstate; if (!b) return;
  const left = (b.timerEnd || 0) - now(), total = (b.timerEnd || 0) - (b.timerStart || 0);
  const el = document.getElementById("btmr"); if (!el) return;
  el.textContent = fmtSec(left); el.classList.toggle("hurry", left < 10000);
  const bar = document.getElementById("btmr-bar"); if (bar && total > 0) bar.style.transform = `scaleX(${Math.max(0, left / total)})`;
}

/* ---------------- screen ---------------- */
const segHTML = (act, opts, cur) => `<div class="seg">${opts.map(o => `<button type="button" data-bact="${act}" data-v="${o.v}" aria-pressed="${String(o.v) === String(cur)}">${o.l}</button>`).join("")}</div>`;
const timerBox = () => `<div><div class="timer" id="btmr">0:00</div><div class="track" style="margin-top:8px"><div class="bar" id="btmr-bar"></div></div></div>`;

export function battleRender(rm, c, el) {
  attach(c); room = rm;
  const b = rm.bstate; if (!b) return;
  const P = b.players || {}, T = b.phase;
  const who = id => whoHTML(nameOf(id), QCOL[P[id].q]);
  let side = "";
  if (T === "place") {
    const ids = Object.keys(P);
    const ready = id => rm.players?.[id]?.ready && validFleet(P[id].q, fleets[id]);
    const all = ids.every(ready);
    side = `<div class="panel stack">
      <div><h1>Students are hiding their ships</h1><p class="sub">Each student places 5 ships in their quadrant on their phone, then taps Ready.</p></div>
      <div class="chips">${ids.map(id => `<span class="chip">${who(id)} · ${QUAD[P[id].q].roman} · ${ready(id) ? "ready" : "placing…"}</span>`).join("")}</div>
      <div class="btns"><button class="go" data-bact="begin" ${all ? "" : "disabled"}>Start round 1</button>
      <button class="ghost small" data-bact="autoplace">Hide ships randomly for anyone not ready</button></div></div>`;
  } else if (T === "ask") {
    side = `<div class="panel stack">
      <div><span class="label">Round ${b.round}</span><h1>Give the class a problem</h1><p class="sub">Say it or write it on the board. When everyone has it, choose the time and start the timer. The answer box opens on the students' phones.</p></div>
      <div><span class="label">Time to answer</span>${segHTML("anssec", TIMES, b.ansSec || 60)}</div>
      <div class="btns"><button class="go" data-bact="startans">Start timer</button><button class="ghost small" data-bact="endgame">End the game now</button></div></div>`;
  } else if (T === "answer") {
    const alive = aliveIds(b), done = alive.filter(id => answers[id]);
    side = `<div class="panel stack">
      <div><span class="label">Round ${b.round} · answering</span><h2>${done.length} of ${alive.length} answered</h2></div>
      ${timerBox()}
      <div class="chips">${alive.map(id => `<span class="chip">${who(id)} ${answers[id] ? "✓ sent" : "…"}</span>`).join("")}</div>
      <div class="btns"><button class="ghost" data-bact="stopans">Stop answering now</button></div></div>`;
  } else if (T === "review") {
    const alive = new Set(aliveIds(b));
    const sent = Object.entries(answers).filter(([id]) => alive.has(id)).sort((a, c2) => a[1].t - c2[1].t);
    const none = [...alive].filter(id => !answers[id]);
    const allMarked = sent.every(([id]) => marks[id] !== undefined);
    const firstOk = sent.find(([id]) => marks[id] === true);
    side = `<div class="panel stack">
      <div><span class="label">Round ${b.round} · check the answers</span><h1>Right or wrong?</h1><p class="sub">Fastest first. The fastest correct answer gets 4 shots; every other correct answer gets 3.</p></div>
      <div>${sent.map(([id, a], k) => `<div class="ans-row"><div>${who(id)}<div class="when">${k + 1}. sent at ${fmtSec(a.t - b.timerStart)}</div></div>
        <div class="m">${mathHTML(a.text) || '<span class="sub">(empty)</span>'}</div>
        <div class="mark"><button class="ok" data-bact="mark" data-p="${esc(id)}" data-v="1" aria-pressed="${marks[id] === true}">✓ Right</button><button class="no" data-bact="mark" data-p="${esc(id)}" data-v="0" aria-pressed="${marks[id] === false}">✗ Wrong</button></div></div>
        ${marks[id] === true ? `<div class="sub" style="text-align:right">→ ${firstOk && firstOk[0] === id ? "4 shots (fastest correct)" : "3 shots"}</div>` : ""}`).join("") || '<p class="sub">Nobody sent an answer.</p>'}
        ${none.length ? `<p class="sub">No answer: ${none.map(id => esc(nameOf(id))).join(", ")} (no shots).</p>` : ""}</div>
      <div class="btns"><button class="go" data-bact="give" ${allMarked ? "" : "disabled"}>Give shots and start shooting</button>${allMarked ? "" : '<span class="sub">Mark every answer first.</span>'}</div></div>`;
  } else if (T === "shoot") {
    side = `<div class="panel stack">
      <div><span class="label">Round ${b.round} · shooting</span><h2>Students are firing</h2><p class="sub">They type coordinates on their phones. Every shot appears on the board.</p></div>
      ${timerBox()}
      <div class="btns"><button class="ghost" data-bact="stopshoot">End shooting now</button></div></div>`;
  } else if (T === "over") {
    const st = standings(b);
    side = `<div class="panel stack">
      <div><span class="label">Game over after ${b.round} ${b.round === 1 ? "round" : "rounds"}</span><div class="bigmsg" style="color:var(${QCOL[st[0].q]})">${esc(nameOf(st[0].id))} wins!</div></div>
      <table class="score"><thead><tr><th>#</th><th>Player</th><th class="r">Ship points left</th><th class="r">Hits landed</th><th class="r">Right answers</th></tr></thead><tbody>${
        st.map((p, k) => `<tr><td>${k + 1}</td><td>${who(p.id)}</td><td class="r">${p.left} of ${FLEET_POINTS}</td><td class="r">${p.hits || 0}</td><td class="r">${p.correct || 0}</td></tr>`).join("")}</tbody></table>
      <p class="sub">${rm.historyId ? "Saved to Live game history." : ""}</p>
      <div class="btns"><button class="go" data-bact="again">Play again</button><button class="ghost" data-bact="newgame">New game</button></div></div>`;
  }
  const owners = {};
  for (const [id, p] of Object.entries(P)) owners[p.q] = { name: nameOf(id), color: QCOL[p.q], out: p.out };
  const sunk = [];
  for (const ships of Object.values(b.sunk || {})) for (const cells of Object.values(ships)) sunk.push(cells.split("|").map(fromK));
  const plane = planeSVG({ owners, shots: b.shots || {}, sunk, ammo: showAmmo ? specials.filter(s => !(b.found || {})[s.kind]) : [] });
  const html = `<div class="layout">
    <div class="stack"><div class="planebox">${plane}${legendHTML(null)}</div>
      <label class="sub" style="display:inline-flex;gap:8px;align-items:center"><input type="checkbox" id="bShowAmmo" ${showAmmo ? "checked" : ""}> Show where the special ammo is hidden (don't project this)</label></div>
    <div class="stack">${side}
      <div class="panel stack"><h3>Fleets</h3>${fleetTable(b, rm.players, T === "shoot")}<h3>Hidden special ammo</h3>${ammoChips(b)}</div>
      <div class="panel stack"><h3>Battle log</h3>${feedHTML(b)}</div></div></div>`;
  if (html !== lastHTML) { el.innerHTML = html; lastHTML = html; }
  tickTimers();
}

/* ---------------- teacher actions ---------------- */
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-bact]"); if (!t || !room || !room.bstate) return;
  const a = t.dataset.bact, v = t.dataset.v, b = room.bstate;
  switch (a) {
    case "begin": return beginRounds();
    case "autoplace": return autoPlace();
    case "anssec": return setPhase({ ansSec: +v });
    case "startans": return startAnswering(b.ansSec || 60);
    case "stopans": return toReview();
    case "mark": marks[t.dataset.p] = v === "1"; lastHTML = ""; return;
    case "give": return giveShots();
    case "stopshoot": return endShooting(true);
    case "endgame": return finishBattle();
    case "again": return battleReset(code, room);
    case "newgame": if (hooks.newGame) hooks.newGame(); return;
  }
});
document.addEventListener("change", e => { if (e.target.id === "bShowAmmo") { showAmmo = e.target.checked; lastHTML = ""; } });
