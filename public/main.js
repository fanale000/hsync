// public/main.js (refactored)

const GOOGLE_CLIENT_ID =
  "19747295970-tp902n56girks9e8kegdl1vlod13l3ti.apps.googleusercontent.com";

// ---------- Small helpers ----------
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const getQueryParam = (name) => new URL(window.location.href).searchParams.get(name);

const fetchJson = async (url, opts = {}) => {
  const res = await fetch(url, opts);
  const text = await res.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // leave data empty
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
};

function formatDateLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric",
  });
}

// ---------- Google / Calendar overlay ----------
let calendarTokenClient = null;
let calendarBusySlots = new Set();

function getCalendarAccessToken() {
  return new Promise((resolve, reject) => {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      reject(new Error("Google API not loaded yet. Try again in a moment."));
      return;
    }
    if (!calendarTokenClient) {
      calendarTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "https://www.googleapis.com/auth/calendar.readonly",
        callback: (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            resolve(tokenResponse.access_token);
          } else {
            reject(new Error("No access token received from Google."));
          }
        },
        error_callback: (err) => {
          reject(new Error(`Google OAuth error: ${err?.type || "unknown"}`));
        },
      });
    }
    calendarTokenClient.requestAccessToken();
  });
}

// ---------- Theme / user helpers ----------
function applyTheme(themePrefs) {
  const root = document.documentElement;
  if (!themePrefs) return;
  if (themePrefs.theme) root.dataset.theme = themePrefs.theme;
  if (themePrefs.density) root.dataset.density = themePrefs.density;
}

async function loadCurrentUserAndTheme() {
  try {
    const me = await fetchJson("/api/me").catch(() => ({ user: null }));
    let themePrefs = null;
    try {
      themePrefs = await fetchJson("/api/theme").catch(() => null);
    } catch {}
    const prefs = themePrefs || { theme: "harvard", density: "comfortable" };
    applyTheme(prefs);
    return { user: (me && me.user) || null, themePrefs: themePrefs || null };
  } catch (err) {
    console.error("loadCurrentUserAndTheme:", err);
    applyTheme({ theme: "harvard", density: "comfortable" });
    return { user: null, themePrefs: null };
  }
}

async function sendGoogleTokenToBackend(idToken) {
  return await fetchJson("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  }).then((d) => d.user);
}

window.handleGoogleCredentialResponse = async (response) => {
  try {
    const user = await sendGoogleTokenToBackend(response.credential);
    console.log("Signed in as", user);
    const nameInput = $("#participant-name");
    if (nameInput && user?.name) nameInput.value = user.name;
    const badge = $("#signed-in-user");
    if (badge) badge.textContent = user?.name ? `Signed in as ${user.name}` : "Signed in";

    // Attempt to obtain Calendar access immediately after sign-in so
    // a single sign-in covers both identity (name) and calendar overlay.
    async function sendCalendarTokenToBackend(accessToken) {
      try {
        await fetchJson("/api/auth/google_calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        });
      } catch (err) {
        // non-fatal: backend may not support storing calendar tokens
        console.warn("Failed to send calendar access token to backend:", err);
      }
    }

    if (document.body.classList.contains("page-event") && typeof loadCalendarOverlayForCurrentEvent === "function") {
      // Request calendar access token (this may prompt consent if needed).
      try {
        const accessToken = await getCalendarAccessToken().catch((e) => { throw e; });
        if (accessToken) {
          // Optional: send to backend for server-side requests / refresh handling
          await sendCalendarTokenToBackend(accessToken).catch(() => {});
          // Immediately apply overlay now that we have an access token
          const status = $("#calendar-overlay-status");
          if (status) {
            // loadCalendarOverlayForCurrentEvent will call the Calendar API using
            // the token-client (getCalendarAccessToken) internally; calling it here
            // ensures the overlay is applied as soon as possible.
            loadCalendarOverlayForCurrentEvent(status);
          }
        }
      } catch (err) {
        // User may have denied calendar consent or token client not ready.
        // Keep the signed-in state (name) while letting the user opt-in later.
        console.warn("Calendar access not granted or failed to obtain token:", err);
        const status = $("#calendar-overlay-status");
        if (status) status.textContent = "Calendar overlay not enabled (grant access to use).";
      }
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Google sign-in failed.");
  }
};

// ---------- Appearance page ----------
function initAppearancePage() {
  const form = $("#appearance-form");
  const warningEl = $("#appearance-warning");
  const badgeEl = $("#signed-in-user");
  if (!form) return;

  loadCurrentUserAndTheme().then(({ user, themePrefs }) => {
    if (!user) {
      warningEl && (warningEl.textContent = "Sign in with Google on the Home or Event page to save your appearance settings.");
      badgeEl && (badgeEl.textContent = "Not signed in");
    } else {
      badgeEl && (badgeEl.textContent = `Signed in as ${user.name || user.email}`);
      warningEl && (warningEl.textContent = "");
    }
    const prefs = themePrefs || { theme: "harvard", density: "comfortable" };
    $$('input[name="theme"]', form).forEach((inp) => (inp.checked = inp.value === prefs.theme));
    $$('input[name="density"]', form).forEach((inp) => (inp.checked = inp.value === prefs.density));
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const theme = form.querySelector('input[name="theme"]:checked')?.value;
    const density = form.querySelector('input[name="density"]:checked')?.value;
    try {
      const data = await fetchJson("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, density }),
      });
      applyTheme(data.theme);
      alert("Appearance saved!");
    } catch (err) {
      console.error(err);
      alert(err.message || "Error saving appearance (are you signed in?)");
    }
  });
}

// ---------- Home page (create / join) ----------
function initHomePage() {
  const form = $("#create-event-form");
  const joinInput = $("#event-id-input");
  const joinBtn = $("#join-button");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#title").value.trim();
    const startDate = $("#start-date").value;
    const endDate = $("#end-date").value;
    const startTime = $("#start-time").value;
    const endTime = $("#end-time").value;
    const slotMinutes = Number($("#slot-minutes").value || 30);
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
      const url = `${window.location.origin}/event.html?id=${encodeURIComponent(data.id)}`;
      window.location.href = url;
    } catch (err) {
      console.error(err);
      alert(err.message || "Error creating event.");
    }
  });

  if (joinBtn && joinInput) {
    joinBtn.addEventListener("click", () => {
      const raw = joinInput.value.trim();
      if (!raw) return;
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
      } catch {
        // plain id
      }
      if (!id) {
        alert("Could not find an event id in that link.");
        return;
      }
      window.location.href = `/event.html?id=${encodeURIComponent(id)}`;
    });
  }
}

// ---------- Event page (grid + availability) ----------
function initEventPage() {
  const eventId = getQueryParam("id");
  if (!eventId) {
    alert("Missing event id in URL.");
    return;
  }

  // cached DOM
  const gridEl = $("#availability-grid");
  const eventTitleEl = $("#event-title");
  const shareLinkEl = $("#share-link");
  const rangeDaySelect = $("#range-day");
  const rangeFromInput = $("#range-from");
  const rangeToInput = $("#range-to");
  const rangeApplyBtn = $("#range-apply");
  const bestSlotsList = $("#best-slots");
  const participantCountEl = $("#participant-count");
  const participantNameInput = $("#participant-name");
  const saveBtn = $("#save-availability");
  const clearBtn = $("#clear-availability");
  const overlayBtn = $("#load-calendar-overlay");
  const overlayStatus = $("#calendar-overlay-status");

  const mySlotsKey = `hsync:${eventId}:mySlots`;
  const myNameKey = `hsync:${eventId}:myName`;

  let eventData = null;
  let cellsByIndex = new Map();
  let mySlots = new Set(JSON.parse(localStorage.getItem(mySlotsKey) || "[]").map(Number));

  // drag selection state (global)
  let isPointerDown = false;
  let dragMode = null;

  // reusable: persist name and share link
  const storedName = localStorage.getItem(myNameKey);
  if (storedName && participantNameInput) participantNameInput.value = storedName;
  if (shareLinkEl) shareLinkEl.value = window.location.href;

  window.addEventListener("pointerup", () => {
    isPointerDown = false;
    dragMode = null;
  });

  async function loadEvent() {
    try {
      eventData = await fetchJson(`/api/events/${encodeURIComponent(eventId)}`);
      if (eventTitleEl) eventTitleEl.textContent = eventData.title || "Availability poll";
      renderRangeDayOptions();
      renderGrid();
      renderBestSlots();
    } catch (err) {
      console.error(err);
      alert(err.message || "Error loading event.");
    }
  }

  function renderRangeDayOptions() {
    if (!rangeDaySelect || !eventData) return;
    rangeDaySelect.innerHTML = "";
    eventData.dates.forEach((iso, idx) => {
      const opt = document.createElement("option");
      opt.value = idx;
      opt.textContent = formatDateLabel(iso);
      rangeDaySelect.appendChild(opt);
    });
  }

  function attachCellListeners(cell) {
    cell.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const idx = Number(cell.dataset.index);
      const currentlySelected = mySlots.has(idx);
      isPointerDown = true;
      dragMode = currentlySelected ? "remove" : "add";
      toggleSlot(idx, dragMode === "add");
    });
    cell.addEventListener("pointerenter", () => {
      if (!isPointerDown || !dragMode) return;
      const idx = Number(cell.dataset.index);
      toggleSlot(idx, dragMode === "add");
    });
  }

  function toggleSlot(idx, makeSelected) {
    if (!Number.isInteger(idx)) return;
    const cell = cellsByIndex.get(idx);
    if (!cell) return;
    if (makeSelected) {
      mySlots.add(idx);
      cell.classList.add("my-slot");
    } else {
      mySlots.delete(idx);
      cell.classList.remove("my-slot");
    }
    localStorage.setItem(mySlotsKey, JSON.stringify(Array.from(mySlots)));
  }

  function renderGrid() {
    if (!gridEl || !eventData) return;
    gridEl.innerHTML = "";
    cellsByIndex = new Map();
    const days = eventData.dates.length;
    const rows = eventData.grid.slotsPerDay;
    const maxCount = eventData.grid.maxCount || 0;
    const aggregate = eventData.grid.aggregate || [];

    const templateCols = `minmax(60px, 80px) repeat(${days}, minmax(56px, 1fr))`;

    const headerRow = document.createElement("div");
    headerRow.className = "grid-header-row";
    headerRow.style.gridTemplateColumns = templateCols;
    const blank = document.createElement("div");
    blank.className = "grid-time-cell";
    headerRow.appendChild(blank);
    eventData.dates.forEach((iso) => {
      const dayCell = document.createElement("div");
      dayCell.className = "grid-day-header";
      dayCell.textContent = formatDateLabel(iso);
      headerRow.appendChild(dayCell);
    });
    gridEl.appendChild(headerRow);

    for (let row = 0; row < rows; row++) {
      const rowEl = document.createElement("div");
      rowEl.className = "grid-row";
      rowEl.style.gridTemplateColumns = templateCols;

      const timeCell = document.createElement("div");
      timeCell.className = "grid-time-cell";
      timeCell.textContent = eventData.times[row] || "";
      rowEl.appendChild(timeCell);

      for (let day = 0; day < days; day++) {
        const slotIndex = day * rows + row;
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.index = String(slotIndex);

        const count = (aggregate[row] && aggregate[row][day]) || 0;
        const level = maxCount === 0 ? 0 : Math.ceil((count / maxCount) * 4);
        cell.classList.add(`heat-${level}`);
        if (mySlots.has(slotIndex)) cell.classList.add("my-slot");

        attachCellListeners(cell);
        cellsByIndex.set(slotIndex, cell);
        rowEl.appendChild(cell);
      }
      gridEl.appendChild(rowEl);
    }
  }

  function applyRangeSelection() {
    if (!eventData) return;
    const dayIndex = Number(rangeDaySelect.value || 0);
    const fromValue = rangeFromInput.value;
    const toValue = rangeToInput.value;
    if (!fromValue || !toValue) {
      alert("Please fill both From and To times.");
      return;
    }
    const [fh, fm] = fromValue.split(":").map(Number);
    const [th, tm] = toValue.split(":").map(Number);
    const fromMinutes = fh * 60 + fm;
    const toMinutes = th * 60 + tm;
    if (toMinutes <= fromMinutes) {
      alert("End time must be after start time.");
      return;
    }
    const start = eventData.startTimeMinutes;
    const slot = eventData.slotMinutes;
    const rows = eventData.grid.slotsPerDay;
    const clampToRow = (mins) => {
      const offset = mins - start;
      const raw = Math.floor(offset / slot);
      return Math.max(0, Math.min(rows - 1, raw));
    };
    const startRow = clampToRow(fromMinutes);
    const endRow = clampToRow(toMinutes - 1);
    for (let row = startRow; row <= endRow; row++) {
      const idx = dayIndex * rows + row;
      toggleSlot(idx, true);
    }
  }

  function renderBestSlots() {
    if (!eventData || !bestSlotsList || !participantCountEl) return;
    bestSlotsList.innerHTML = "";
    const agg = eventData.grid.aggregate || [];
    const whoGrid = eventData.grid.who || [];
    const rows = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const times = eventData.times;
    const participants = eventData.participants || [];
    const results = [];
    for (let day = 0; day < days; day++) {
      for (let row = 0; row < rows; row++) {
        const count = (agg[row] && agg[row][day]) || 0;
        if (count <= 0) continue;
        const names = (whoGrid[row] && whoGrid[row][day]) || [];
        results.push({
          dayIndex: day,
          rowIndex: row,
          count,
          names,
          dateIso: eventData.dates[day],
          timeLabel: times[row],
        });
      }
    }
    results.sort((a, b) => b.count - a.count);
    const top = results.slice(0, 5);
    if (top.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No availability submitted yet.";
      bestSlotsList.appendChild(li);
    } else {
      top.forEach((slot) => {
        const li = document.createElement("li");
        const mainRow = document.createElement("div");
        mainRow.className = "best-slot-main";
        mainRow.innerHTML = `<span>${formatDateLabel(slot.dateIso)} @ ${slot.timeLabel}</span><span>${slot.count} available</span>`;
        li.appendChild(mainRow);

        const participantsRow = document.createElement("div");
        participantsRow.className = "best-slot-participants";
        const names = slot.names || [];
        if (names.length === 0) {
          const label = document.createElement("span");
          label.textContent = "No one has picked this time yet.";
          participantsRow.appendChild(label);
        } else {
          const label = document.createElement("span");
          label.textContent = "Participants:";
          participantsRow.appendChild(label);

          const select = document.createElement("select");
          select.className = "participant-dropdown";

          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = `${names.length} participant${names.length > 1 ? "s" : ""}`;
          placeholder.disabled = true;
          placeholder.selected = true;
          select.appendChild(placeholder);

          names.forEach((name) => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
          });
          participantsRow.appendChild(select);
        }
        li.appendChild(participantsRow);
        bestSlotsList.appendChild(li);
      });
    }
    participantCountEl.textContent = `${participants.length} participant${participants.length === 1 ? "" : "s"} have responded.`;
  }

  async function saveAvailability() {
    if (!eventData) return;
    const name = participantNameInput.value.trim();
    if (!name) {
      alert("Please enter your name before saving.");
      participantNameInput.focus();
      return;
    }
    const slotsArray = Array.from(mySlots);
    try {
      await fetchJson(`/api/events/${encodeURIComponent(eventId)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantName: name, slots: slotsArray }),
      });
      localStorage.setItem(myNameKey, name);
      alert("Availability saved!");
      await loadEvent();
    } catch (err) {
      console.error(err);
      alert(err.message || "Error saving availability.");
    }
  }

  function clearMyAvailability() {
    mySlots = new Set();
    localStorage.setItem(mySlotsKey, JSON.stringify([]));
    cellsByIndex.forEach((cell) => cell.classList.remove("my-slot"));
  }

  function buildSlotRangesForEvent() {
    if (!eventData) return [];
    const slotsPerDay = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const slotMinutes = eventData.slotMinutes;
    const ranges = [];
    for (let day = 0; day < days; day++) {
      const dateStr = eventData.dates[day];
      for (let row = 0; row < slotsPerDay; row++) {
        const startMinutes = eventData.startTimeMinutes + row * slotMinutes;
        const h = Math.floor(startMinutes / 60).toString().padStart(2, "0");
        const m = (startMinutes % 60).toString().padStart(2, "0");
        const slotStart = new Date(`${dateStr}T${h}:${m}:00`);
        const slotEnd = new Date(slotStart.getTime() + slotMinutes * 60_000);
        const index = day * slotsPerDay + row;
        ranges[index] = { start: slotStart.getTime(), end: slotEnd.getTime() };
      }
    }
    return ranges;
  }

  function applyCalendarOverlay() {
    if (!cellsByIndex) return;
    cellsByIndex.forEach((cell, idx) => {
      cell.classList.toggle("busy-calendar", calendarBusySlots.has(idx));
    });
  }

  async function loadCalendarOverlayForCurrentEvent(statusEl) {
    if (!eventData) {
      statusEl && (statusEl.textContent = "Event data not loaded yet.");
      return;
    }
    try {
      statusEl && (statusEl.textContent = "Contacting Google Calendar...");
      const accessToken = await getCalendarAccessToken();

      const firstDate = eventData.dates[0];
      const lastDate = eventData.dates[eventData.dates.length - 1];

      const composeISO = (dateStr, minutes) => {
        const h = Math.floor(minutes / 60).toString().padStart(2, "0");
        const m = (minutes % 60).toString().padStart(2, "0");
        return new Date(`${dateStr}T${h}:${m}:00`);
      };

      const startDateTime = composeISO(firstDate, eventData.startTimeMinutes);
      const endDateTime = composeISO(lastDate, eventData.endTimeMinutes);

      const params = new URLSearchParams({
        timeMin: startDateTime.toISOString(),
        timeMax: endDateTime.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
      });

      const resp = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + params.toString(),
        { headers: { Authorization: "Bearer " + accessToken } },
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`Google Calendar error: ${resp.status} ${text}`);
      }

      const data = await resp.json();
      const ranges = buildSlotRangesForEvent();
      calendarBusySlots.clear();

      const items = data.items || [];
      for (const ev of items) {
        const startStr = ev.start && (ev.start.dateTime || (ev.start.date && ev.start.date + "T00:00:00"));
        const endStr = ev.end && (ev.end.dateTime || (ev.end.date && ev.end.date + "T23:59:59"));
        if (!startStr || !endStr) continue;
        const evStart = new Date(startStr).getTime();
        const evEnd = new Date(endStr).getTime();
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i];
          if (!r) continue;
          if (r.start < evEnd && r.end > evStart) calendarBusySlots.add(i);
        }
      }

      applyCalendarOverlay();
      statusEl && (statusEl.textContent = items.length === 0 ? "No calendar events during this poll window." : `Overlay applied from ${items.length} calendar event${items.length === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error(err);
      statusEl && (statusEl.textContent = err.message || "Failed to load calendar overlay.");
    }
  }

  // listeners
  saveBtn && saveBtn.addEventListener("click", saveAvailability);
  clearBtn && clearBtn.addEventListener("click", clearMyAvailability);
  rangeApplyBtn && rangeApplyBtn.addEventListener("click", (e) => { e.preventDefault(); applyRangeSelection(); });
  overlayBtn && overlayStatus && overlayBtn.addEventListener("click", () => loadCalendarOverlayForCurrentEvent(overlayStatus));

  loadEvent();

  // expose overlay loader for Google sign-in callback
  window.loadCalendarOverlayForCurrentEvent = loadCalendarOverlayForCurrentEvent;
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("page-home")) {
    loadCurrentUserAndTheme().then(initHomePage);
  }
  if (document.body.classList.contains("page-event")) {
    loadCurrentUserAndTheme().then(initEventPage);
  }
  if (document.body.classList.contains("page-appearance")) {
    initAppearancePage();
  }
});
