// Coordinate Battleship: pieces shared by the teacher and student screens.
import { esc } from "./ui.js";

export const MIN = "−";
export const num = n => (n < 0 ? MIN + (-n) : String(n));
export const pt = (x, y) => `(${num(x)}, ${num(y)})`;
export const K = (x, y) => `${x},${y}`;
export const fromK = k => k.split(",").map(Number);
export const fmtSec = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export const SHIPS = [
  { id: "car", name: "Carrier", len: 5 }, { id: "bat", name: "Battleship", len: 4 }, { id: "cru", name: "Cruiser", len: 3 },
  { id: "sub", name: "Submarine", len: 3 }, { id: "des", name: "Destroyer", len: 2 }
];
export const FLEET_POINTS = SHIPS.reduce((a, s) => a + s.len, 0);
export const QUAD = [null, { sx: 1, sy: 1, roman: "I" }, { sx: -1, sy: 1, roman: "II" }, { sx: -1, sy: -1, roman: "III" }, { sx: 1, sy: -1, roman: "IV" }];
export const QCOL = [null, "--p1", "--p2", "--p3", "--p4"];
export const SPECIAL = {
  h: { name: "Horizontal line", short: "Line →", desc: "the point you type and the 3 points to its right" },
  v: { name: "Vertical line", short: "Line ↑", desc: "the point you type and the 3 points above it" },
  sq: { name: "3 × 3 blast", short: "3 × 3", desc: "the point you type and the 8 points around it" }
};
export const inQuad = (q, x, y) => x !== 0 && y !== 0 && Math.abs(x) <= 10 && Math.abs(y) <= 10 && Math.sign(x) === QUAD[q].sx && Math.sign(y) === QUAD[q].sy;
const R = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* ---------- fleets: {car: [[x,y],…] | null, …} ---------- */
export function cellsFor(q, fleet, shipId, ax, ay, orient) {
  const ship = SHIPS.find(s => s.id === shipId);
  const dx = orient === "h" ? 1 : 0, dy = orient === "v" ? 1 : 0;
  const make = s => Array.from({ length: ship.len }, (_, k) => [ax + dx * k * s, ay + dy * k * s]);
  for (const s of [1, -1]) { const c = make(s); if (fits(q, fleet, shipId, c)) return { cells: c, ok: true }; }
  return { cells: make(1), ok: false };
}
function fits(q, fleet, shipId, cells) {
  return cells.every(([x, y]) => inQuad(q, x, y)) &&
    !cells.some(([x, y]) => Object.entries(fleet).some(([id, c]) => id !== shipId && c && c.some(p => p[0] === x && p[1] === y)));
}
export function randomFleet(q) {
  const fleet = {}; SHIPS.forEach(s => fleet[s.id] = null);
  const { sx, sy } = QUAD[q];
  for (const s of SHIPS) for (let t = 0; t < 500; t++) {
    const r = cellsFor(q, fleet, s.id, sx * R(1, 10), sy * R(1, 10), Math.random() < 0.5 ? "h" : "v");
    if (r.ok) { fleet[s.id] = r.cells; break; }
  }
  return fleet;
}
// Storage format: {car: "2,3|3,3|4,3|5,3|6,3", …}
export const packFleet = f => Object.fromEntries(SHIPS.map(s => [s.id, (f[s.id] || []).map(c => K(c[0], c[1])).join("|")]));
export const unpackFleet = o => Object.fromEntries(SHIPS.map(s => [s.id, o && o[s.id] ? o[s.id].split("|").map(fromK) : null]));
export function validFleet(q, f) {
  if (!f) return false;
  const seen = new Set();
  for (const s of SHIPS) {
    const c = f[s.id];
    if (!c || c.length !== s.len) return false;
    const horiz = c.every(p => p[1] === c[0][1]), vert = c.every(p => p[0] === c[0][0]);
    if (!horiz && !vert) return false;
    const vals = c.map(p => horiz ? p[0] : p[1]).sort((a, b) => a - b);
    if (vals.some((v, i) => i && v !== vals[i - 1] + 1)) return false;
    for (const [x, y] of c) { if (!inQuad(q, x, y) || seen.has(K(x, y))) return false; seen.add(K(x, y)); }
  }
  return true;
}

/* ---------- shots ---------- */
export function parseCoord(s) {
  const m = String(s).replace(/−/g, "-").trim().match(/^\(?\s*([+-]?\d{1,2})\s*[,;\s]\s*([+-]?\d{1,2})\s*\)?$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : null;
}
export function shotCells(kind, x, y) {
  let c;
  if (kind === "h") c = [0, 1, 2, 3].map(k => [x + k, y]);
  else if (kind === "v") c = [0, 1, 2, 3].map(k => [x, y + k]);
  else if (kind === "sq") { c = []; for (let dy = 1; dy >= -1; dy--) for (let dx = -1; dx <= 1; dx++) c.push([x + dx, y + dy]); }
  else c = [[x, y]];
  return c.filter(([a, b]) => Math.abs(a) <= 10 && Math.abs(b) <= 10);
}

/* ---------- the plane ----------
   o = { owners: {1..4: {name, color, out, me}}, shots: {"x,y": {res, kind}}, sunk: [cells…],
         myFleet, myColor, preview: {cells, ok}, hover: [x,y], last: Set(keys), ammo: [{x,y}] } */
export function planeSVG(o) {
  let s = `<svg class="plane" viewBox="-12 -12 24 24" role="img" aria-label="Cartesian plane from −10 to 10 on both axes">`;
  for (let q = 1; q <= 4; q++) {
    const { sx, sy, roman } = QUAD[q], ow = o.owners[q];
    const col = ow ? `var(${ow.color})` : "var(--muted)";
    s += `<rect x="${sx > 0 ? 0.5 : -10.5}" y="${sy > 0 ? -10.5 : 0.5}" width="10" height="10" fill="${col}" fill-opacity="${ow ? (ow.me ? 0.13 : 0.06) : 0.04}" rx=".3"/>`;
    const cx = sx * 5.5, cy = -sy * 5.5;
    s += `<text x="${cx}" y="${cy + 0.2}" text-anchor="middle" font-family="Archivo,Arial Narrow,sans-serif" font-weight="900" font-size="2.6" fill="${col}" fill-opacity=".13">${roman}</text>`;
    s += `<text x="${cx}" y="${cy + 1.5}" text-anchor="middle" font-family="Atkinson Hyperlegible,sans-serif" font-weight="700" font-size=".75" fill="${col}" fill-opacity="${ow ? 0.6 : 0.35}">${ow ? esc(ow.name) + (ow.out ? " (out)" : "") : "empty"}</text>`;
  }
  for (let k = -10; k <= 10; k++) {
    if (k === 0) continue;
    s += `<line x1="${k}" y1="-10.5" x2="${k}" y2="10.5" stroke="var(--gridline)" stroke-width=".035"/><line x1="-10.5" y1="${k}" x2="10.5" y2="${k}" stroke="var(--gridline)" stroke-width=".035"/>`;
  }
  s += `<line x1="-11.2" y1="0" x2="11.2" y2="0" stroke="var(--ink)" stroke-width=".09"/><line x1="0" y1="-11.2" x2="0" y2="11.2" stroke="var(--ink)" stroke-width=".09"/>`;
  s += `<path d="M11.6 0 L11.1 -.25 L11.1 .25Z M0 -11.6 L-.25 -11.1 L.25 -11.1Z" fill="var(--ink)"/>`;
  s += `<text x="11.55" y="-.45" font-size=".7" font-style="italic" font-family="Georgia,serif" fill="var(--ink)" text-anchor="middle">x</text><text x=".5" y="-11.35" font-size=".7" font-style="italic" font-family="Georgia,serif" fill="var(--ink)">y</text>`;
  for (let k = -10; k <= 10; k++) {
    if (k === 0) continue;
    s += `<text x="${k}" y=".72" text-anchor="middle" font-size=".4" font-family="Atkinson Hyperlegible,sans-serif" fill="var(--muted)">${num(k)}</text>`;
    s += `<text x="-.3" y="${-k + 0.14}" text-anchor="end" font-size=".4" font-family="Atkinson Hyperlegible,sans-serif" fill="var(--muted)">${num(k)}</text>`;
    s += `<line x1="${k}" y1="-.15" x2="${k}" y2=".15" stroke="var(--ink)" stroke-width=".05"/><line x1="-.15" y1="${-k}" x2=".15" y2="${-k}" stroke="var(--ink)" stroke-width=".05"/>`;
  }
  const cap = (cells, color, op, dash) => {
    const xs = cells.map(c => c[0]), ys = cells.map(c => c[1]);
    const a = [Math.min(...xs), Math.min(...ys)], b = [Math.max(...xs), Math.max(...ys)];
    return `<line x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" stroke="${color}" stroke-opacity="${op}" stroke-width=".66" stroke-linecap="round"${dash ? ' stroke-dasharray=".25 .18"' : ""}/>` +
      cells.map(c => `<circle cx="${c[0]}" cy="${-c[1]}" r=".11" fill="var(--surface)" fill-opacity=".85"/>`).join("");
  };
  const shots = o.shots || {};
  const isSunk = cells => cells.every(c => shots[K(c[0], c[1])] && shots[K(c[0], c[1])].res === "hit");
  if (o.myFleet) for (const c of Object.values(o.myFleet)) if (c) s += cap(c, `var(${o.myColor})`, isSunk(c) ? 0.35 : 0.85);
  for (const c of o.sunk || []) s += cap(c, "var(--muted)", 0.5);
  if (o.preview) s += cap(o.preview.cells, o.preview.ok ? "var(--good)" : "var(--bad)", 0.55, true);
  const last = o.last || new Set();
  for (const [k, v] of Object.entries(shots)) {
    const [x, y] = fromK(k), X = x, Y = -y;
    if (last.has(k)) s += `<circle cx="${X}" cy="${Y}" r=".48" fill="none" stroke="var(--ink)" stroke-width=".06" stroke-dasharray=".12 .1"/>`;
    if (v.res === "hit") s += `<circle cx="${X}" cy="${Y}" r=".33" fill="var(--bad)"/><path d="M${X - 0.16} ${Y - 0.16}L${X + 0.16} ${Y + 0.16}M${X + 0.16} ${Y - 0.16}L${X - 0.16} ${Y + 0.16}" stroke="#fff" stroke-width=".08" stroke-linecap="round"/>`;
    else if (v.res === "special") {
      const p = Array.from({ length: 10 }, (_, j) => { const r = j % 2 ? 0.18 : 0.45, a = -Math.PI / 2 + j * Math.PI / 5; return `${(X + r * Math.cos(a)).toFixed(3)},${(Y + r * Math.sin(a)).toFixed(3)}`; }).join(" ");
      s += `<polygon points="${p}" fill="var(--hl)" stroke="var(--ink)" stroke-width=".05"/>`;
    } else s += `<circle cx="${X}" cy="${Y}" r=".17" fill="var(--surface)" stroke="var(--muted)" stroke-width=".07"/>`;
  }
  if (o.hover) { const [x, y] = o.hover; s += `<text x="${x + 0.4}" y="${-y - 0.5}" font-size=".55" font-weight="700" font-family="Atkinson Hyperlegible,sans-serif" fill="var(--ink)">${pt(x, y)}</text>`; }
  for (const a of o.ammo || []) s += `<circle cx="${a.x}" cy="${-a.y}" r=".3" fill="none" stroke="var(--hl)" stroke-width=".12"/>`;
  return s + "</svg>";
}
export const legendHTML = myColor => `<div class="legend">
  ${myColor ? `<span><i class="lg" style="background:var(${myColor})"></i>your ships</span>` : ""}
  <span><i class="lg" style="background:var(--bad)"></i>hit</span>
  <span><i class="lg" style="border:2px solid var(--muted)"></i>miss</span>
  <span><i class="lg" style="background:var(--hl);border-radius:3px"></i>special ammo found</span>
  <span><i class="lg" style="background:var(--muted);opacity:.5"></i>sunk ship</span></div>`;
export function svgPoint(svg, e) {
  const q = svg.createSVGPoint(); q.x = e.clientX; q.y = e.clientY;
  const r = q.matrixTransform(svg.getScreenCTM().inverse());
  return [Math.round(r.x), Math.round(-r.y)];
}

/* ---------- written math answers ---------- */
const FN = ["sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "sqrt", "pi", "abs"];
function tokenize(s) {
  const out = []; let j = 0;
  while (j < s.length) {
    const c = s[j];
    if (/\s/.test(c)) { j++; continue; }
    if (/[0-9.]/.test(c)) { let k = j; while (k < s.length && /[0-9.]/.test(s[k])) k++; out.push({ t: "num", v: s.slice(j, k) }); j = k; continue; }
    if (/[a-zA-Z]/.test(c)) {
      let k = j; while (k < s.length && /[a-zA-Z]/.test(s[k])) k++;
      let w = s.slice(j, k); j = k;
      while (w) {
        const f = FN.find(f => w.toLowerCase().startsWith(f));
        if (f) { out.push(f === "sqrt" ? { t: "sym", v: "√" } : f === "pi" ? { t: "var", v: "π" } : { t: "fn", v: f }); w = w.slice(f.length); }
        else { out.push({ t: "var", v: w[0] }); w = w.slice(1); }
      }
      continue;
    }
    out.push({ t: "sym", v: c }); j++;
  }
  return out;
}
export function mathHTML(src) {
  const toks = tokenize(String(src || "")); let i = 0;
  const peek = () => toks[i];
  const isSym = (t, v) => t && t.t === "sym" && t.v === v;
  const OPS = { "+": "+", "-": MIN, "−": MIN, "=": "=", "<": "&lt;", ">": "&gt;", "≤": "≤", "≥": "≥", "≠": "≠", "±": "±", "×": "×", "*": "·", "·": "·", "÷": "÷", ",": ",", ";": ";" };
  const PH = '<span class="ph">□</span>';
  function seq(stop) {
    let h = "";
    while (i < toks.length) {
      const t = peek();
      if (stop && isSym(t, stop)) break;
      if (t.t === "sym" && OPS[t.v] !== undefined) { i++; h += t.v === "," || t.v === ";" ? OPS[t.v] + " " : ` ${OPS[t.v]} `; continue; }
      const f = frac();
      if (f === null) { i++; h += esc(t.v); continue; }
      h += f;
    }
    return h;
  }
  function frac() {
    let a = pow(); if (!a) return null;
    while (isSym(peek(), "/")) { i++; const b = pow() || { html: PH }; a = { html: `<span class="fr"><span>${a.inner ?? a.html}</span><span>${b.inner ?? b.html}</span></span>` }; }
    return a.html;
  }
  function pow() {
    let a = atom(); if (!a) return null;
    for (;;) {
      if (isSym(peek(), "^")) { i++; const b = atom() || { html: PH }; a = { html: `${a.html}<sup>${b.inner ?? b.html}</sup>` }; }
      else if (isSym(peek(), "°") || isSym(peek(), "!") || isSym(peek(), "%")) { a = { html: a.html + peek().v }; i++; }
      else break;
    }
    return a;
  }
  function atom() {
    const t = peek(); if (!t) return null;
    if (t.t === "num") { i++; return { html: t.v }; }
    if (t.t === "var") { i++; return { html: t.v === "π" ? "π" : `<i>${esc(t.v)}</i>` }; }
    if (isSym(t, "π") || isSym(t, "∞") || isSym(t, "θ")) { i++; return { html: t.v }; }
    if (isSym(t, "(") || isSym(t, "[")) {
      const close = t.v === "(" ? ")" : "]"; i++;
      let inner = seq(close); if (isSym(peek(), close)) i++;
      if (!inner.trim()) inner = PH;
      return { html: `${t.v}${inner}${close}`, inner };
    }
    if (isSym(t, "|")) { i++; let inner = seq("|"); if (isSym(peek(), "|")) i++; if (!inner.trim()) inner = PH; return { html: `|${inner}|` }; }
    if (isSym(t, "√") || isSym(t, "∛")) { i++; const a = atom() || { html: PH }; return { html: `<span class="rt">${t.v}<span class="rad">${a.inner ?? a.html}</span></span>` }; }
    if (t.t === "fn") {
      i++;
      const name = t.v === "abs" ? "" : t.v;
      const a = isSym(peek(), "(") ? atom() : (atom() || { html: PH });
      return { html: `<span class="fn">${name}</span>${a ? a.html : ""}` };
    }
    return null;
  }
  try { return seq(null) || ""; } catch (e) { return esc(src); }
}
export const MKEYS = [
  { l: "a/b", ins: "()/()", back: 4, t: "Fraction" }, { l: "√", ins: "√()", back: 1, t: "Square root" }, { l: "∛", ins: "∛()", back: 1, t: "Cube root" },
  { l: "x²", ins: "^2", back: 0, t: "Squared" }, { l: "xⁿ", ins: "^()", back: 1, t: "Exponent" }, { l: "π", ins: "π", back: 0 },
  { l: "x", ins: "x", back: 0 }, { l: "y", ins: "y", back: 0 }, { l: "( )", ins: "()", back: 1 }, { l: "|x|", ins: "||", back: 1, t: "Absolute value" },
  { l: "±", ins: "±", back: 0 }, { l: "=", ins: " = ", back: 0 },
  { l: "sin", ins: "sin()", back: 1 }, { l: "cos", ins: "cos()", back: 1 }, { l: "tan", ins: "tan()", back: 1 }, { l: "log", ins: "log()", back: 1 },
  { l: "ln", ins: "ln()", back: 1 }, { l: "f(x)", ins: "f(x) = ", back: 0 },
  { l: "≤", ins: "≤", back: 0 }, { l: "≥", ins: "≥", back: 0 }, { l: "°", ins: "°", back: 0 }, { l: "∞", ins: "∞", back: 0 },
  { l: "⌫", act: "del", t: "Delete" }, { l: "Clear", act: "clear" }
];
export const mkeysHTML = () => `<div class="mkeys">${MKEYS.map((k, j) => `<button type="button" data-mkey="${j}" ${k.t ? `title="${k.t}"` : ""} class="${k.act === "clear" ? "wide" : ""}">${k.l}</button>`).join("")}</div>`;
// Apply a math key to an <input>; returns the new value.
export function applyMathKey(inp, j) {
  const k = MKEYS[j];
  let a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a;
  if (k.act === "clear") { inp.value = ""; a = 0; }
  else if (k.act === "del") { if (a === b && a > 0) { inp.value = inp.value.slice(0, a - 1) + inp.value.slice(b); a--; } else inp.value = inp.value.slice(0, a) + inp.value.slice(b); }
  else { inp.value = inp.value.slice(0, a) + k.ins + inp.value.slice(b); a = a + k.ins.length - (k.back || 0); }
  inp.focus(); inp.setSelectionRange(a, a);
  return inp.value;
}

/* ---------- shared screen pieces ---------- */
export const whoHTML = (name, color) => `<span class="pname" style="--pc:var(${color})"><span class="pdot"></span>${esc(name)}</span>`;
export function fleetTable(b, players, showShots) {
  // b = room.bstate, players = room.players
  const rows = Object.entries(b.players || {}).sort((a, c) => a[1].q - c[1].q);
  return `<table class="score"><thead><tr><th>Player</th><th class="qc">Quadrant</th><th>Ships afloat</th><th>Special ammo</th>${showShots ? '<th class="r">Shots</th>' : ""}</tr></thead><tbody>${
    rows.map(([id, p]) => {
      const nm = (players && players[id] && players[id].name) || p.name || "?";
      const sunk = (b.sunk && b.sunk[id]) || {};
      return `<tr class="${p.out ? "out" : ""}" style="--pc:var(${QCOL[p.q]})"><td>${whoHTML(nm, QCOL[p.q])}</td><td class="qc">${QUAD[p.q].roman}</td>
        <td><span class="pips">${SHIPS.map(s => `<span class="pip${sunk[s.id] ? " sunk" : ""}" title="${s.name}${sunk[s.id] ? " (sunk)" : ""}"></span>`).join("")}</span></td>
        <td>${invChips(p.inv) || '<span class="sub">—</span>'}</td>${showShots ? `<td class="r"><b>${p.shots || 0}</b></td>` : ""}</tr>`;
    }).join("")
  }</tbody></table>`;
}
export const invChips = inv => Object.entries(inv || {}).filter(([, n]) => n > 0).map(([k, n]) => `<span class="chip sp">${SPECIAL[k].short}${n > 1 ? " ×" + n : ""}</span>`).join(" ");
export function ammoChips(b) {
  const f = b.found || {};
  return `<div class="chips">${["h", "v", "sq"].map(k => f[k]
    ? `<span class="chip sp">${SPECIAL[k].short}: found at ${pt(f[k].x, f[k].y)}</span>`
    : `<span class="chip">${SPECIAL[k].short}: hidden on the ${k === "h" ? "x-axis" : k === "v" ? "y-axis" : "x- or y-axis"}</span>`).join("")}</div>`;
}
export function feedHTML(b) {
  const items = Object.entries(b.feed || {}).sort((a, c) => (a[0] < c[0] ? 1 : -1)).slice(0, 14);
  return items.length ? `<ul class="feed">${items.map(([, f]) => `<li class="${esc(f.cls || "")}">${esc(f.text)}</li>`).join("")}</ul>` : `<p class="sub">Shots and events will show up here.</p>`;
}
export function standings(b) {
  return Object.entries(b.players || {}).map(([id, p]) => ({ id, ...p, left: FLEET_POINTS - (p.damage || 0) }))
    .sort((a, c) => (c.out ? 0 : 1) - (a.out ? 0 : 1) || c.left - a.left || (c.hits || 0) - (a.hits || 0));
}
