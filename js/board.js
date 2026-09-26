// Leaderboard: every practice sprint (and every live sprint race) is saved under /scores.
import { r, onValue, push, set, remove, serverTimestamp, query, orderByChild, equalTo } from "./fb.js";
import { catName, lvlName } from "./problems.js";
import { esc } from "./ui.js";

export const DURS = [{ v: 30, label: "30 s" }, { v: 60, label: "60 s" }, { v: 90, label: "90 s" }, { v: 120, label: "2 min" }];
export const durName = v => (DURS.find(d => d.v == v) || { label: v + " s" }).label;
export const evKey = (c, l, d) => `${c}-${l}-${d}`;
export const evLabel = (c, l, d) => `${catName(c)} · ${lvlName(l)} · ${durName(d)}`;

const toRows = v => Object.entries(v || {}).map(([id, x]) => ({ id, ...x }));

// Live list of every run in one event (e.g. "mul-2-60"). cb(null) means it couldn't load.
export const watchEvent = (ev, cb) =>
  onValue(query(r("scores"), orderByChild("event"), equalTo(ev)), s => cb(toRows(s.val())), () => cb(null));
// Live list of every run by one student (grouped by name).
export const watchStudent = (key, cb) =>
  onValue(query(r("scores"), orderByChild("key"), equalTo(key)), s => cb(toRows(s.val())), () => cb(null));
// Everything (teacher only).
export const watchAll = cb => onValue(r("scores"), s => cb(toRows(s.val())), () => cb(null));

export async function saveScore(rec) {
  const h = push(r("scores"));
  await set(h, { ...rec, ts: serverTimestamp() });
  return h.key;
}
export const deleteScore = id => remove(r("scores/" + id));

const cmp = (a, b) => (b.score || 0) - (a.score || 0) || (a.misses || 0) - (b.misses || 0) || (a.ts || 0) - (b.ts || 0);
// Each student's best run, best first.
export function bestPerStudent(rows) {
  const out = [], seen = new Set();
  for (const x of [...rows].sort(cmp)) { if (seen.has(x.key)) continue; seen.add(x.key); out.push(x); }
  return out;
}
export const accuracy = x => { const t = (x.score || 0) + (x.misses || 0); return t ? Math.round(100 * (x.score || 0) / t) + "%" : "—"; };
export const fmtDate = ts => new Date(ts || Date.now()).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function boardTable(rows, { limit = 50, meKey = null, del = false, dates = true, emptyText = "No scores yet." } = {}) {
  if (rows === null) return `<div class="empty">The leaderboard isn't loading. Check the internet connection.</div>`;
  const list = bestPerStudent(rows).slice(0, limit);
  if (!list.length) return `<div class="empty">${esc(emptyText)}</div>`;
  return `<table class="board"><thead><tr><th>#</th><th>Student</th><th class="r">Score</th><th class="r">Accuracy</th>${dates ? '<th class="r">Date</th>' : ""}${del ? "<th></th>" : ""}</tr></thead><tbody>` +
    list.map((x, i) => `<tr class="${i < 3 ? "top3" : ""}${meKey && x.key === meKey ? " me" : ""}"><td><span class="rank">${i + 1}</span></td><td class="nm">${esc(x.name)}${x.source === "live" ? ' <span class="tag">class</span>' : ""}</td><td class="r num">${x.score || 0}</td><td class="r">${accuracy(x)}</td>${dates ? `<td class="r">${fmtDate(x.ts)}</td>` : ""}${del ? `<td class="r"><button class="ghost small danger" type="button" data-del="${esc(x.id)}">Remove</button></td>` : ""}</tr>`).join("") +
    `</tbody></table>`;
}
