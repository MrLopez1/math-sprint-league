// Coordinate Battleship, student side.
import { now, r, onValue, set, update, push, serverTimestamp } from "./fb.js";
import { $, esc, sfx } from "./ui.js";
import {
  SHIPS, QUAD, QCOL, SPECIAL, FLEET_POINTS, K, fromK, pt, fmtSec, cellsFor, randomFleet, packFleet, unpackFleet, validFleet,
  parseCoord, shotCells, planeSVG, legendHTML, mathHTML, mkeysHTML, applyMathKey, svgPoint, whoHTML, fleetTable, invChips, standings
} from "./battle-core.js";

let code = null, uid = null, room = null;
let saved = null, unsubFleet = null;          // my fleet as stored (hidden from everyone else)
let myAnswer = null, ansFor = "", unsubAns = null;
let draft = "", armed = null, msg = "", lastCells = new Set(), sending = false;
let place = { fleet: null, sel: "car", orient: "h", hover: null };
let lastHTML = "", lastPhase = "";

function attach(c, u) {
  if (code === c && uid === u) return;
  battlePlayerDetach();
  code = c; uid = u;
  unsubFleet = onValue(r(`bships/${c}/${u}`), s => { saved = s.val() ? unpackFleet(s.val()) : null; lastHTML = ""; });
}
export function battlePlayerDetach() {
  if (unsubFleet) unsubFleet(); if (unsubAns) unsubAns();
  unsubFleet = unsubAns = null; code = uid = room = null; saved = null; myAnswer = null; ansFor = "";
  draft = ""; armed = null; msg = ""; lastCells = new Set(); place = { fleet: null, sel: "car", orient: "h", hover: null }; lastHTML = ""; lastPhase = "";
}
function watchAnswer(key) {
  if (ansFor === key) return;
  if (unsubAns) unsubAns();
  ansFor = key; myAnswer = null; draft = "";
  unsubAns = onValue(r(`banswers/${code}/${key}/${uid}`), s => { myAnswer = s.val(); lastHTML = ""; });
}

const nameOf = id => (room.players && room.players[id] && room.players[id].name) || (room.bstate.players[id] || {}).name || "?";

/* ---------------- render ---------------- */
export function battlePlayerRender(rm, c, u, el) {
  attach(c, u); room = rm;
  const b = rm.bstate;
  if (!b) { el.innerHTML = `<div class="panel narrow"><p class="sub">Getting the battle ready…</p></div>`; return; }
  const me = (b.players || {})[u];
  if (!me) { const h = `<div class="panel narrow stack"><h2>This battle started without you</h2><p class="sub">Wait for the next game, or ask your teacher.</p></div>`; if (h !== lastHTML) { el.innerHTML = h; lastHTML = h; } return; }
  if (b.roundKey) watchAnswer(b.roundKey);
  const T = b.phase, color = QCOL[me.q], ready = !!(rm.players?.[u]?.ready);
  if (T !== lastPhase) { lastPhase = T; msg = ""; if (T !== "shoot") armed = null; if (T === "place" && !place.fleet) place.fleet = saved ? { ...saved } : Object.fromEntries(SHIPS.map(s => [s.id, null])); }
  if (T === "place" && !place.fleet) place.fleet = saved ? { ...saved } : Object.fromEntries(SHIPS.map(s => [s.id, null]));

  const head = `<div class="row" style="justify-content:space-between;align-items:center"><div>${whoHTML(nameOf(u), color)} <span class="sub">· Quadrant ${QUAD[me.q].roman}</span></div><div>${invChips(me.inv)}</div></div>`;
  let side = "", placing = false;
  const myResults = Object.entries((b.results || {})[u] || {}).sort((a, c2) => (a[0] < c2[0] ? 1 : -1));
  const resultsHTML = myResults.length ? `<div><span class="label">This round</span><ul class="shotlog">${myResults.map(([, x]) => `<li class="${esc(x.cls || "")}"><b>${esc(x.label)}</b>: ${esc(x.line)}</li>`).join("")}</ul></div>` : "";
  const pending = Object.keys((rm.req || {})[u] || {}).length;

  if (me.out && T !== "over") {
    side = `<div class="panel stack">${head}<div class="note warn"><b>Your whole fleet was sunk.</b> You're out of this battle. Keep watching the board.</div></div>`;
  } else if (T === "place") {
    placing = !ready;
    const f = place.fleet, allPlaced = SHIPS.every(s => f[s.id]);
    side = `<div class="panel stack">${head}
      <div><h1>${ready ? "Ships hidden" : "Hide your ships"}</h1><p class="sub">${ready ? "Only you can see where they are. Waiting for the others and the teacher." : `Pick a ship, then tap a point in quadrant ${QUAD[me.q].roman}. Tap a placed ship to move it.`}</p></div>
      ${ready ? "" : `<div class="shiplist">${SHIPS.map(s => `<button type="button" class="shipbtn${f[s.id] ? " placed" : ""}" data-pact="selship" data-v="${s.id}" aria-pressed="${place.sel === s.id}" style="--pc:var(${color})"><span>${s.name} <span class="cells">${"<i></i>".repeat(s.len)}</span></span><span class="state">${f[s.id] ? `${pt(...f[s.id][0])} to ${pt(...f[s.id][f[s.id].length - 1])}` : "not placed"}</span></button>`).join("")}</div>
      <div class="btns"><button class="ghost" data-pact="rotate">Rotate: ${place.orient === "h" ? "horizontal ↔" : "vertical ↕"}</button><button class="ghost" data-pact="random">Random</button><button class="ghost" data-pact="clear">Clear</button></div>`}
      <div class="btns">${ready ? `<button class="ghost" data-pact="unready">Change my ships</button>` : `<button class="go" data-pact="ready" ${allPlaced ? "" : "disabled"}>Ready</button>${allPlaced ? "" : '<span class="sub">Place all 5 ships first.</span>'}`}</div>
      <div class="err">${esc(msg)}</div></div>`;
  } else if (T === "ask") {
    side = `<div class="panel stack">${head}<div><span class="label">Round ${b.round}</span><h1>Listen to the problem</h1><p class="sub">Your teacher is giving the problem. The answer box opens when the timer starts.</p></div></div>`;
  } else if (T === "answer") {
    if (myAnswer) side = `<div class="panel stack">${head}${timerBox()}<div class="note good"><b>Answer sent.</b> Waiting for the timer or the other students.</div><div class="preview m">${mathHTML(myAnswer.text)}</div></div>`;
    else side = `<div class="panel stack">${head}${timerBox()}
      <div><label class="label" for="bAns">Your answer</label><input class="text mathin" id="bAns" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Type, or use the buttons below"></div>
      ${mkeysHTML()}
      <div><span class="label">Preview</span><div class="preview m" id="bPrev"></div></div>
      <div class="btns"><button class="go" data-pact="send" ${sending ? "disabled" : ""}>Send answer</button><span class="sub">You can send only once.</span></div><div class="err">${esc(msg)}</div></div>`;
  } else if (T === "review") {
    side = `<div class="panel stack">${head}<div><span class="label">Round ${b.round}</span><h1>Your teacher is checking the answers</h1></div>${myAnswer ? `<div><span class="label">You sent</span><div class="preview m">${mathHTML(myAnswer.text)}</div></div>` : "<div class=\"note\">You didn't send an answer this round.</div>"}</div>`;
  } else if (T === "shoot") {
    const shots = me.shots || 0;
    if (shots > 0) {
      const has = Object.entries(me.inv || {}).filter(([, n]) => n > 0);
      if (armed && !(me.inv || {})[armed]) armed = null;
      side = `<div class="panel stack">${head}
        <div class="row" style="justify-content:space-between;align-items:flex-end"><div><span class="label">Shots left</span><div class="shots-left">${shots - pending}</div></div>${timerBox()}</div>
        ${has.length ? `<div><span class="label">Special ammo</span><div class="btns">${has.map(([k, n]) => `<button type="button" class="ghost${armed === k ? " on" : ""}" data-pact="arm" data-v="${k}">${armed === k ? "Using: " : "Use "}${SPECIAL[k].name}${n > 1 ? ` (×${n})` : ""}</button>`).join("")}</div>
          ${armed ? `<p class="sub" style="margin-top:6px">Next shot is a <b>${SPECIAL[armed].name}</b>: ${SPECIAL[armed].desc}. It uses 1 of your shots.</p>` : ""}</div>` : ""}
        <form class="stack" id="bFire" style="gap:8px"><label class="label" for="bCoord">Target point (x, y)</label>
          <div class="row" style="gap:8px;flex-wrap:nowrap"><input class="text" id="bCoord" autocomplete="off" placeholder="(3, −4)" style="max-width:220px;font-size:22px"><button class="go" type="submit" ${shots - pending > 0 ? "" : "disabled"}>Fire</button></div>
          <div class="err">${esc(msg)}</div></form>
        ${resultsHTML}</div>`;
    } else {
      side = `<div class="panel stack">${head}${timerBox()}
        ${myResults.length ? `<div class="note">You used all your shots.</div>${resultsHTML}` : `<div class="note">No shots for you this round. Answer the next problem right to get some.</div>`}</div>`;
    }
  } else if (T === "over") {
    const st = standings(b), pos = st.findIndex(p => p.id === u) + 1;
    side = `<div class="panel stack">${head}<div class="bigmsg">${pos === 1 ? "You won!" : `${pos}${["st", "nd", "rd"][pos - 1] || "th"} place`}</div><p class="sub">${me.hits || 0} hits landed · ${FLEET_POINTS - (me.damage || 0)} of ${FLEET_POINTS} ship points left.</p></div>`;
  }

  const owners = {};
  for (const [id, p] of Object.entries(b.players)) owners[p.q] = { name: nameOf(id), color: QCOL[p.q], out: p.out, me: id === u };
  const sunk = [];
  for (const [id, ships] of Object.entries(b.sunk || {})) if (id !== u) for (const cells of Object.values(ships)) sunk.push(cells.split("|").map(fromK));
  const myFleet = T === "place" && !ready ? place.fleet : saved;
  if (myResults[0] && myResults[0][1].cells) lastCells = new Set(myResults[0][1].cells.split("|"));
  const planeOpt = { owners, shots: b.shots || {}, sunk, myFleet, myColor: color, last: lastCells };
  if (placing) addPreview(planeOpt, me.q);

  const html = `<div class="layout player">
    <div class="a-side">${side}</div>
    <div class="a-plane planebox${placing ? " placing" : ""}" id="bPlane" data-q="${me.q}">${planeSVG(planeOpt)}${legendHTML(color)}</div>
    <div class="a-fleet panel stack"><h3>Fleets</h3><div class="tbl">${fleetTable(b, rm.players, T === "shoot")}</div></div></div>`;
  if (html !== lastHTML) {
    const fid = document.activeElement && document.activeElement.id, coordVal = $("#bCoord") ? $("#bCoord").value : "";
    el.innerHTML = html; lastHTML = html;
    const a = $("#bAns"); if (a) { a.value = draft; const pv = $("#bPrev"); if (pv) pv.innerHTML = mathHTML(draft) || '<span class="sub" style="font-size:15px">Your answer will look like this.</span>'; }
    const cIn = $("#bCoord"); if (cIn) cIn.value = coordVal;
    if (fid) { const f = document.getElementById(fid); if (f) { f.focus(); try { const n = f.value.length; f.setSelectionRange(n, n); } catch (e) {} } }
  }
  tickTimers();
}
function addPreview(o, q) {
  if (!place.hover || !place.sel) return;
  o.preview = cellsFor(q, place.fleet, place.sel, place.hover[0], place.hover[1], place.orient);
  o.hover = place.hover;
}
const timerBox = () => `<div><div class="timer" id="bptmr">0:00</div><div class="track" style="margin-top:8px"><div class="bar" id="bptmr-bar"></div></div></div>`;
function tickTimers() {
  const b = room && room.bstate; if (!b) return;
  const el = document.getElementById("bptmr"); if (!el) return;
  const left = (b.timerEnd || 0) - now(), total = (b.timerEnd || 0) - (b.timerStart || 0);
  el.textContent = fmtSec(left); el.classList.toggle("hurry", left < 10000);
  const bar = document.getElementById("bptmr-bar"); if (bar && total > 0) bar.style.transform = `scaleX(${Math.max(0, left / total)})`;
}
function redrawPlane() {
  const box = $("#bPlane"); if (!box || !room) return;
  const b = room.bstate, me = b.players[uid];
  const owners = {};
  for (const [id, p] of Object.entries(b.players)) owners[p.q] = { name: nameOf(id), color: QCOL[p.q], out: p.out, me: id === uid };
  const o = { owners, shots: b.shots || {}, sunk: [], myFleet: place.fleet, myColor: QCOL[me.q] };
  addPreview(o, me.q);
  box.querySelector("svg").outerHTML = planeSVG(o);
  lastHTML = "";
}

/* ---------------- student actions ---------------- */
const inBattle = () => room && room.bstate && room.bstate.players && room.bstate.players[uid];
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-pact]");
  if (t && inBattle()) {
    const a = t.dataset.pact, v = t.dataset.v, me = room.bstate.players[uid];
    switch (a) {
      case "selship": place.sel = v; place.fleet[v] = null; break;
      case "rotate": place.orient = place.orient === "h" ? "v" : "h"; break;
      case "random": place.fleet = randomFleet(me.q); place.sel = null; break;
      case "clear": place.fleet = Object.fromEntries(SHIPS.map(s => [s.id, null])); place.sel = "car"; break;
      case "ready":
        if (!validFleet(me.q, place.fleet)) { msg = "Some ships aren't placed correctly."; break; }
        try { await set(r(`bships/${code}/${uid}`), packFleet(place.fleet)); await update(r(`rooms/${code}/players/${uid}`), { ready: true }); sfx.ok(); msg = ""; }
        catch (err) { msg = "Couldn't save your ships. Check the internet and try again."; }
        break;
      case "unready": place.fleet = saved ? { ...saved } : place.fleet; await update(r(`rooms/${code}/players/${uid}`), { ready: false }).catch(() => {}); break;
      case "send": {
        const text = draft.trim();
        if (!text) { msg = "Write your answer first."; break; }
        if (text.length > 200) { msg = "That answer is too long."; break; }
        sending = true;
        try { await set(r(`banswers/${code}/${room.bstate.roundKey}/${uid}`), { text, t: serverTimestamp() }); sfx.ok(); msg = ""; }
        catch (err) { msg = "Couldn't send. The time may be up."; }
        sending = false;
        break;
      }
      case "arm": armed = armed === v ? null : v; break;
      default: return;
    }
    lastHTML = "";
    return;
  }
  const mk = e.target.closest("[data-mkey]");
  if (mk && $("#bAns")) { draft = applyMathKey($("#bAns"), +mk.dataset.mkey); $("#bPrev").innerHTML = mathHTML(draft) || ""; return; }
  // placing ships on the plane
  const svg = e.target.closest && e.target.closest("#bPlane svg");
  if (svg && inBattle() && room.bstate.phase === "place" && !room.players?.[uid]?.ready) {
    const me = room.bstate.players[uid], [x, y] = svgPoint(svg, e);
    const own = SHIPS.find(s => place.fleet[s.id] && place.fleet[s.id].some(c => c[0] === x && c[1] === y));
    if (own && own.id !== place.sel) { place.fleet[own.id] = null; place.sel = own.id; place.hover = [x, y]; lastHTML = ""; return; }
    if (!place.sel) return;
    const res = cellsFor(me.q, place.fleet, place.sel, x, y, place.orient);
    place.hover = [x, y];
    if (!res.ok) { redrawPlane(); return; }
    place.fleet[place.sel] = res.cells;
    const next = SHIPS.find(s => !place.fleet[s.id]);
    place.sel = next ? next.id : null; place.hover = null; lastHTML = "";
  }
});
document.addEventListener("pointermove", e => {
  const svg = e.target.closest && e.target.closest("#bPlane svg");
  if (!svg || !inBattle() || room.bstate.phase !== "place" || room.players?.[uid]?.ready) return;
  const c = svgPoint(svg, e);
  if (!place.hover || place.hover[0] !== c[0] || place.hover[1] !== c[1]) { place.hover = c; redrawPlane(); }
});
document.addEventListener("input", e => {
  if (e.target.id === "bAns") { draft = e.target.value; const pv = $("#bPrev"); if (pv) pv.innerHTML = mathHTML(draft) || ""; }
});
document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "bAns") { e.preventDefault(); document.querySelector('[data-pact="send"]')?.click(); }
  if ((e.key === "r" || e.key === "R") && inBattle() && room.bstate.phase === "place" && !(e.target.closest && e.target.closest("input"))) { place.orient = place.orient === "h" ? "v" : "h"; lastHTML = ""; }
});
document.addEventListener("submit", async e => {
  if (e.target.id !== "bFire") return;
  e.preventDefault();
  if (!inBattle()) return;
  const b = room.bstate, me = b.players[uid], inp = $("#bCoord");
  const pending = Object.keys((room.req || {})[uid] || {}).length;
  const c = parseCoord(inp.value);
  if (!c) { msg = "Write the point like (3, −4): x first, then y."; lastHTML = ""; return; }
  const [x, y] = c;
  if (Math.abs(x) > 10 || Math.abs(y) > 10) { msg = `${pt(x, y)} is off the board. x and y go from −10 to 10.`; lastHTML = ""; return; }
  if (!armed && (b.shots || {})[K(x, y)]) { msg = `${pt(x, y)} was already shot. Pick another point.`; lastHTML = ""; return; }
  if ((me.shots || 0) - pending <= 0) return;
  msg = "";
  const kind = armed || "";
  armed = null;
  inp.value = "";
  try { await set(push(r(`rooms/${code}/req/${uid}`)), { x, y, kind }); sfx.tick(); }
  catch (err) { msg = "That shot didn't go through. Time may be up."; }
  lastHTML = "";
});
