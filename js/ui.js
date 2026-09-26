// Small shared helpers.
export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const normKey = n => String(n).trim().toLowerCase().replace(/\s+/g, " ");
export const coarse = !!(window.matchMedia && matchMedia("(pointer:coarse)").matches);
export const MIN = "−";

export function showOnly(ids, id) { ids.forEach(x => { const el = document.getElementById(x); if (el) el.hidden = x !== id; }); window.scrollTo(0, 0); }

export function keypad(el, onKey) {
  const keys = ["7", "8", "9", "del", "4", "5", "6", "/", "1", "2", "3", "-", "0", "ok"];
  el.innerHTML = keys.map(k => {
    const lab = k === "del" ? "⌫" : k === "-" ? MIN : k === "ok" ? "Enter" : k;
    const cls = k === "0" ? "wide" : k === "ok" ? "wide enter" : "";
    return `<button type="button" class="${cls}" data-k="${k}" aria-label="${k === "del" ? "Delete" : lab}">${lab}</button>`;
  }).join("");
  el.addEventListener("pointerdown", e => { const b = e.target.closest("button"); if (!b) return; e.preventDefault(); onKey(b.dataset.k); });
}

export function seg(el, opts, get, set) {
  el.innerHTML = opts.map(o => `<button type="button" data-v="${o.v}">${esc(o.label)}</button>`).join("");
  const sync = () => el.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === String(get()))));
  el.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; set(b.dataset.v); sync(); });
  sync();
  return sync;
}

// Sounds (start only after a click, as browsers require).
let actx = null;
export const sound = { on: true };
function tone(f, d = 0.08, type = "sine", g = 0.06) {
  if (!sound.on) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), v = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.value = f; v.gain.setValueAtTime(g, t); v.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(v); v.connect(actx.destination); o.start(t); o.stop(t + d + 0.03);
  } catch (e) { /* no audio */ }
}
export const sfx = {
  ok() { tone(660, 0.07); setTimeout(() => tone(990, 0.1), 60); },
  bad() { tone(170, 0.2, "square", 0.035); },
  tick() { tone(880, 0.06); },
  go() { tone(1320, 0.18, "triangle", 0.07); },
  win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, "triangle", 0.07), i * 120)); }
};

export function rankOf(players, uid) {
  const list = Object.entries(players || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => (b.score || 0) - (a.score || 0) || (a.misses || 0) - (b.misses || 0));
  return { list, pos: list.findIndex(p => p.id === uid) + 1 };
}
export const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
