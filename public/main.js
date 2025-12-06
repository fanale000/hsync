/**
 * main.js — cleaned, documented, simplified
 *
 * Goals:
 * - Keep behavior intact (join/create/event/appearance, Google sign-in + calendar overlay)
 * - Remove duplicated/stray code, consolidate helpers
 * - Add clear comments for each section so it's easy to read and modify
 *
 * Note: this file intentionally keeps higher-level helpers minimal and
 * relies on the same DOM ids used by the HTML files in /public.
 */

const GOOGLE_CLIENT_ID = "19747295970-tp902n56girks9e8kegdl1vlod13l3ti.apps.googleusercontent.com";

/* -------------------------
   Small helpers
   ------------------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel));
const getQueryParam = (name) => new URL(window.location.href).searchParams.get(name);

/**
 * Lightweight fetch -> JSON utility that throws on non-2xx.
 * Returns parsed JSON or throws Error with message.
 */
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text().catch(() => "");
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) {
    const msg = data?.error || data?.message || res.statusText || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * Decode a JWT id_token payload (safe best-effort).
 */
function parseJwt(token) {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    // decodeURIComponent(escape(...)) is a compatibility shim for some environments
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (e) {
    return null;
  }
}

/* -------------------------
   Local storage helpers
   ------------------------- */
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeRemove(key) { try { localStorage.removeItem(key); } catch (e) {} }

function setLastOpenedEvent(id) { if (id) safeSet("hsync:lastOpenedEvent", String(id)); else safeRemove("hsync:lastOpenedEvent"); }
function getLastOpenedEvent() { return safeGet("hsync:lastOpenedEvent"); }
function setLastJoinedEvent(id) { if (id) safeSet("hsync:lastJoinedEvent", String(id)); else safeRemove("hsync:lastJoinedEvent"); }
function getLastJoinedEvent() { return safeGet("hsync:lastJoinedEvent"); }

/* -------------------------
   Google / Calendar helpers
   ------------------------- */
/*
  We keep a single token client instance and expose a Promise-based function
  to obtain an access token. This function will prompt the user if consent is required.
*/
let calendarTokenClient = null;

/**
 * Request a calendar access token via google.accounts.oauth2.initTokenClient.
 * Resolves with access token string or rejects with an Error.
 */
function getCalendarAccessToken() {
  return new Promise((resolve, reject) => {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      return reject(new Error("Google API not loaded yet."));
    }
    if (!calendarTokenClient) {
      try {
        calendarTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          // readonly calendar + basic profile to fetch picture/name if needed
          scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.profile",
          callback: (resp) => {
            if (resp && resp.access_token) resolve(resp.access_token);
            else reject(new Error("No access token returned"));
          },
        });
      } catch (e) {
        return reject(e);
      }
    }
    try {
      calendarTokenClient.requestAccessToken();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Send idToken -> backend for session creation (optional).
 * Returns backend user object when available or null on error.
 */
async function sendGoogleIdTokenToBackend(idToken) {
  if (!idToken) return null;
  try {
    const data = await fetchJson("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    return data.user || null;
  } catch (e) {
    console.warn("Backend google token exchange failed:", e);
    return null;
  }
}

/**
 * Optionally send calendar access token to backend (best-effort).
 */
async function sendCalendarAccessTokenToBackend(accessToken) {
  if (!accessToken) return;
  try {
    await fetchJson("/api/auth/google_calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
  } catch (e) {
    console.warn("Failed to send calendar token to backend:", e);
  }
}

/**
 * Fetch google profile info using an access token (userinfo endpoint).
 */
async function fetchGoogleUserInfo(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error("Failed to fetch userinfo");
    return await res.json();
  } catch (e) {
    console.warn("fetchGoogleUserInfo:", e);
    return null;
  }
}

/* -------------------------
   Topbar / profile UI helpers
   ------------------------- */
function setTopbarProfile(pictureUrl, name) {
  const pic = $("#topbar-profile-pic");
  const container = $("#gsi-topbar");
  if (pic) {
    if (pictureUrl) { pic.src = pictureUrl; pic.style.display = "inline-block"; }
    else { pic.src = ""; pic.style.display = "none"; }
  }
  if (container) container.style.display = pictureUrl ? "none" : "inline-flex";
  // persist to reuse across pages
  if (pictureUrl) safeSet("hsync:profilePic", pictureUrl); else safeRemove("hsync:profilePic");
  if (name) safeSet("hsync:profileName", name); else safeRemove("hsync:profileName");
}

/**
 * Render the Google Sign-in (GSI) button in the small topbar slot.
 * Requires google.accounts.id to be available (gsi script loaded).
 */
function initTopbarGsi() {
  const el = $("#gsi-topbar");
  if (!el || !window.google || !google.accounts || !google.accounts.id) return;
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: window.handleGoogleCredentialResponse,
      auto_select: false,
    });
    google.accounts.id.renderButton(el, { type: "icon", theme: "outline", size: "small", shape: "circle", logo_alignment: "left" });
  } catch (e) {
    // non-fatal
    console.warn("initTopbarGsi:", e);
  }
}

/* -------------------------
   Google callback: id_token
   ------------------------- */
/**
 * Called by Google Identity on successful credential (id_token).
 * We:
 *  - optionally forward the token to server
 *  - update topbar profile picture / name
 *  - if on event page, attempt to request calendar access and apply overlay
 */
window.handleGoogleCredentialResponse = async (resp) => {
  if (!resp?.credential) return;
  // decode basic profile from id_token
  const payload = parseJwt(resp.credential);
  const name = payload?.name || payload?.given_name || null;
  const picture = payload?.picture || null;
  if (picture || name) setTopbarProfile(picture, name);

  // try to validate/create session on backend (non-blocking)
  sendGoogleIdTokenToBackend(resp.credential).catch(() => {});

  // if on event page, proactively try calendar access (best-effort)
  if (document.body.classList.contains("page-event")) {
    try {
      const token = await getCalendarAccessToken().catch(() => null);
      if (token) {
        await sendCalendarAccessTokenToBackend(token).catch(() => {});
        // attempt to fetch profile via token if we didn't get it from id_token
        if (!picture || !name) {
          const info = await fetchGoogleUserInfo(token).catch(() => null);
          if (info) setTopbarProfile(info.picture || null, info.name || null);
        }
        // trigger event overlay if available
        if (typeof window.loadCalendarOverlayForCurrentEvent === "function") {
          const statusEl = $("#calendar-overlay-status");
          window.loadCalendarOverlayForCurrentEvent(statusEl);
        }
      }
    } catch (e) {
      console.warn("Calendar access after sign-in failed:", e);
      const statusEl = $("#calendar-overlay-status");
      if (statusEl) statusEl.textContent = "Calendar overlay not enabled (grant access to use).";
    }
  }
};

/* -------------------------
   Sign-out helper (local) — best-effort
   ------------------------- */
async function signOutAllGoogle() {
  try { if (window.google && google.accounts && google.accounts.id && google.accounts.id.disableAutoSelect) google.accounts.id.disableAutoSelect(); } catch (e) {}
  try { await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); } catch (e) {}
  safeRemove("hsync:profilePic"); safeRemove("hsync:profileName");
  safeRemove("hsync:lastOpenedEvent"); safeRemove("hsync:lastJoinedEvent");
  setTopbarProfile(null, null);
  // reload to clear any in-memory state
  window.location.reload();
}

/* -------------------------
   Simple page initializers
   ------------------------- */

/* load user + theme from backend (keeps previous behavior) */
async function loadCurrentUserAndTheme() {
  try {
    const me = await fetchJson("/api/me").catch(() => ({ user: null }));
    const themePrefs = await fetchJson("/api/theme").catch(() => null);
    if (themePrefs) {
      if (themePrefs.theme) document.documentElement.dataset.theme = themePrefs.theme;
      if (themePrefs.density) document.documentElement.dataset.density = themePrefs.density;
    }
    return { user: (me && me.user) || null, themePrefs: themePrefs || null };
  } catch (err) {
    // ensure defaults
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || "harvard";
    document.documentElement.dataset.density = document.documentElement.dataset.density || "comfortable";
    return { user: null, themePrefs: null };
  }
}

/* Home page: create event form wiring (keeps existing API contract) */
function initHomePage() {
  const form = $("#create-event-form");
  if (!form) return;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const title = ($("#title")?.value || "").trim();
    const startDate = $("#start-date")?.value;
    const endDate = $("#end-date")?.value;
    const startTime = $("#start-time")?.value;
    const endTime = $("#end-time")?.value;
    const slotMinutes = Number($("#slot-minutes")?.value || 30);
    if (!title || !startDate || !endDate || !startTime || !endTime) {
      alert("Please fill out all fields.");
      return;
    }
    try {
      const data = await fetchJson("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, startDate, endDate, startTime, endTime, slotMinutes }),
      });
      window.location.href = `/event.html?id=${encodeURIComponent(data.id)}`;
    } catch (err) {
      console.error(err);
      alert(err.message || "Error creating event.");
    }
  });

  // optional logout button on home (if present)
  const logoutBtn = $("#logout-all-google");
  if (logoutBtn) logoutBtn.addEventListener("click", (e) => { e.preventDefault(); if (confirm("Sign out of Google and clear saved profile info?")) signOutAllGoogle(); });
}

/* Join page: parse input and open event */
function initJoinPage() {
  const input = $("#join-event-input");
  const openBtn = $("#join-open-button");
  const msg = $("#join-saved-msg");
  const queryId = getQueryParam("id");

  function saveAndReport(id) { try { setLastJoinedEvent(id); } catch (e) {} if (msg) msg.textContent = `Saved poll ${id}. Click "Open poll" to go to it.`; }

  if (queryId) { if (input) input.value = queryId; saveAndReport(queryId); }
  else {
    const last = getLastJoinedEvent();
    if (last && input) input.value = last;
    if (last && msg) msg.textContent = `Last saved poll: ${last}`;
  }

  if (openBtn) {
    openBtn.addEventListener("click", () => {
      const raw = (input?.value || "").trim();
      if (!raw) return;
      // try to extract id from URL or accept raw id
      let id = raw;
      try {
        const maybeUrl = new URL(raw);
        const match = maybeUrl.searchParams.get("id");
        if (match) id = match;
        else {
          const parts = maybeUrl.pathname.split("/");
          id = parts[parts.length - 1] || parts[parts.length - 2] || "";
          if (id === "event.html") id = maybeUrl.searchParams.get("id") || "";
        }
      } catch { /* plain id allowed */ }
      if (!id) { alert("Could not find an event id in that link."); return; }
      saveAndReport(id);
      window.location.href = `/event.html?id=${encodeURIComponent(id)}`;
    });
  }
}

/* Event page: grid & availability + calendar overlay wiring.
   This initializer intentionally remains compact: it calls loadEvent()
   which is implemented here and wires overlay & save behavior.
*/
function initEventPage() {
  const eventId = getQueryParam("id");
  if (!eventId) { alert("Missing event id in URL."); return; }

  // DOM cache
  const gridEl = $("#availability-grid");
  const titleEl = $("#event-title");
  const shareEl = $("#share-link");
  const rangeDay = $("#range-day");
  const rangeFrom = $("#range-from");
  const rangeTo = $("#range-to");
  const rangeApply = $("#range-apply");
  const bestSlots = $("#best-slots");
  const participantCountEl = $("#participant-count");
  const participantName = $("#participant-name");
  const saveBtn = $("#save-availability");
  const clearBtn = $("#clear-availability");
  const overlayBtn = $("#load-calendar-overlay") || $("#overlay-calendar");
  const overlayStatus = $("#calendar-overlay-status");

  const mySlotsKey = `hsync:${eventId}:mySlots`;
  const myNameKey = `hsync:${eventId}:myName`;

  let eventData = null;
  let cellsByIndex = new Map();
  let mySlots = new Set(JSON.parse(safeGet(mySlotsKey) || "[]").map(Number));
  let calendarBusy = new Set();

  if (safeGet(myNameKey) && participantName) participantName.value = safeGet(myNameKey);
  if (shareEl) shareEl.value = window.location.href;

  // pointer drag helpers
  let isDown = false;
  let dragMode = null;
  window.addEventListener("pointerup", () => { isDown = false; dragMode = null; });

  /* Fetch event from backend and render UI */
  async function loadEvent() {
    try {
      eventData = await fetchJson(`/api/events/${encodeURIComponent(eventId)}`);
      if (titleEl) titleEl.textContent = eventData.title || "Availability poll";
      renderRangeOptions();
      renderGrid();
      renderBestSlots();
    } catch (err) {
      console.error(err);
      alert(err.message || "Error loading event.");
    }
  }

  function renderRangeOptions() {
    if (!rangeDay || !eventData) return;
    rangeDay.innerHTML = "";
    eventData.dates.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = (new Date(d + "T00:00:00")).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
      rangeDay.appendChild(opt);
    });
  }

  function attachCellListeners(cell) {
    cell.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const idx = Number(cell.dataset.index);
      const isSelected = mySlots.has(idx);
      isDown = true;
      dragMode = isSelected ? "remove" : "add";
      toggleSlot(idx, dragMode === "add");
    });
    cell.addEventListener("pointerenter", () => {
      if (!isDown || !dragMode) return;
      toggleSlot(Number(cell.dataset.index), dragMode === "add");
    });
  }

  function toggleSlot(idx, select) {
    if (!Number.isInteger(idx)) return;
    const cell = cellsByIndex.get(idx);
    if (!cell) return;
    if (select) { mySlots.add(idx); cell.classList.add("my-slot"); }
    else { mySlots.delete(idx); cell.classList.remove("my-slot"); }
    safeSet(mySlotsKey, JSON.stringify(Array.from(mySlots)));
  }

  function renderGrid() {
    if (!gridEl || !eventData) return;
    gridEl.innerHTML = "";
    cellsByIndex = new Map();
    const days = eventData.dates.length;
    const rows = eventData.grid.slotsPerDay;
    const maxCount = eventData.grid.maxCount || 0;
    const aggregate = eventData.grid.aggregate || [];

    const templateCols = `minmax(60px,80px) repeat(${days}, minmax(56px,1fr))`;

    // header row
    const header = document.createElement("div");
    header.className = "grid-header-row";
    header.style.gridTemplateColumns = templateCols;
    header.appendChild(Object.assign(document.createElement("div"), { className: "grid-time-cell" }));
    eventData.dates.forEach((d) => {
      const h = document.createElement("div");
      h.className = "grid-day-header";
      h.textContent = (new Date(d + "T00:00:00")).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
      header.appendChild(h);
    });
    gridEl.appendChild(header);

    // rows
    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "grid-row";
      rowEl.style.gridTemplateColumns = templateCols;
      const timeCell = document.createElement("div");
      timeCell.className = "grid-time-cell";
      timeCell.textContent = eventData.times[r] || "";
      rowEl.appendChild(timeCell);

      for (let d = 0; d < days; d++) {
        const idx = d * rows + r;
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.index = String(idx);
        const count = (aggregate[r] && aggregate[r][d]) || 0;
        const level = maxCount === 0 ? 0 : Math.ceil((count / maxCount) * 4);
        cell.classList.add(`heat-${level}`);
        if (mySlots.has(idx)) cell.classList.add("my-slot");
        attachCellListeners(cell);
        cellsByIndex.set(idx, cell);
        rowEl.appendChild(cell);
      }
      gridEl.appendChild(rowEl);
    }
  }

  function renderBestSlots() {
    if (!bestSlots || !eventData) return;
    bestSlots.innerHTML = "";
    const agg = eventData.grid.aggregate || [];
    const who = eventData.grid.who || [];
    const rows = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const participants = eventData.participants || [];

    const items = [];
    for (let d = 0; d < days; d++) {
      for (let r = 0; r < rows; r++) {
        const cnt = (agg[r] && agg[r][d]) || 0;
        if (cnt <= 0) continue;
        items.push({ day: d, row: r, count: cnt, names: (who[r] && who[r][d]) || [] });
      }
    }
    items.sort((a, b) => b.count - a.count);
    if (items.length === 0) {
      const li = document.createElement("li"); li.textContent = "No availability submitted yet."; bestSlots.appendChild(li); 
    } else {
      items.slice(0, 5).forEach((s) => {
        const li = document.createElement("li");
        li.innerHTML = `<div class="best-slot-main"><span>${(new Date(eventData.dates[s.day] + "T00:00:00")).toLocaleDateString(undefined,{ weekday:"short", month:"numeric", day:"numeric" })} @ ${eventData.times[s.row]}</span><span>${s.count} available</span></div>`;
        const p = document.createElement("div");
        p.className = "best-slot-participants";
        if (!s.names.length) p.textContent = "No one has picked this time yet.";
        else {
          const label = document.createElement("span"); label.textContent = "Participants:"; p.appendChild(label);
          const sel = document.createElement("select"); sel.className = "participant-dropdown";
          const opt = document.createElement("option"); opt.disabled = true; opt.selected = true; opt.textContent = `${s.names.length} participant${s.names.length>1?"s":""}`; sel.appendChild(opt);
          s.names.forEach(n => { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });
          p.appendChild(sel);
        }
        li.appendChild(p);
        bestSlots.appendChild(li);
      });
    }
    if (participantCountEl) participantCountEl.textContent = `${(eventData.participants || []).length} participant${(eventData.participants||[]).length===1? "": "s"} have responded.`;
  }

  async function saveAvailability() {
    if (!eventData) return;
    const name = (participantName?.value || "").trim();
    if (!name) { alert("Please enter your name before saving."); participantName?.focus(); return; }
    try {
      await fetchJson(`/api/events/${encodeURIComponent(eventId)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantName: name, slots: Array.from(mySlots) }),
      });
      safeSet(myNameKey, name);
      alert("Availability saved!");
      await loadEvent();
    } catch (e) {
      console.error(e);
      alert(e.message || "Error saving availability.");
    }
  }

  function clearMyAvailability() {
    mySlots = new Set();
    safeSet(mySlotsKey, JSON.stringify([]));
    cellsByIndex.forEach(c => c.classList.remove("my-slot"));
  }

  function buildSlotRanges() {
    if (!eventData) return [];
    const perDay = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const minutes = eventData.slotMinutes;
    const ranges = new Array(days * perDay);
    for (let d = 0; d < days; d++) {
      for (let r = 0; r < perDay; r++) {
        const startMin = eventData.startTimeMinutes + r * minutes;
        const h = Math.floor(startMin / 60).toString().padStart(2, "0");
        const m = (startMin % 60).toString().padStart(2, "0");
        const start = new Date(`${eventData.dates[d]}T${h}:${m}:00`).getTime();
        const end = start + minutes * 60000;
        ranges[d * perDay + r] = { start, end };
      }
    }
    return ranges;
  }

  /* Calendar overlay: fetch primary calendar events and mark overlapping slots */
  async function loadCalendarOverlayForCurrentEvent(statusEl) {
    if (!eventData) { if (statusEl) statusEl.textContent = "Event not loaded yet."; return; }
    try {
      if (statusEl) statusEl.textContent = "Contacting Google Calendar...";
      const token = await getCalendarAccessToken();
      if (!token) throw new Error("No calendar token");
      // fetch events
      const first = eventData.dates[0];
      const last = eventData.dates[eventData.dates.length - 1];
      const startISO = new Date(`${first}T${String(Math.floor(eventData.startTimeMinutes/60)).padStart(2,"0")}:${String(eventData.startTimeMinutes%60).padStart(2,"0")}:00`).toISOString();
      const endISO = new Date(`${last}T${String(Math.floor(eventData.endTimeMinutes/60)).padStart(2,"0")}:${String(eventData.endTimeMinutes%60).padStart(2,"0")}:00`).toISOString();
      const params = new URLSearchParams({ timeMin: startISO, timeMax: endISO, singleEvents: "true", orderBy: "startTime" });
      const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!resp.ok) throw new Error(`Calendar error ${resp.status}`);
      const data = await resp.json();
      const ranges = buildSlotRanges();
      calendarBusy.clear();
      for (const ev of (data.items || [])) {
        const s = new Date(ev.start?.dateTime || (ev.start?.date + "T00:00:00")).getTime();
        const e = new Date(ev.end?.dateTime || (ev.end?.date + "T23:59:59")).getTime();
        ranges.forEach((r, idx) => { if (r && r.start < e && r.end > s) calendarBusy.add(idx); });
      }
      // apply to DOM
      cellsByIndex.forEach((cell, idx) => {
        cell.classList.toggle("busy-calendar", calendarBusy.has(idx));
      });
      if (statusEl) statusEl.textContent = `Overlay applied from ${(data.items||[]).length} event(s).`;
      // optionally send token to backend
      sendCalendarAccessTokenToBackend(token).catch(() => {});
    } catch (e) {
      console.error(e);
      if (statusEl) statusEl.textContent = e.message || "Failed to load calendar overlay.";
    }
  }

  // wire UI
  saveBtn && saveBtn.addEventListener("click", saveAvailability);
  clearBtn && clearBtn.addEventListener("click", clearMyAvailability);
  rangeApply && rangeApply.addEventListener("click", (ev) => { ev.preventDefault(); 
    // apply range: same logic as previous implementation (kept short)
    const dayIndex = Number(rangeDay?.value || 0);
    const from = rangeFrom?.value;
    const to = rangeTo?.value;
    if (!from || !to) { alert("Please fill both From and To times."); return; }
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    const fromMinutes = fh*60 + fm;
    const toMinutes = th*60 + tm;
    if (toMinutes <= fromMinutes) { alert("End time must be after start time."); return; }
    const start = eventData.startTimeMinutes;
    const step = eventData.slotMinutes;
    const rows = eventData.grid.slotsPerDay;
    const clamp = (mins) => Math.max(0, Math.min(rows-1, Math.floor((mins - start)/step)));
    const sRow = clamp(fromMinutes);
    const eRow = clamp(toMinutes-1);
    for (let r = sRow; r <= eRow; r++) toggleSlot(dayIndex * rows + r, true);
  });

  if (overlayBtn) overlayBtn.addEventListener("click", () => loadCalendarOverlayForCurrentEvent(overlayStatus));
  // expose loader for other code (e.g. sign-in flow)
  window.loadCalendarOverlayForCurrentEvent = loadCalendarOverlayForCurrentEvent;

  // initial load
  loadEvent();
}

/* Appearance page (kept minimal) */
function initAppearancePage() {
  const form = $("#appearance-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const theme = form.querySelector('input[name="theme"]:checked')?.value;
    const density = form.querySelector('input[name="density"]:checked')?.value;
    try {
      const data = await fetchJson("/api/theme", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ theme, density }) });
      if (data?.theme) document.documentElement.dataset.theme = data.theme;
      alert("Appearance saved.");
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to save appearance.");
    }
  });
}

/* -------------------------
   Boot: DOMContentLoaded wiring
   ------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // rehydrate small topbar profile if stored
  const storedPic = safeGet("hsync:profilePic");
  const storedName = safeGet("hsync:profileName");
  if (storedPic || storedName) setTopbarProfile(storedPic, storedName);
  // render GSI in topbar if available after a short delay
  setTimeout(initTopbarGsi, 200);

  if (document.body.classList.contains("page-home")) loadCurrentUserAndTheme().then(initHomePage);
  if (document.body.classList.contains("page-join")) loadCurrentUserAndTheme().then(initJoinPage);
  if (document.body.classList.contains("page-event")) loadCurrentUserAndTheme().then(initEventPage);
  if (document.body.classList.contains("page-appearance")) initAppearancePage();

  // Topbar Event link behavior: open saved event id (or fallback) from any page
  try {
    const eventLink = document.querySelector('.topbar-nav a[href="event.html"]');
    if (eventLink) eventLink.addEventListener("click", (ev) => {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
      ev.preventDefault();
      const last = getLastOpenedEvent() || getLastJoinedEvent();
      if (last) window.location.href = `/event.html?id=${encodeURIComponent(last)}`;
      else window.location.href = "/join.html";
    });
  } catch (e) { console.warn("Could not wire Event topbar link:", e); }
});
