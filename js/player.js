// Student page: join with a code, then play whatever the teacher's screen runs.
import {
  configured, auth, now, r, onAuthStateChanged, signInAnonymously,
  onValue, get, set, update, remove, serverTimestamp, increment, onDisconnect
} from "./fb.js";
import { problemStream, roundProblem, judge, frq, catName, lvlName } from "./problems.js";
import { $, normKey, coarse, keypad, showOnly, sfx, rankOf, ordinal } from "./ui.js";

const SCREENS = ["s-setup", "s-loading", "s-join", "s-lobby", "s-play", "s-msg"];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

let uid = null, code = null, room = null, me = null;
let unsubRoom = null, unsubConn = null, tickT = null, phaseKey = "";
let sp = null;   // sprint state: {seed, next, prob, score}
let rd = null;   // round state:  {seed, idx, prob, answered, points}
const ansEl = $("#ans");
if (coarse) ansEl.setAttribute("inputmode", "none");

if (!configured) {
  showOnly(SCREENS, "s-setup");
} else {
  onAuthStateChanged(auth, async user => {
    if (!user) {
      try { await signInAnonymously(auth); }
      catch (e) { showOnly(SCREENS, "s-join"); $("#joinErr").textContent = "Could not connect. Check the internet and reload the page."; }
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
  $("#name").value = store.get("msl.name") || "";
  $("#code").value = urlCode;
  if (saved && (!urlCode || urlCode === saved)) {
    try {
      const mine = await get(r(`rooms/${saved}/players/${uid}`));
      const st = await get(r(`rooms/${saved}/status`));
      if (mine.exists() && st.exists() && st.val() !== "ended") { enter(saved); return; }
    } catch (e) { /* fall through to join */ }
  }
  showJoin();
}

function showJoin(msg) {
  leaveRoom();
  showOnly(SCREENS, "s-join");
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
    store.set("msl.code", c); store.set("msl.name", name);
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

/* ---------- state machine ---------- */
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

function eventLabel() {
  const s = room.settings || {};
  return `${catName(s.cat)} · ${lvlName(s.level)}`;
}

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
      showOnly(SCREENS, "s-lobby");
      $("#lobbyEvent").textContent = `${eventLabel()} · ${s.mode === "sprint" ? "Sprint race" : "Rounds"}`;
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
      if (changed) openPlay(p === "rcount");
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
        openPlay(p === "rplay");
        $("#count").hidden = true;
        ansEl.disabled = false;
        if (p === "sprint") { if (!sp.prob) sp.prob = sp.next(); showProb(sp.prob); }
        else showProb(rd.prob);
        sfx.go();
        focusAns();
      }
      const end = p === "sprint" ? room.endAt : room.round.endAt;
      const start = p === "sprint" ? room.startAt : room.round.startAt;
      const left = Math.max(0, end - t);
      $("#hudTime").textContent = Math.ceil(left / 1000);
      $("#bar").style.transform = `scaleX(${left / (end - start)})`;
      $("#playInner").classList.toggle("hurry", left < (p === "sprint" ? 10000 : 5000));
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
      showMsg({ changed, pill: "Correct!", pillCls: "good", title: "Nice work", big: "+" + pts,
        detail: "Waiting for the others…" });
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
      showMsg({ changed, pill: "Game over", title: pos === 1 ? "You won!" : "Final place", big: ordinal(pos),
        detail: `${me.score || 0} ${s.mode === "sprint" ? "correct" : "points"} · ${list.length} players · ${eventLabel()}` });
      if (changed) sfx.win();
      break;
    }
  }
}

function openPlay(isRound) {
  showOnly(SCREENS, "s-play");
  $("#playInner").classList.remove("hurry");
  $("#fb").textContent = "";
  $("#prob").innerHTML = "&nbsp;";
  $("#fracHint").hidden = true;
  ansEl.value = "";
  $("#skipRow").hidden = isRound;
  if (isRound) {
    $("#hudLeft").textContent = `${room.round.index + 1}/${room.settings.rounds}`;
    $("#hudLeftLabel").textContent = "Round";
  } else {
    $("#hudLeft").textContent = sp.score;
    $("#hudLeftLabel").textContent = "Correct";
  }
  $("#bar").style.transform = "scaleX(1)";
}

function showMsg({ changed, pill, pillCls, title, big, detail, prob }) {
  if (changed) showOnly(SCREENS, "s-msg");
  const pe = $("#msgPill");
  pe.hidden = !pill; pe.textContent = pill || ""; pe.className = "pill" + (pillCls ? " " + pillCls : "");
  $("#msgTitle").textContent = title || "";
  const b = $("#msgBig"); b.hidden = big === undefined; b.textContent = big ?? "";
  $("#msgDetail").textContent = detail || "";
  const pr = $("#msgProb"); pr.hidden = !prob; if (prob && pr.innerHTML !== prob) pr.innerHTML = prob;
}

/* ---------- answering ---------- */
const mode = () => phaseKey.split("|")[0];
function currentProb() {
  const m = mode();
  if (m === "sprint") return sp && sp.prob;
  if (m === "rplay") return rd && !rd.answered ? rd.prob : null;
  return null;
}
function showProb(p) { $("#prob").innerHTML = p.html; ansEl.value = ""; $("#fracHint").hidden = !p.frac; }
function focusAns() { if (!coarse) ansEl.focus(); }
function flash(cls) { ansEl.classList.remove("ok", "bad"); void ansEl.offsetWidth; ansEl.classList.add(cls); }
const meRef = () => r(`rooms/${code}/players/${uid}`);

function onCorrect() {
  flash("ok"); sfx.ok(); $("#fb").textContent = "";
  if (mode() === "sprint") {
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
function onWrong() {
  flash("bad"); sfx.bad();
  $("#fb").textContent = mode() === "sprint" ? "Not quite. Fix it or skip." : "Not quite. Try again.";
  ansEl.select();
  update(meRef(), { misses: increment(1) }).catch(() => {});
}
function submit() {
  const p = currentProb(); if (!p) return;
  const v = ansEl.value.trim(); if (!v) return;
  const j = judge(v, p);
  if (j === "ok") onCorrect();
  else if (j === "simplify") { $("#fb").textContent = "Right value. Now simplify it."; flash("bad"); }
  else onWrong();
}
ansEl.addEventListener("input", () => {
  ansEl.value = ansEl.value.replace(/[^0-9\-\/−]/g, "");
  const p = currentProb();
  if (p && judge(ansEl.value, p) === "ok") onCorrect();
});
ansEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
keypad($("#kp"), k => {
  if (!currentProb()) return;
  if (k === "ok") return submit();
  if (k === "del") ansEl.value = ansEl.value.slice(0, -1); else ansEl.value += k;
  ansEl.dispatchEvent(new Event("input"));
});
$("#skipBtn").addEventListener("click", () => {
  if (mode() !== "sprint" || !sp || !sp.prob) return;
  $("#fb").innerHTML = "Answer was " + frq(sp.prob.ans);
  update(meRef(), { misses: increment(1) }).catch(() => {});
  sp.prob = sp.next(); showProb(sp.prob); focusAns();
});
$("#s-play").addEventListener("click", e => { if (!e.target.closest("button")) focusAns(); });
