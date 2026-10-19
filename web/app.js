import { hasCloud, cloudStore, localStore } from "./store.js";
import { LIBRARY } from "./recipes.js";

// ---------- helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const DAYS = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"], ["fri", "Fri"], ["sat", "Sat"], ["sun", "Sun"]];
const AISLES = ["Produce", "Meat & Seafood", "Dairy & Fridge", "Bakery", "Pantry", "Frozen"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isNativeApp = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

// ---------- ingredient parsing ----------
const UNIT_MAP = {
  cup: "cup", cups: "cup", c: "cup",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp", tbl: "tbsp", tbls: "tbsp", tblsp: "tbsp", tbsps: "tbsp",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tsps: "tsp", stick: "stick", sticks: "stick",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  oz: "oz", ounce: "oz", ounces: "oz",
  g: "g", gram: "g", grams: "g", kg: "kg",
  ml: "ml", l: "l", liter: "l", liters: "l",
  can: "can", cans: "can", jar: "jar", jars: "jar",
  clove: "clove", cloves: "clove", bunch: "bunch", bunches: "bunch",
  pkg: "pkg", package: "pkg", packages: "pkg", pack: "pkg", packs: "pkg", bag: "bag", bags: "bag",
  head: "head", heads: "head", stalk: "stalk", stalks: "stalk", slice: "slice", slices: "slice", box: "box", boxes: "box", bottle: "bottle", bottles: "bottle"
};
const UNI_FRAC = { "¼": .25, "½": .5, "¾": .75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": .125 };

function parseNum(tok) {
  if (!tok) return null;
  if (UNI_FRAC[tok] != null) return UNI_FRAC[tok];
  const m = tok.match(/^(\d+)([¼½¾⅓⅔⅛])$/);
  if (m) return +m[1] + UNI_FRAC[m[2]];
  if (/^\d+\/\d+$/.test(tok)) { const [a, b] = tok.split("/").map(Number); return b ? a / b : null; }
  if (/^\d*\.?\d+$/.test(tok)) return parseFloat(tok);
  return null;
}

function parseLine(line) {
  const words = line.trim().replace(/\s+/g, " ").split(" ");
  let q = null, i = 0;
  const a = parseNum(words[0]);
  if (a != null) {
    q = a; i = 1;
    const b = parseNum(words[1]);
    if (b != null && b < 1) { q += b; i = 2; }
  }
  let u = "";
  if (q != null && words[i]) {
    const w = words[i].toLowerCase().replace(/\.$/, "");
    if (UNIT_MAP[w]) { u = UNIT_MAP[w]; i++; if ((words[i] || "").toLowerCase() === "of") i++; }
  }
  const n = words.slice(i).join(" ").trim();
  return { q, u, n: n || line.trim() };
}

function fmtQty(x) {
  const whole = Math.floor(x + 1e-9), frac = x - whole;
  const fr = [[0, ""], [.25, "¼"], [1 / 3, "⅓"], [.5, "½"], [2 / 3, "⅔"], [.75, "¾"], [1, ""]];
  for (const [v, s] of fr) {
    if (Math.abs(frac - v) < .04) {
      const w = v === 1 ? whole + 1 : whole;
      return ((w ? String(w) : "") + s) || "0";
    }
  }
  return String(Math.round(x * 100) / 100);
}
const lineOf = (ing) => [ing.q != null ? fmtQty(ing.q) : "", ing.u, ing.n].filter(Boolean).join(" ");

// ---------- aisle guessing ----------
const RULES = [
  ["Frozen", /\bfrozen\b|ice cream/],
  ["Produce", /green beans|coleslaw|salad mix/],
  ["Pantry", /black pepper|pepper flakes|powder|\bdried\b|sun-dried|paprika|cumin|oregano|broth|stock|sauce|salsa|canned|paste|vinegar|\boil\b|seasoning|spice|honey|syrup|peanut butter|mustard|ketchup|mayo|beans|lentils|rice|pasta|spaghetti|penne|noodle|flour|sugar|\bsalt\b|oats|cereal|coconut milk|crackers|chips|nuts/],
  ["Meat & Seafood", /chicken|beef|pork|turkey|sausage|bacon|salmon|shrimp|\bfish\b|\bcod\b|tilapia|steak|ground|\bham\b|chorizo|lamb/],
  ["Dairy & Fridge", /milk|cheese|butter|yogurt|cream|\beggs?\b|parmesan|mozzarella|cheddar|feta|ricotta|tofu|hummus/],
  ["Bakery", /bread|tortilla|\bbuns?\b|\brolls?\b|pita|naan|bagel|baguette|croissant/],
  ["Produce", /onion|garlic|tomato|lettuce|spinach|pepper|carrot|celery|potato|avocado|lime|lemon|cilantro|basil|parsley|ginger|scallion|cucumber|broccoli|zucchini|squash|mushroom|apple|banana|berr|kale|cabbage|corn|jalape|herb|thyme|rosemary|mint|greens|arugula|cauliflower|asparagus|peas|fruit|orange|grape|mango/]
];
function aisleOf(name, unit) {
  const s = name.toLowerCase();
  if (["can", "jar", "box", "bottle"].includes(unit) && !/\bfrozen\b/.test(s)) return "Pantry";
  for (const [a, re] of RULES) if (re.test(s)) return a;
  return "Pantry";
}

// ---------- state ----------
const state = {
  phase: "loading",     // loading | signin | app
  user: null,
  tab: "week",
  meals: [], plan: {}, list: { checked: {}, extras: [] },
  cooked: {},           // {"mon|mealId": true}
  fridge: {},           // produce bought: {id: {name, listKey, bought: "YYYY-MM-DD", shelf, meals: [mealId]}}
  authMode: "signin",   // signin | signup | reset
  authMsg: null,
  online: navigator.onLine
};
try { const t = localStorage.getItem("wom-tab"); if (["week", "meals", "discover", "list"].includes(t)) state.tab = t; } catch (e) {}

const handlers = {
  onUser(u) {
    state.user = u;
    state.phase = u ? "app" : "signin";
    if (!u) { state.meals = []; state.plan = {}; state.cooked = {}; state.list = { checked: {}, extras: [] }; state.fridge = {}; }
    render();
  },
  onMeals(m) { state.meals = m; render(); },
  onPlan(p, c) { state.plan = p; state.cooked = c || {}; render(); },
  onFridge(f) { state.fridge = f || {}; render(); },
  onList(l) { state.list = l; render(); },
  onError(e) {
    console.error(e);
    toast(e && e.code === "permission-denied" ? "Sync was refused. Check the Firestore rules in your Firebase project." : "Couldn't sync that change. It will retry when you're online.");
  }
};
const store = hasCloud() ? cloudStore(handlers) : localStore(handlers);

// ---------- derived ----------
const mealById = (id) => state.meals.find((m) => m.id === id);
const sortedMeals = () => state.meals.slice().sort((a, b) => a.name.localeCompare(b.name));
const plannedCount = () => DAYS.reduce((n, [k]) => n + (state.plan[k] || []).filter(mealById).length, 0);
const usesOf = (id) => DAYS.reduce((n, [k]) => n + (state.plan[k] || []).filter((x) => x === id).length, 0);

function buildList() {
  const map = new Map();
  for (const [k] of DAYS) for (const id of state.plan[k] || []) {
    const m = mealById(id); if (!m) continue;
    for (const ing of m.ingredients || []) {
      const name = (ing.n || "").trim(); if (!name) continue;
      const key = name.toLowerCase() + "|" + (ing.u || "");
      let it = map.get(key);
      if (!it) { it = { key, name, u: ing.u || "", q: 0, bare: 0, sources: [], mealIds: [], aisle: aisleOf(name, ing.u) }; map.set(key, it); }
      if (ing.q != null) it.q += ing.q; else it.bare++;
      if (!it.sources.includes(m.name)) it.sources.push(m.name);
      if (!it.mealIds.includes(m.id)) it.mealIds.push(m.id);
    }
  }
  const items = [...map.values()];
  for (const x of state.list.extras) items.push({ key: "x:" + x.id, extraId: x.id, name: x.text, u: "", q: 0, bare: 0, sources: ["Added by you"], mealIds: [], aisle: aisleOf(x.text) });
  return items;
}
const PLURAL = { cup: "cups", can: "cans", jar: "jars", clove: "cloves", bunch: "bunches", bag: "bags", head: "heads", stalk: "stalks", stick: "sticks", slice: "slices", box: "boxes", bottle: "bottles" };
function qtyLabel(it) {
  const unit = it.q > 1 && PLURAL[it.u] ? PLURAL[it.u] : it.u;
  if (it.q > 0) return fmtQty(it.q) + (unit ? " " + unit : "") + (it.bare ? " +" : "");
  if (it.bare > 1) return "×" + it.bare;
  return "";
}
function weekDates() {
  const now = new Date(), day = (now.getDay() + 6) % 7;
  return DAYS.map((_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + i));
}

// ---------- render ----------
let armed = null, armTimer = null;
function arm(name) { armed = name; clearTimeout(armTimer); armTimer = setTimeout(() => { armed = null; render(); }, 3500); render(); }

function render() {
  const app = $("#app");
  const inApp = state.phase === "app";
  $("#tabs").hidden = !inApp;
  $("#settings-btn").hidden = !inApp;
  const sync = $("#sync");
  sync.hidden = !inApp;
  sync.className = "sync" + (store.mode === "cloud" && state.online ? "" : " off");
  sync.textContent = store.mode === "local" ? "This device only" : state.online ? "Synced" : "Offline";

  document.querySelectorAll("nav.tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  const remaining = inApp ? buildList().filter((it) => !state.list.checked[it.key]).length : 0;
  const badge = $("#list-badge"); badge.hidden = !remaining; badge.textContent = remaining;

  if (state.phase === "loading") return;
  if (state.phase === "signin") { if (!$("#auth-form")) app.innerHTML = renderAuth(); return; }
  // Keep the cursor in a search box that re-renders as you type.
  const active = document.activeElement;
  const searchId = active && ["meal-search", "discover-search"].includes(active.id) ? active.id : null;
  const pos = searchId ? active.selectionStart : 0;
  const views = { week: renderWeek, meals: renderMeals, discover: renderDiscover, list: renderList };
  app.innerHTML = views[state.tab]();
  if (searchId) { const s = document.getElementById(searchId); if (s) { s.focus(); s.setSelectionRange(pos, pos); } }
}

function renderAuth() {
  const m = state.authMode, msg = state.authMsg;
  const title = m === "signup" ? "Create your account" : m === "reset" ? "Reset your password" : "Sign in";
  const lead = m === "reset"
    ? "Enter your email and we'll send you a link to set a new password."
    : "Use the same email and password on your phone and computer to keep your meals and list in sync.";
  return `<form class="auth" id="auth-form" novalidate>
    <h1>${title}</h1><p>${lead}</p>
    ${msg ? `<p class="${msg.ok ? "ok" : "err"}" role="alert">${esc(msg.text)}</p>` : ""}
    <label class="field">Email<input id="auth-email" type="email" autocomplete="email" required></label>
    ${m === "reset" ? "" : `<label class="field">Password<input id="auth-pw" type="password" autocomplete="${m === "signup" ? "new-password" : "current-password"}" minlength="6" required>${m === "signup" ? `<span class="hint">At least 6 characters.</span>` : ""}</label>`}
    <button class="btn primary wide" type="submit">${m === "signup" ? "Create account" : m === "reset" ? "Send reset link" : "Sign in"}</button>
    <div class="auth-foot">
      ${m === "signin" ? `<button type="button" class="link" data-act="authmode" data-mode="signup">Create an account</button><button type="button" class="link" data-act="authmode" data-mode="reset">Forgot password?</button>`
        : `<button type="button" class="link" data-act="authmode" data-mode="signin">Back to sign in</button>`}
    </div></form>`;
}

function emptyMeals() {
  return `<div class="empty"><h2>No meals yet</h2><p>Browse recipes to save, or add your own meals with their ingredients. Then pick them for each day and your shopping list builds itself.</p>
    <div class="btn-row"><button class="btn primary" data-act="tab" data-tab="discover">Browse recipes</button><button class="btn" data-act="newmeal">Add my own</button></div></div>`;
}

function renderWeek() {
  const dates = weekDates(), todayStr = new Date().toDateString(), ti = todayIdx();
  const range = `${MONTHS[dates[0].getMonth()]} ${dates[0].getDate()} – ${MONTHS[dates[6].getMonth()]} ${dates[6].getDate()}`;
  const nFridge = Object.keys(state.fridge).length;
  const head = `<div class="head"><div><div class="eyebrow">This week · ${range}</div><h1>Plan your meals</h1></div>
    <button class="btn" data-act="fridge">Fridge${nFridge ? " · " + nFridge : ""}</button></div>`;
  if (!state.meals.length) return head + emptyMeals();
  const n = plannedCount();
  const days = DAYS.map(([k, label], i) => {
    const ids = (state.plan[k] || []).filter(mealById);
    const chips = ids.map((id, j) => {
      const name = esc(mealById(id).name), done = !!state.cooked[k + "|" + id];
      const missed = !done && i < ti;
      return `<span class="chip${done ? " cooked" : ""}${missed ? " missed" : ""}">
        <button class="ck" data-act="cook" data-day="${k}" data-id="${esc(id)}" aria-pressed="${done}" aria-label="${done ? "Made" : "Mark as made"}: ${name}"></button>
        <button class="cname" data-act="viewmeal" data-id="${esc(id)}">${name}</button>
        <button class="x" data-act="unplan" data-day="${k}" data-idx="${j}" aria-label="Remove ${name} from ${label}">×</button></span>`;
    }).join("");
    return `<div class="day${dates[i].toDateString() === todayStr ? " today" : ""}">
      <div><div class="dname">${label}</div><div class="ddate">${MONTHS[dates[i].getMonth()]} ${dates[i].getDate()}</div></div>
      <div class="slots">${chips}<button class="add-slot" data-act="pick" data-day="${k}">+ ${ids.length ? "Add" : "Add a meal"}</button></div>
    </div>`;
  }).join("");
  return head + renderUseItUp() + `<div class="days">${days}</div>
    <p class="hint-line">Tap the circle on a meal once you've made it.</p>
    <div class="week-foot">
      <span class="count">${n} meal${n === 1 ? "" : "s"} planned</span>
      <div class="btn-row">
        ${n ? `<button class="btn ${armed === "clearweek" ? "armed" : "danger"}" data-act="clearweek">${armed === "clearweek" ? "Tap again to clear" : "New week"}</button>
        <button class="btn primary" data-act="tab" data-tab="list">See shopping list</button>` : ""}
      </div>
    </div>`;
}

let mealQuery = "";
function renderMeals() {
  const head = `<div class="head"><div><div class="eyebrow">${state.meals.length} saved</div><h1>Your meals</h1></div><button class="btn primary" data-act="newmeal">+ New</button></div>`;
  if (!state.meals.length) return head + emptyMeals();
  const q = mealQuery.toLowerCase();
  const rows = sortedMeals()
    .filter((m) => !q || m.name.toLowerCase().includes(q) || (m.ingredients || []).some((i) => (i.n || "").toLowerCase().includes(q)))
    .map((m) => {
      const u = usesOf(m.id);
      return `<button class="meal" data-act="viewmeal" data-id="${esc(m.id)}"><div><div class="meal-name">${esc(m.name)}</div><div class="meal-ing">${esc((m.ingredients || []).map((i) => i.n).join(", ") || "No ingredients yet")}</div></div>
        ${m.example ? `<span class="tag">Example</span>` : ""}${u ? `<span class="uses">${u}× this week</span>` : ""}</button>`;
    }).join("") || `<div class="empty"><p>No meals match “${esc(mealQuery)}”.</p></div>`;
  return head + `<input class="search" id="meal-search" type="search" placeholder="Search meals or ingredients" value="${esc(mealQuery)}" autocomplete="off" aria-label="Search meals"><div class="meals">${rows}</div>`;
}

function renderList() {
  const items = buildList();
  const done = items.filter((it) => state.list.checked[it.key]).length;
  const pct = items.length ? Math.round(done / items.length * 100) : 0;
  const form = `<form class="extra-form" id="extra-form"><input id="extra-input" placeholder="Add something else (paper towels, coffee…)" autocomplete="off" aria-label="Add an item"><button class="btn primary" type="submit">Add</button></form>`;
  let body;
  if (!items.length) {
    body = `<div class="empty"><h2>Your list is empty</h2><p>Pick meals for the week and their ingredients show up here, grouped by aisle.</p><div class="btn-row"><button class="btn primary" data-act="tab" data-tab="week">Plan the week</button></div></div>`;
  } else {
    body = AISLES.map((a) => {
      const group = items.filter((it) => it.aisle === a)
        .sort((x, y) => (!!state.list.checked[x.key] - !!state.list.checked[y.key]) || x.name.localeCompare(y.name));
      if (!group.length) return "";
      const left = group.filter((it) => !state.list.checked[it.key]).length;
      return `<section class="aisle"><h3><span>${a}</span><span>${left ? left + " left" : "done"}</span></h3><div class="items">` + group.map((it) => {
        const c = !!state.list.checked[it.key];
        return `<div class="item${c ? " done" : ""}" role="checkbox" aria-checked="${c}" tabindex="0" data-act="toggle" data-key="${esc(it.key)}">
          <span class="box"></span>
          <span class="iname">${esc(it.name)}<span class="isrc">${esc(it.sources.join(" · "))}</span></span>
          ${it.extraId ? `<button class="del-extra" data-act="delextra" data-id="${esc(it.extraId)}" aria-label="Remove ${esc(it.name)}">×</button>` : `<span class="iqty">${esc(qtyLabel(it))}</span>`}
        </div>`;
      }).join("") + `</div></section>`;
    }).join("");
  }
  return `<div class="head"><div><div class="eyebrow">${items.length - done} of ${items.length} to get</div><h1>Shopping list</h1></div>
      ${items.length ? `<button class="btn" data-act="copy">Copy</button>` : ""}</div>
    ${items.length ? `<div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>` : ""}
    ${form}${body}
    ${done ? `<div class="btn-row"><button class="btn" data-act="uncheck">Uncheck all</button></div>` : ""}
    <div id="copy-slot"></div>`;
}

// ---------- produce tracking ----------
// Typical fridge life in days, checked in order (so "green onion" wins over "onion").
const SHELF = [
  [/spinach|arugula|salad|lettuce|romaine|greens/, 5], [/berr/, 4], [/avocado/, 4], [/asparagus/, 4], [/corn/, 3],
  [/mushroom/, 5], [/basil/, 4], [/cilantro|parsley|dill|mint|herb|thyme|rosemary/, 7], [/green onion|scallion/, 7],
  [/tomato/, 6], [/broccoli|cauliflower/, 6], [/green bean/, 6], [/zucchini|squash/, 6], [/cucumber/, 6],
  [/bell pepper|jalape/, 9], [/coleslaw|cabbage/, 7], [/banana/, 5], [/kale/, 6], [/lemon|lime|orange/, 21],
  [/ginger/, 21], [/celery/, 14], [/carrot/, 21], [/apple/, 28], [/potato/, 21], [/onion/, 30], [/garlic/, 45]
];
const shelfLife = (name) => { const s = name.toLowerCase(); for (const [re, d] of SHELF) if (re.test(s)) return d; return 7; };

const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = () => isoDate(new Date());
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const daysSince = (s) => Math.round((parseDate(today()) - parseDate(s)) / 864e5);
const daysLeft = (item) => item.shelf - daysSince(item.bought);
const todayIdx = () => (new Date().getDay() + 6) % 7;

// Loose name matching: "baby spinach" matches "spinach", "tomatoes" matches "cherry tomato".
function normName(s) {
  return s.toLowerCase().replace(/[^a-z ]/g, " ")
    .replace(/\b(fresh|baby|large|small|medium|ripe|chopped|finely|sliced|diced|whole|bunch|of)\b/g, " ")
    .replace(/oes\b/g, "o").replace(/ies\b/g, "y").replace(/s\b/g, "")
    .replace(/\s+/g, " ").trim();
}
function sameFood(a, b) {
  const x = normName(a), y = normName(b);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

// Where a meal sits in this week's plan, if it isn't cooked yet.
function planSlot(mealId) {
  const ti = todayIdx();
  for (let i = 0; i < DAYS.length; i++) {
    const k = DAYS[i][0];
    if ((state.plan[k] || []).includes(mealId) && !state.cooked[k + "|" + mealId]) return { k, i, past: i < ti, inDays: i - ti };
  }
  return null;
}
const wasCooked = (mealId) => DAYS.some(([k]) => state.cooked[k + "|" + mealId]);

// Why a tracked item needs attention, or null if it's fine for now.
function riskOf(item) {
  const left = daysLeft(item);
  const meals = (item.meals || []).map(mealById).filter(Boolean);
  if (left < 0) return { level: "bad", text: "May be past its best. Check it before using." };
  // Long keepers (onions, garlic, potatoes) only need attention once they get close.
  if (left <= 7) for (const m of meals) {
    if (wasCooked(m.id)) continue;
    const slot = planSlot(m.id);
    if (!slot) return { level: left <= 2 ? "bad" : "warn", text: `Bought for ${m.name}, which isn't planned anymore.` };
    if (slot.past) return { level: left <= 2 ? "bad" : "warn", text: `Bought for ${m.name} on ${DAYS[slot.i][1]}, which you haven't marked as made.` };
    if (slot.inDays > left) return { level: "warn", text: `${m.name} is planned for ${DAYS[slot.i][1]}, but it may not last that long.` };
  }
  if (left <= 2) return { level: left <= 1 ? "bad" : "warn", text: meals.length ? `Use soon. It's for ${meals.map((m) => m.name).join(" and ")}.` : "Use soon." };
  return null;
}
const leftLabel = (n) => (n < 0 ? "Past" : n === 0 ? "Today" : n === 1 ? "1 day" : n + " days");
const fridgeItems = () => Object.entries(state.fridge).map(([id, it]) => ({ id, ...it })).sort((a, b) => daysLeft(a) - daysLeft(b));

// Recipes (saved meals first, then the library) that use the most at-risk produce,
// skipping meals already planned for later this week.
let lastIdeas = [];
function useItUpIdeas(atRisk) {
  const upcoming = new Set(state.meals.filter((m) => { const s = planSlot(m.id); return s && !s.past; }).map((m) => m.id));
  const savedSources = new Set(state.meals.map((m) => m.source).filter(Boolean));
  const cands = state.meals.filter((m) => !upcoming.has(m.id)).map((m) => ({ r: m, meal: m }))
    .concat(BUILT_IN.filter((r) => !savedSources.has(r.source)).map((r) => ({ r, meal: null })));
  return cands.map((c) => ({ ...c, uses: atRisk.filter((it) => (c.r.ingredients || []).some((i) => sameFood(i.n || "", it.name))) }))
    .filter((c) => c.uses.length)
    .sort((a, b) => b.uses.length - a.uses.length || (b.meal ? 1 : 0) - (a.meal ? 1 : 0))
    .slice(0, 3);
}

function renderUseItUp() {
  const atRisk = fridgeItems().map((it) => ({ ...it, risk: riskOf(it) })).filter((it) => it.risk);
  if (!atRisk.length) return "";
  lastIdeas = useItUpIdeas(atRisk);
  const rows = atRisk.slice(0, 5).map((it) => `<li><span class="pill ${it.risk.level}">${leftLabel(daysLeft(it))}</span>
    <div><b>${esc(it.name)}</b><small>${esc(it.risk.text)}</small></div></li>`).join("");
  const more = atRisk.length > 5 ? `<li class="more">and ${atRisk.length - 5} more in your fridge</li>` : "";
  const ideas = lastIdeas.map((c, i) => `<button class="idea" data-act="idea" data-idx="${i}">
      <span class="rname">${esc(c.r.name)}</span>
      <span class="rmeta">Uses ${esc(c.uses.map((u) => u.name).join(", "))}${c.meal ? " · in your meals" : ""}</span></button>`).join("");
  return `<section class="useup" aria-label="Produce to use up">
    <div class="useup-head"><h2>Use it up</h2><button class="link" data-act="fridge">See fridge</button></div>
    <ul class="risk">${rows}${more}</ul>
    ${ideas ? `<div class="sect">Ideas to use them</div><div class="ideas">${ideas}</div>` : ""}
  </section>`;
}

function openFridge() {
  const items = fridgeItems();
  const rows = items.map((it) => {
    const r = riskOf(it), left = daysLeft(it);
    const meals = (it.meals || []).map(mealById).filter(Boolean).map((m) => m.name);
    const d = parseDate(it.bought);
    return `<li><span class="pill ${r ? r.level : "ok"}">${leftLabel(left)}</span>
      <div><b>${esc(it.name)}</b><small>Bought ${DAYS[(d.getDay() + 6) % 7][1]} ${MONTHS[d.getMonth()]} ${d.getDate()}${meals.length ? " · for " + esc(meals.join(", ")) : ""}</small></div>
      <span class="fbtns"><button class="btn" data-act="fused" data-id="${esc(it.id)}">Used</button><button class="btn danger" data-act="ftoss" data-id="${esc(it.id)}">Tossed</button></span></li>`;
  }).join("");
  openSheet(`<div class="sheet-head"><h2>Fridge</h2><button class="btn" data-act="close">Done</button></div>
    <p class="muted">Produce you tick off on the shopping list shows up here, with about how long it keeps in the fridge.</p>
    <form class="extra-form" id="fridge-form"><input id="fridge-input" placeholder="Add produce you bought" autocomplete="off" aria-label="Add produce"><button class="btn primary" type="submit">Add</button></form>
    ${items.length ? `<ul class="risk fridge">${rows}</ul>` : `<div class="empty"><p>Nothing tracked yet.</p></div>`}`);
}

function removeFridge(id) { const f = Object.assign({}, state.fridge); delete f[id]; setFridge(f); }

// Marking a meal as made clears the produce that was bought only for it.
function toggleCooked(day, mealId) {
  const key = day + "|" + mealId, cooked = Object.assign({}, state.cooked);
  const nowCooked = !cooked[key];
  if (nowCooked) cooked[key] = true; else delete cooked[key];
  setPlan(state.plan, cooked);
  if (!nowCooked) return;
  const f = {}; let cleared = 0, changed = false;
  for (const [id, it] of Object.entries(state.fridge)) {
    if (!(it.meals || []).includes(mealId)) { f[id] = it; continue; }
    changed = true;
    const rest = it.meals.filter((m) => m !== mealId);
    if (rest.length) f[id] = { ...it, meals: rest }; else cleared++;
  }
  if (changed) setFridge(f);
  toast(cleared ? `Nice! ${cleared} produce item${cleared === 1 ? "" : "s"} cleared from your fridge.` : "Marked as made");
}

// ---------- discover ----------
const toRecipe = (r) => ({
  source: "lib:" + r.id, name: r.name, time: r.time, servings: r.servings, tags: r.tags,
  ingredients: r.ing.split("\n").map(parseLine), steps: r.steps.split("|")
});
const BUILT_IN = LIBRARY.map(toRecipe);
const FILTERS = [
  ["all", "All"], ["quick", "30 min or less"], ["vegetarian", "Vegetarian"], ["chicken", "Chicken"],
  ["beef", "Beef"], ["pork", "Pork"], ["seafood", "Seafood"], ["pasta", "Pasta"], ["soup", "Soups"],
  ["one-pan", "One pan"], ["kid-friendly", "Kid-friendly"], ["slow-cooker", "Slow cooker"]
];
const discover = { filter: "all", query: "", online: null }; // online: {q, status: loading|done|error, results}
const savedFor = (source) => state.meals.find((m) => m.source === source);
const fmtTime = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? h + " hr" + (m ? " " + m + " min" : "") : m + " min";
};
const metaOf = (r) => [r.time ? fmtTime(r.time) : "", r.servings ? r.servings + " servings" : "", ...(r.area ? [r.area] : [])].filter(Boolean).join(" · ");

function renderDiscover() {
  const q = discover.query.trim().toLowerCase();
  const f = discover.filter;
  const list = BUILT_IN.filter((r) =>
    (f === "all" || (f === "quick" ? r.time <= 30 : r.tags.includes(f))) &&
    (!q || r.name.toLowerCase().includes(q) || r.ingredients.some((i) => i.n.toLowerCase().includes(q))));
  const chips = FILTERS.map(([k, label]) => `<button class="fchip" data-act="filter" data-filter="${k}" aria-pressed="${f === k}">${label}</button>`).join("");
  const cards = list.map((r, i) => recipeCard(r, "lib", BUILT_IN.indexOf(r))).join("")
    || `<div class="empty"><p>No recipes in the library match${discover.online ? "." : ". Tap Search online to look further."}</p></div>`;
  return `<div class="head"><div><div class="eyebrow">${BUILT_IN.length} recipes · more online</div><h1>Discover</h1></div></div>
    <form class="extra-form" id="discover-form" role="search">
      <input id="discover-search" type="search" placeholder="Search recipes or ingredients" value="${esc(discover.query)}" autocomplete="off" aria-label="Search recipes">
      <button class="btn primary" type="submit">Search online</button>
    </form>
    <div class="fchips" role="group" aria-label="Filter recipes">${chips}</div>
    ${renderOnline()}
    <section><h3 class="sect">Recipe library</h3><div class="rgrid">${cards}</div></section>`;
}

function recipeCard(r, src, idx) {
  const saved = savedFor(r.source);
  const img = r.thumb ? `<img src="${esc(r.thumb)}" alt="" loading="lazy">` : `<span class="rinitial" aria-hidden="true">${esc(r.name[0])}</span>`;
  return `<button class="rcard" data-act="recipe" data-src="${src}" data-idx="${idx}">${img}
    <span class="rbody"><span class="rname">${esc(r.name)}</span><span class="rmeta">${esc(metaOf(r))}</span></span>
    ${saved ? `<span class="tag saved">Saved</span>` : ""}</button>`;
}

function renderOnline() {
  const o = discover.online; if (!o) return "";
  let body;
  if (o.status === "loading") body = `<p class="muted">Searching for “${esc(o.q)}”…</p>`;
  else if (o.status === "error") body = `<p class="muted">${!navigator.onLine ? "You're offline. Connect to the internet to search online." : "Couldn't reach the recipe site. Try again in a moment."}</p>`;
  else if (!o.results.length) body = `<p class="muted">No online recipes found for “${esc(o.q)}”. Try one main ingredient, like “chicken” or “salmon”.</p>`;
  else body = `<div class="rgrid">${o.results.map((r, i) => recipeCard(r, "online", i)).join("")}</div>`;
  return `<section class="online"><h3 class="sect"><span>Online results</span><button class="link" data-act="clearonline">Clear</button></h3>${body}
    <p class="credit">Online recipes from TheMealDB.com</p></section>`;
}

async function searchOnline(q) {
  q = q.trim(); if (!q) return;
  discover.online = { q, status: "loading", results: [] }; render();
  try {
    const res = await fetch("https://www.themealdb.com/api/json/v1/1/search.php?s=" + encodeURIComponent(q));
    if (!res.ok) throw new Error(res.status);
    const json = await res.json();
    if (!discover.online || discover.online.q !== q) return;
    discover.online = { q, status: "done", results: (json.meals || []).map(fromMealDb) };
  } catch (e) {
    if (discover.online && discover.online.q === q) discover.online = { q, status: "error", results: [] };
  }
  render();
}

// Turns a TheMealDB record into the app's recipe shape.
function fromMealDb(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m["strIngredient" + i] || "").trim().toLowerCase();
    if (!name) continue;
    const measure = (m["strMeasure" + i] || "").trim().replace(/^(\d+(?:[.\/]\d+)?)\s*([a-zA-Z]+)/, "$1 $2");
    ingredients.push(/^[\d¼½¾⅓⅔⅛]/.test(measure) ? parseLine((measure + " " + name).toLowerCase()) : { q: null, u: "", n: name });
  }
  const steps = (m.strInstructions || "").split(/\r?\n+/).map((s) => s.replace(/^(step\s*)?\d+[.):]?\s*/i, "").trim())
    .filter((s) => s.length > 1);
  return {
    source: "mealdb:" + m.idMeal, name: m.strMeal, ingredients, steps,
    tags: [m.strCategory].filter(Boolean).map((t) => t.toLowerCase()),
    area: m.strArea && m.strArea !== "Unknown" ? m.strArea : "",
    photo: m.strMealThumb || "", thumb: m.strMealThumb ? m.strMealThumb + "/preview" : "",
    link: m.strSource || ""
  };
}

// Saves a recipe as one of the user's meals (once) and returns the meal id.
function saveRecipe(r) {
  const existing = savedFor(r.source);
  if (existing) return existing.id;
  const meal = { id: uid(), name: r.name, ingredients: r.ingredients, steps: r.steps || [], source: r.source };
  for (const k of ["time", "servings", "photo", "link"]) if (r[k]) meal[k] = r[k];
  store.saveMeal(meal);
  if (!state.meals.some((m) => m.id === meal.id)) state.meals = state.meals.concat(meal);
  return meal.id;
}

let sheetRecipe = null; // the recipe or meal shown in the open detail sheet
function openRecipe(r, meal) {
  sheetRecipe = { r, meal };
  const saved = meal || savedFor(r.source);
  const ings = (r.ingredients || []).map((i) => `<li><span class="iq">${esc([i.q != null ? fmtQty(i.q) : "", i.u].filter(Boolean).join(" "))}</span><span>${esc(i.n)}</span></li>`).join("");
  const steps = (r.steps || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const days = DAYS.map(([k, label]) => `<button class="daybtn" data-act="recipeday" data-day="${k}">${label}</button>`).join("");
  openSheet(`${r.photo ? `<img class="hero" src="${esc(r.photo)}" alt="">` : ""}
    <div class="sheet-head"><div><h2>${esc(r.name)}</h2><div class="rmeta">${esc(metaOf(r))}</div></div><button class="btn" data-act="close">Close</button></div>
    <div class="eyebrow" style="margin:4px 0 8px">Add to this week</div>
    <div class="days-row">${days}</div>
    <div class="btn-row" style="margin:14px 0 6px">
      ${meal ? `<button class="btn" data-act="editmeal" data-id="${esc(meal.id)}">Edit</button>`
        : saved ? `<span class="tag saved big">In your meals</span>` : `<button class="btn primary" data-act="saverecipe">Save to my meals</button>`}
      ${r.link ? `<a class="btn" href="${esc(r.link)}" target="_blank" rel="noopener">Original recipe</a>` : ""}
    </div>
    <h3 class="sect">Ingredients</h3><ul class="ings">${ings || `<li>No ingredients listed.</li>`}</ul>
    ${steps ? `<h3 class="sect">Steps</h3><ol class="steps">${steps}</ol>` : ""}`);
}

// ---------- sheets ----------
function openSheet(html) {
  $("#overlay").innerHTML = `<div class="scrim" data-act="close"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const f = $("#overlay [autofocus]"); if (f) f.focus();
}
const closeSheet = () => { $("#overlay").innerHTML = ""; };
const sheetOpen = () => !!$("#overlay").innerHTML;

function openPicker(day) {
  const label = DAYS.find((d) => d[0] === day)[1];
  const rows = sortedMeals().map((m) => `<button class="meal" data-act="plan" data-day="${day}" data-id="${esc(m.id)}"><div><div class="meal-name">${esc(m.name)}</div><div class="meal-ing">${esc((m.ingredients || []).map((i) => i.n).join(", "))}</div></div>${usesOf(m.id) ? `<span class="uses">${usesOf(m.id)}×</span>` : ""}</button>`).join("");
  openSheet(`<div class="sheet-head"><h2>Add to ${label}</h2><button class="btn" data-act="close">Done</button></div>
    <div class="meals">${rows}</div>
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-act="browse">Browse recipes</button><button class="btn" data-act="newmeal" data-day="${day}">+ Create a new meal</button></div>`);
}

function openEditor(meal, forDay) {
  const isNew = !meal;
  const text = meal ? (meal.ingredients || []).map(lineOf).join("\n") : "";
  openSheet(`<form id="meal-form" data-id="${meal ? esc(meal.id) : ""}" data-day="${forDay || ""}">
    <div class="sheet-head"><h2>${isNew ? "New meal" : "Edit meal"}</h2><button class="btn" type="button" data-act="close">Cancel</button></div>
    <label class="field">Meal name<input id="meal-name" required maxlength="80" value="${esc(meal ? meal.name : "")}" placeholder="Chicken tacos" ${isNew ? "autofocus" : ""}></label>
    <label class="field">Ingredients <span class="hint">One per line. Start with an amount to have it added up, like “2 lb ground beef” or “1/2 cup rice”.</span>
      <textarea id="meal-ings" placeholder="1 lb chicken thighs&#10;8 tortillas&#10;1 avocado&#10;cilantro">${esc(text)}</textarea></label>
    <label class="field">Steps <span class="hint">Optional. One step per line.</span>
      <textarea id="meal-steps" class="short" placeholder="Season and cook the chicken.&#10;Warm the tortillas.">${esc(meal && meal.steps ? meal.steps.join("\n") : "")}</textarea></label>
    <div class="btn-row" style="justify-content:space-between">
      ${isNew ? "<span></span>" : `<button type="button" class="btn danger" data-act="delmeal" data-id="${esc(meal.id)}">Delete meal</button>`}
      <button class="btn primary" type="submit">${isNew ? (forDay ? "Save and add" : "Save meal") : "Save changes"}</button>
    </div></form>`);
}

let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; });

function openSettings() {
  const u = state.user || {};
  const account = store.mode === "cloud"
    ? `<div class="setting"><div>Signed in as<small>${esc(u.email || "")}</small></div><button class="btn" data-act="signout">Sign out</button></div>`
    : `<div class="setting"><div>Syncing is off<small>Meals and lists are saved on this device only. See the README to turn on syncing.</small></div></div>`;
  const install = !isNativeApp && installPrompt
    ? `<div class="setting"><div>Install on this computer<small>Opens in its own window and works offline.</small></div><button class="btn primary" data-act="install">Install</button></div>` : "";
  const apk = !isNativeApp && location.protocol === "https:"
    ? `<div class="setting"><div>Android app<small>Open this page on your phone and tap Download to install it.</small></div><a class="btn" href="./week-of-meals.apk">Download</a></div>` : "";
  openSheet(`<div class="sheet-head"><h2>Settings</h2><button class="btn" data-act="close">Done</button></div>${account}${install}${apk}`);
}

// ---------- actions ----------
function setTab(t) {
  state.tab = t;
  try { localStorage.setItem("wom-tab", t); } catch (e) {}
  render(); window.scrollTo(0, 0);
}
function setPlan(plan, cooked = state.cooked) { state.plan = plan; state.cooked = cooked; store.savePlan(plan, cooked); render(); }
function setList(list) { state.list = list; store.saveList(list); render(); }
function setFridge(items) { state.fridge = items; store.saveFridge(items); render(); }

function toggle(key) {
  const checked = Object.assign({}, state.list.checked);
  const nowChecked = !checked[key];
  if (nowChecked) checked[key] = true; else delete checked[key];
  setList(Object.assign({}, state.list, { checked }));
  // Ticking off produce logs it as bought today; unticking the same day takes it back.
  const it = buildList().find((x) => x.key === key);
  if (!it || it.aisle !== "Produce") return;
  const fridge = Object.assign({}, state.fridge);
  const existing = Object.keys(fridge).find((id) => fridge[id].listKey === key && fridge[id].bought === today());
  if (nowChecked && !existing) fridge[uid()] = { name: it.name, listKey: key, bought: today(), shelf: shelfLife(it.name), meals: it.mealIds };
  else if (!nowChecked && existing) delete fridge[existing];
  else return;
  setFridge(fridge);
}

function copyList() {
  const items = buildList().filter((it) => !state.list.checked[it.key]);
  const text = AISLES.map((a) => {
    const g = items.filter((it) => it.aisle === a); if (!g.length) return "";
    return a.toUpperCase() + "\n" + g.map((it) => "- " + it.name + (qtyLabel(it) ? " (" + qtyLabel(it) + ")" : "")).join("\n");
  }).filter(Boolean).join("\n\n");
  const fallback = () => {
    const slot = $("#copy-slot"); if (!slot) return;
    slot.innerHTML = `<textarea class="copy-fallback" readonly aria-label="Shopping list text"></textarea>`;
    const ta = slot.firstChild; ta.value = text; ta.focus(); ta.select();
    toast("Text selected. Copy it from here.");
  };
  try { navigator.clipboard.writeText(text).then(() => toast("List copied"), fallback); } catch (e) { fallback(); }
}

const STARTERS = [
  ["Chicken tacos", "1.5 lb chicken thighs\n8 tortillas\n1 avocado\n1 lime\n1 bunch cilantro\n1 cup salsa\n1 cup shredded cheddar"],
  ["Spaghetti and meat sauce", "1 lb ground beef\n1 lb spaghetti\n1 jar marinara sauce\n1 onion\n3 cloves garlic\n1/2 cup parmesan"],
  ["Sheet-pan salmon and broccoli", "1.5 lb salmon\n2 heads broccoli\n1 lemon\n2 tbsp olive oil\n2 cloves garlic"],
  ["Veggie stir-fry", "1 pkg tofu\n2 bell pepper\n1 head broccoli\n2 carrot\n2 cups rice\n3 tbsp soy sauce\n1 tbsp ginger"],
  ["Turkey chili", "1 lb ground turkey\n2 can kidney beans\n1 can diced tomatoes\n1 onion\n2 tbsp chili powder\n1 cup shredded cheddar"],
  ["Breakfast for dinner", "12 eggs\n1 lb bacon\n1 loaf bread\n2 tbsp butter\n2 cups berries"]
];

const AUTH_ERRORS = {
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "Use a password with at least 6 characters.",
  "auth/email-already-in-use": "There's already an account with that email. Sign in instead.",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-not-found": "No account uses that email. Create one first.",
  "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
  "auth/network-request-failed": "No internet connection. Connect and try again.",
  "auth/operation-not-allowed": "Email sign-in isn't turned on in your Firebase project yet (Authentication > Sign-in method)."
};

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act;
  if (act === "close") { if (t.classList.contains("scrim") && e.target !== t) return; closeSheet(); return; }
  switch (act) {
    case "tab": setTab(t.dataset.tab); break;
    case "settings": openSettings(); break;
    case "authmode": state.authMode = t.dataset.mode; state.authMsg = null; $("#app").innerHTML = renderAuth(); break;
    case "signout": closeSheet(); store.signOut(); break;
    case "install": if (installPrompt) { installPrompt.prompt(); installPrompt = null; closeSheet(); } break;
    case "pick": openPicker(t.dataset.day); break;
    case "plan": {
      const d = t.dataset.day;
      setPlan(Object.assign({}, state.plan, { [d]: (state.plan[d] || []).concat(t.dataset.id) }));
      closeSheet(); toast("Added to " + DAYS.find((x) => x[0] === d)[1]); break;
    }
    case "unplan": {
      const d = t.dataset.day, arr = (state.plan[d] || []).filter(mealById);
      arr.splice(+t.dataset.idx, 1);
      setPlan(Object.assign({}, state.plan, { [d]: arr })); break;
    }
    case "clearweek":
      if (armed !== "clearweek") { arm("clearweek"); break; }
      armed = null;
      // Produce in the fridge stays tracked, so leftovers carry into the new week.
      setPlan({}, {}); setList({ checked: {}, extras: [] }); toast("Week cleared"); break;
    case "newmeal": openEditor(null, t.dataset.day); break;
    case "editmeal": openEditor(mealById(t.dataset.id)); break;
    case "browse": closeSheet(); setTab("discover"); break;
    case "cook": toggleCooked(t.dataset.day, t.dataset.id); break;
    case "fridge": openFridge(); break;
    case "fused": removeFridge(t.dataset.id); openFridge(); toast("Marked as used"); break;
    case "ftoss": removeFridge(t.dataset.id); openFridge(); toast("Removed from your fridge"); break;
    case "idea": { const c = lastIdeas[+t.dataset.idx]; if (c) openRecipe(c.r, c.meal); break; }
    case "viewmeal": { const m = mealById(t.dataset.id); if (m) openRecipe(m, m); break; }
    case "filter": discover.filter = t.dataset.filter; render(); break;
    case "clearonline": discover.online = null; render(); break;
    case "recipe": {
      const r = t.dataset.src === "lib" ? BUILT_IN[+t.dataset.idx] : discover.online && discover.online.results[+t.dataset.idx];
      if (r) openRecipe(r, null); break;
    }
    case "saverecipe":
      if (sheetRecipe) { saveRecipe(sheetRecipe.r); openRecipe(sheetRecipe.r, null); render(); toast("Saved to your meals"); }
      break;
    case "recipeday": {
      if (!sheetRecipe) break;
      const d = t.dataset.day, id = sheetRecipe.meal ? sheetRecipe.meal.id : saveRecipe(sheetRecipe.r);
      setPlan(Object.assign({}, state.plan, { [d]: (state.plan[d] || []).concat(id) }));
      closeSheet(); toast("Added to " + DAYS.find((x) => x[0] === d)[1]); break;
    }
    case "delmeal": {
      if (!t.classList.contains("armed")) {
        t.classList.add("armed"); t.classList.remove("danger"); t.textContent = "Tap again to delete";
        setTimeout(() => { if (t.isConnected) { t.classList.remove("armed"); t.classList.add("danger"); t.textContent = "Delete meal"; } }, 3500);
        break;
      }
      const id = t.dataset.id, plan = {};
      for (const [k] of DAYS) plan[k] = (state.plan[k] || []).filter((x) => x !== id);
      setPlan(plan); store.deleteMeal(id); closeSheet(); toast("Meal deleted"); break;
    }
    case "starters":
      for (const [name, text] of STARTERS) store.saveMeal({ id: uid(), name, ingredients: text.split("\n").map(parseLine), example: true });
      toast("Added " + STARTERS.length + " starter meals"); break;
    case "toggle": toggle(t.dataset.key); break;
    case "delextra": setList(Object.assign({}, state.list, { extras: state.list.extras.filter((x) => x.id !== t.dataset.id) })); break;
    case "uncheck": setList(Object.assign({}, state.list, { checked: {} })); break;
    case "copy": copyList(); break;
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && sheetOpen()) closeSheet();
  const row = e.target.closest && e.target.closest(".item[data-act=toggle]");
  if (row && e.target === row && (e.key === " " || e.key === "Enter")) { e.preventDefault(); toggle(row.dataset.key); }
});

document.addEventListener("input", (e) => {
  if (e.target.id === "meal-search") { mealQuery = e.target.value; render(); }
  if (e.target.id === "discover-search") { discover.query = e.target.value; render(); }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.id === "fridge-form") {
    const name = $("#fridge-input").value.trim(); if (!name) return;
    setFridge(Object.assign({}, state.fridge, { [uid()]: { name, listKey: "", bought: today(), shelf: shelfLife(name), meals: [] } }));
    openFridge(); const n = $("#fridge-input"); if (n) n.focus();
  }
  if (f.id === "discover-form") {
    const q = $("#discover-search").value.trim();
    if (q) searchOnline(q); else $("#discover-search").focus();
  }
  if (f.id === "extra-form") {
    const text = $("#extra-input").value.trim(); if (!text) return;
    setList(Object.assign({}, state.list, { extras: state.list.extras.concat({ id: uid(), text }) }));
    const n = $("#extra-input"); if (n) n.focus();
  }
  if (f.id === "meal-form") {
    const name = $("#meal-name").value.trim(); if (!name) { $("#meal-name").focus(); return; }
    const ingredients = $("#meal-ings").value.split("\n").map((l) => l.trim()).filter(Boolean).map(parseLine);
    const steps = $("#meal-steps").value.split("\n").map((l) => l.trim()).filter(Boolean);
    const id = f.dataset.id || uid();
    // Keep a saved recipe's time, servings, photo and source when editing it.
    const old = mealById(id) || {};
    const meal = { ...old, id, name, ingredients, steps };
    delete meal.example;
    store.saveMeal(meal);
    if (!f.dataset.id && f.dataset.day) {
      const d = f.dataset.day;
      setPlan(Object.assign({}, state.plan, { [d]: (state.plan[d] || []).concat(id) }));
    }
    closeSheet(); toast(f.dataset.id ? "Saved" : "Meal added");
  }
  if (f.id === "auth-form") {
    const email = $("#auth-email").value.trim(), pwEl = $("#auth-pw"), pw = pwEl ? pwEl.value : "";
    const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    const show = (msg) => { state.authMsg = msg; $("#app").innerHTML = renderAuth(); const em = $("#auth-email"); if (em) em.value = email; };
    try {
      if (state.authMode === "reset") { await store.reset(email); state.authMode = "signin"; show({ ok: true, text: "Check your email for a link to reset your password." }); }
      else if (state.authMode === "signup") { await store.signUp(email, pw); }
      else { await store.signIn(email, pw); }
    } catch (err) {
      show({ text: AUTH_ERRORS[err && err.code] || "Something went wrong. Try again." });
    }
  }
});

window.addEventListener("online", () => { state.online = true; render(); });
window.addEventListener("offline", () => { state.online = false; render(); });

// Android back button: close an open sheet first, otherwise go to the Week tab, then exit.
const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
if (capApp) {
  capApp.addListener("backButton", () => {
    if (sheetOpen()) closeSheet();
    else if (state.phase === "app" && state.tab !== "week") setTab("week");
    else capApp.exitApp();
  });
}

let toastTimer;
function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// Offline support for the installed desktop app (the Android app ships its files inside the APK).
if ("serviceWorker" in navigator && !isNativeApp && location.protocol === "https:" && location.hostname !== "localhost") {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

render();
