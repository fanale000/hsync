// public/main.js

// =========================
// Helpers
// =========================

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function formatDateLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  });
}

// Normalize various time inputs → "HH:MM" 24h format.
// Works with "09:00", "9am", "9:30 PM", "930", "21:00"
function normalizeTimeInput(input) {
  if (!input) return "";
  let str = input.trim().toLowerCase();

  // Extract am/pm
  let ampm = null;
  if (str.endsWith("am")) {
    ampm = "am";
    str = str.slice(0, -2).trim();
  } else if (str.endsWith("pm")) {
    ampm = "pm";
    str = str.slice(0, -2).trim();
  }

  str = str.replace(/\s+/g, "");

  let h = 0;
  let m = 0;

  if (str.includes(":")) {
    const [hh, mm] = str.split(":");
    h = Number(hh) || 0;
    m = Number(mm) || 0;
  } else if (/^\d+$/.test(str)) {
    if (str.length <= 2) {
      h = Number(str);
      m = 0;
    } else if (str.length === 3) {
      h = Number(str[0]);
      m = Number(str.slice(1));
    } else if (str.length === 4) {
      h = Number(str.slice(0, 2));
      m = Number(str.slice(2));
    }
  } else {
    throw new Error(`Could not understand time: "${input}"`);
  }

  if (m < 0 || m > 59) m = 0;

  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;

  if (h < 0 || h > 23) {
    throw new Error(`Hour out of range in time: "${input}"`);
  }

  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
}

// =========================
// Minimal Google Sign-In support (for name autofill)
// =========================

async function sendGoogleTokenToBackend(idToken) {
  try {
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    });

    if (!res.ok) {
      // Backend might not exist; fail silently
      return null;
    }

    const data = await res.json();
    return data.user || null;
  } catch {
    return null;
  }
}

// Called by Google Identity script via data-callback="handleGoogleCredentialResponse"
window.handleGoogleCredentialResponse = async (response) => {
  try {
    const idToken = response.credential;
    const user = await sendGoogleTokenToBackend(idToken);

    if (!user) return;

    const nameInput = document.getElementById("participant-name");
    if (nameInput && user.name) {
      nameInput.value = user.name;
    }

    const badge = document.getElementById("signed-in-user");
    if (badge && user.name) {
      badge.textContent = `Signed in as ${user.name}`;
    }
  } catch (err) {
    console.error("Google sign-in failed:", err);
  }
};

// =========================
// Google Calendar overlay globals
// =========================

const GOOGLE_CLIENT_ID = "889787397602-gku8r94alb2b10s9lm35e2s2irbdntoq.apps.googleusercontent.com"; // <-- REPLACE THIS

let calendarTokenClient = null;
let calendarBusySlots = new Set();

// Will be set on event page
let eventData = null;
let cellsByIndex = null;

// Request a Calendar access token from Google
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
        }
      });
    }

    // Will show consent the first time
    calendarTokenClient.requestAccessToken({ prompt: "" });
  });
}

// Build [start, end] timestamps (ms) for each slot index in current event
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

      const h = Math.floor(startMinutes / 60)
        .toString()
        .padStart(2, "0");
      const m = (startMinutes % 60).toString().padStart(2, "0");

      const slotStart = new Date(`${dateStr}T${h}:${m}:00`);
      const slotEnd = new Date(slotStart.getTime() + slotMinutes * 60_000);

      const index = day * slotsPerDay + row;
      ranges[index] = {
        start: slotStart.getTime(),
        end: slotEnd.getTime()
      };
    }
  }

  return ranges;
}

// Add/remove busy-calendar class on cells
function applyCalendarOverlay() {
  if (!cellsByIndex) return;

  cellsByIndex.forEach((cell, idx) => {
    if (calendarBusySlots.has(idx)) {
      cell.classList.add("busy-calendar");
    } else {
      cell.classList.remove("busy-calendar");
    }
  });
}

// Main overlay loader
async function loadCalendarOverlayForCurrentEvent(statusEl) {
  if (!eventData) {
    statusEl.textContent = "Event data not loaded yet.";
    return;
  }

  try {
    statusEl.textContent = "Contacting Google Calendar...";

    const accessToken = await getCalendarAccessToken();

    // Compute timeMin / timeMax based on event
    const firstDate = eventData.dates[0];
    const lastDate = eventData.dates[eventData.dates.length - 1];

    function composeISO(dateStr, minutes) {
      const h = Math.floor(minutes / 60)
        .toString()
        .padStart(2, "0");
      const m = (minutes % 60).toString().padStart(2, "0");
      return new Date(`${dateStr}T${h}:${m}:00`);
    }

    const startDateTime = composeISO(firstDate, eventData.startTimeMinutes);
    const endDateTime = composeISO(lastDate, eventData.endTimeMinutes);

    const params = new URLSearchParams({
      timeMin: startDateTime.toISOString(),
      timeMax: endDateTime.toISOString(),
      singleEvents: "true",
      orderBy: "startTime"
    });

    const resp = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?" +
        params.toString(),
      {
        headers: {
          Authorization: "Bearer " + accessToken
        }
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Google Calendar error: ${resp.status} ${text}`);
    }

    const data = await resp.json();

    const ranges = buildSlotRangesForEvent();
    calendarBusySlots.clear();

    const items = data.items || [];

    for (const ev of items) {
      const startStr =
        (ev.start && (ev.start.dateTime || ev.start.date + "T00:00:00")) ||
        null;
      const endStr =
        (ev.end && (ev.end.dateTime || ev.end.date + "T23:59:59")) || null;

      if (!startStr || !endStr) continue;

      const evStart = new Date(startStr).getTime();
      const evEnd = new Date(endStr).getTime();

      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        if (!r) continue;
        if (r.start < evEnd && r.end > evStart) {
          calendarBusySlots.add(i);
        }
      }
    }

    applyCalendarOverlay();

    statusEl.textContent =
      items.length === 0
        ? "No calendar events during this poll window."
        : `Overlay applied from ${items.length} calendar event${
            items.length === 1 ? "" : "s"
          }.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = err.message || "Failed to load calendar overlay.";
  }
}

// =========================
// Home page (create event)
// =========================

function initHomePage() {
  const form = document.getElementById("create-event-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = document.getElementById("title").value.trim();
    const startDate = document.getElementById("start-date").value;
    const endDate = document.getElementById("end-date").value;

    const startTimeRaw = document.getElementById("start-time").value;
    const endTimeRaw = document.getElementById("end-time").value;

    let startTime, endTime;
    try {
      startTime = normalizeTimeInput(startTimeRaw);
      endTime = normalizeTimeInput(endTimeRaw);
    } catch (err) {
      alert(err.message);
      return;
    }

    const slotMinutes = Number(
      document.getElementById("slot-minutes").value || 30
    );

    if (!title || !startDate || !endDate) {
      alert("Please fill in title and dates.");
      return;
    }

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          startDate,
          endDate,
          startTime,
          endTime,
          slotMinutes
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create event.");
      }

      const data = await res.json();
      if (data.id) {
        window.location.href = `event.html?id=${encodeURIComponent(data.id)}`;
      } else {
        alert("Event created but no ID returned from server.");
      }
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to create event.");
    }
  });
}

// =========================
// Event page (grid + availability)
// =========================

let mySlots = new Set();
let eventId = null;

// DOM caches
let gridTimesEl = null;
let gridBodyEl = null;
let bestSlotsList = null;
let participantCountEl = null;
let participantNameInput = null;

// selection state
let isPointerDown = false;
let selectionMode = null; // "add" or "remove"

function getMySlotsKey() {
  if (!eventId) return "hsync-mySlots";
  return `hsync-mySlots-${eventId}`;
}

function loadMySlotsFromStorage() {
  const key = getMySlotsKey();
  try {
    const arr = JSON.parse(localStorage.getItem(key) || "[]");
    mySlots = new Set(arr.map(Number));
  } catch {
    mySlots = new Set();
  }
}

function saveMySlotsToStorage() {
  const key = getMySlotsKey();
  localStorage.setItem(key, JSON.stringify(Array.from(mySlots)));
}

// apply user's slots to cells
function applyMySlotsToGrid() {
  if (!cellsByIndex) return;
  cellsByIndex.forEach((cell, idx) => {
    if (mySlots.has(idx)) {
      cell.classList.add("my-slot");
    } else {
      cell.classList.remove("my-slot");
    }
  });
}

// build grid DOM based on eventData
function renderGrid() {
  if (!eventData || !gridTimesEl || !gridBodyEl) return;

  gridTimesEl.innerHTML = "";
  gridBodyEl.innerHTML = "";
  cellsByIndex = new Map();

  const times = eventData.times;
  const dates = eventData.dates;
  const slotsPerDay = eventData.grid.slotsPerDay;
  const days = dates.length;

  // Times column
  for (let row = 0; row < times.length; row++) {
    const div = document.createElement("div");
    div.className = "time-label";
    div.textContent = times[row];
    gridTimesEl.appendChild(div);
  }

  // Set up CSS grid columns
  gridBodyEl.style.display = "grid";
  gridBodyEl.style.gridTemplateColumns = `repeat(${days}, minmax(0, 1fr))`;

  // Create cells row-major: for each row, for each day
  for (let row = 0; row < slotsPerDay; row++) {
    for (let day = 0; day < days; day++) {
      const idx = day * slotsPerDay + row;
      const cell = document.createElement("div");
      cell.className = "grid-cell";
      cell.dataset.index = String(idx);

      // Attach pointer listeners for drag-select
      cell.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        isPointerDown = true;
        const index = Number(cell.dataset.index);
        const currentlySelected = mySlots.has(index);
        selectionMode = currentlySelected ? "remove" : "add";
        toggleSlot(index, selectionMode === "add");
      });

      cell.addEventListener("pointerenter", (e) => {
        if (!isPointerDown || !selectionMode) return;
        const index = Number(cell.dataset.index);
        toggleSlot(index, selectionMode === "add");
      });

      cell.addEventListener("pointerup", () => {
        isPointerDown = false;
        selectionMode = null;
      });

      gridBodyEl.appendChild(cell);
      cellsByIndex.set(idx, cell);
    }
  }

  // Mouseup anywhere ends drag
  window.addEventListener("pointerup", () => {
    isPointerDown = false;
    selectionMode = null;
  });

  applyHeatmap();
  applyMySlotsToGrid();
  applyCalendarOverlay(); // in case overlay already loaded
}

// heatmap from aggregate
function applyHeatmap() {
  if (!eventData || !cellsByIndex) return;

  const agg = eventData.grid.aggregate || [];
  const maxCount = eventData.grid.maxCount || 0;
  const slotsPerDay = eventData.grid.slotsPerDay;
  const days = eventData.dates.length;

  cellsByIndex.forEach((cell, idx) => {
    for (let l = 0; l <= 4; l++) {
      cell.classList.remove(`heat-${l}`);
    }
    const day = Math.floor(idx / slotsPerDay);
    const row = idx % slotsPerDay;
    const count = (agg[row] && agg[row][day]) || 0;
    let level = 0;
    if (maxCount > 0 && count > 0) {
      level = Math.ceil((count / maxCount) * 4);
    }
    cell.classList.add(`heat-${level}`);
  });
}

function toggleSlot(idx, makeSelected) {
  if (makeSelected) {
    mySlots.add(idx);
  } else {
    mySlots.delete(idx);
  }
  saveMySlotsToStorage();
  applyMySlotsToGrid();
}

// "Best times so far" with participants dropdown
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

      const names =
        whoGrid[row] && whoGrid[row][day] ? whoGrid[row][day] : [];

      results.push({
        dayIndex: day,
        rowIndex: row,
        count,
        names,
        dateIso: eventData.dates[day],
        timeLabel: times[row]
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
      mainRow.innerHTML = `
        <span>${formatDateLabel(slot.dateIso)} @ ${slot.timeLabel}</span>
        <span>${slot.count} available</span>
      `;
      li.appendChild(mainRow);

      const participantsRow = document.createElement("div");
      participantsRow.className = "best-slot-participants";

      const names = slot.names && slot.names.length ? slot.names : [];

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
        placeholder.textContent = `${names.length} participant${
          names.length > 1 ? "s" : ""
        }`;
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

  participantCountEl.textContent = `${
    participants.length
  } participant${participants.length === 1 ? "" : "s"} have responded.`;
}

// fetch event data and re-render everything
async function loadEvent() {
  if (!eventId) return;

  const titleEl = document.getElementById("event-title");

  try {
    const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`);
    if (!res.ok) {
      throw new Error("Failed to load event.");
    }
    const data = await res.json();
    eventData = data;

    if (titleEl) {
      titleEl.textContent = data.title || "Event";
    }

    renderGrid();
    renderBestSlots();
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to load event.");
  }
}

function initEventPage() {
  eventId = getQueryParam("id");
  if (!eventId) {
    alert("Missing event ID in URL.");
    return;
  }

  gridTimesEl = document.getElementById("grid-times");
  gridBodyEl = document.getElementById("grid-body");
  bestSlotsList = document.getElementById("best-slots-list");
  participantCountEl = document.getElementById("participant-count");
  participantNameInput = document.getElementById("participant-name");

  loadMySlotsFromStorage();

  const saveBtn = document.getElementById("save-availability");
  const clearBtn = document.getElementById("clear-availability");

  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      const name = (participantNameInput?.value || "").trim();
      if (!name) {
        alert("Please enter your name before saving.");
        return;
      }

      const slotsArray = Array.from(mySlots);

      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/availability`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              participantName: name,
              slots: slotsArray
            })
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to save availability.");
        }

        await loadEvent();
        alert("Availability saved.");
      } catch (err) {
        console.error(err);
        alert(err.message || "Failed to save availability.");
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      mySlots.clear();
      saveMySlotsToStorage();
      applyMySlotsToGrid();
    });
  }

  // Calendar overlay button
  const overlayBtn = document.getElementById("load-calendar-overlay");
  const overlayStatus = document.getElementById("calendar-overlay-status");
  if (overlayBtn && overlayStatus) {
    overlayBtn.addEventListener("click", () => {
      loadCalendarOverlayForCurrentEvent(overlayStatus);
    });
  }

  // Initial load
  loadEvent();
}

// =========================
// Boot
// =========================

document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("page-home")) {
    initHomePage();
  }
  if (document.body.classList.contains("page-event")) {
    initEventPage();
  }
});
