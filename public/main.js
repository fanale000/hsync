// public/main.js

// ---------- Helpers ----------
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function formatDateLabel(iso) {
  // iso = YYYY-MM-DD
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "numeric",
    day: "numeric"
  });
}
// Convert "h:mm AM/PM" → "HH:MM" (24-hour format)
function to24Hour(str) {
  if (!str) return "";
  const [time, ampm] = str.split(" ");
  let [h, m] = time.split(":").map(Number);

  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ---------- Theme helpers ----------
function applyTheme(themePrefs) {
  const root = document.documentElement;
  if (!themePrefs) return;

  if (themePrefs.theme) {
    root.dataset.theme = themePrefs.theme;
  }
  if (themePrefs.density) {
    root.dataset.density = themePrefs.density;
  }
}

async function loadCurrentUserAndTheme() {
  try {
    const meRes = await fetch("/api/me");
    const meData = await meRes.json().catch(() => ({ user: null }));
    const user = meData.user || null;

    let themePrefs = null;
    try {
      const themeRes = await fetch("/api/theme");
      if (themeRes.ok) {
        themePrefs = await themeRes.json();
      }
    } catch {
      // not signed in or no theme
    }

    applyTheme(themePrefs || { theme: "harvard", density: "comfortable" });

    return { user, themePrefs };
  } catch (err) {
    console.error("Failed to load user/theme", err);
    applyTheme({ theme: "harvard", density: "comfortable" });
    return { user: null, themePrefs: null };
  }
}

async function sendGoogleTokenToBackend(idToken) {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Failed to sign in with Google");
  }

  const data = await res.json();
  return data.user; // { googleId, name, email }
}

// This callback will be called by Google Identity when sign-in succeeds
window.handleGoogleCredentialResponse = async (response) => {
  try {
    const idToken = response.credential;
    const user = await sendGoogleTokenToBackend(idToken);

    console.log("Signed in as", user);

    // If we’re on a page with a name field, fill it in
    const nameInput = document.getElementById("participant-name");
    if (nameInput && user && user.name) {
      nameInput.value = user.name;
    }

    // You could also show a little “Signed in as X” badge somewhere on the page
    const badge = document.getElementById("signed-in-user");
    if (badge && user && user.name) {
      badge.textContent = `Signed in as ${user.name}`;
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "Google sign-in failed.");
  }
};
// ---------- Appearance page ----------
function initAppearancePage() {
  const form = document.getElementById("appearance-form");
  const warningEl = document.getElementById("appearance-warning");
  const badgeEl = document.getElementById("signed-in-user");

  if (!form) return;

  // Load current user + theme, then hydrate UI
  loadCurrentUserAndTheme().then(({ user, themePrefs }) => {
    if (!user) {
      warningEl.textContent =
        "Sign in with Google on the Home or Event page to save your appearance settings.";
      badgeEl.textContent = "Not signed in";
    } else {
      badgeEl.textContent = `Signed in as ${user.name || user.email}`;
      warningEl.textContent = "";
    }

    const prefs = themePrefs || { theme: "harvard", density: "comfortable" };

    // Apply radio selections
    const themeInputs = form.querySelectorAll('input[name="theme"]');
    themeInputs.forEach((inp) => {
      inp.checked = inp.value === prefs.theme;
    });

    const densityInputs = form.querySelectorAll('input[name="density"]');
    densityInputs.forEach((inp) => {
      inp.checked = inp.value === prefs.density;
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const theme = form.querySelector('input[name="theme"]:checked')?.value;
    const density = form.querySelector('input[name="density"]:checked')?.value;

    try {
      const res = await fetch("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, density })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save appearance.");
      }

      const data = await res.json();
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
  const form = document.getElementById("create-event-form");
  const joinInput = document.getElementById("event-id-input");
  const joinBtn = document.getElementById("join-button");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = document.getElementById("title").value.trim();
const startDate = document.getElementById("start-date").value;
const endDate = document.getElementById("end-date").value;

const startTimeRaw = document.getElementById("start-time").value;
const endTimeRaw = document.getElementById("end-time").value;

const startTime = to24Hour(startTimeRaw);
const endTime = to24Hour(endTimeRaw);

const slotMinutes = Number(document.getElementById("slot-minutes").value || 30);

    if (!title || !startDate || !endDate || !startTime || !endTime) {
      alert("Please fill out all fields.");
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
      const url = `${window.location.origin}/event.html?id=${encodeURIComponent(
        data.id
      )}`;
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
        if (match) {
          id = match;
        } else {
          // maybe last path segment
          const parts = maybeUrl.pathname.split("/");
          id = parts[parts.length - 1] || parts[parts.length - 2];
          if (id === "event.html") {
            id = maybeUrl.searchParams.get("id") || "";
          }
        }
      } catch {
        // not a URL, treat as plain id
      }

      if (!id) {
        alert("Could not find an event id in that link.");
        return;
      }

      window.location.href = `/event.html?id=${encodeURIComponent(id)}`;
    });
  }
  // Initialize Flatpickr time pickers
flatpickr("#start-time", {
  enableTime: true,
  noCalendar: true,
  dateFormat: "h:i K",   // 12-hour with AM/PM
  minuteIncrement: 15
});

flatpickr("#end-time", {
  enableTime: true,
  noCalendar: true,
  dateFormat: "h:i K",
  minuteIncrement: 15
});

}

// ---------- Event page (grid + availability) ----------
function initEventPage() {
  const eventId = getQueryParam("id");
  if (!eventId) {
    alert("Missing event id in URL.");
    return;
  }

  const gridEl = document.getElementById("availability-grid");
  const eventTitleEl = document.getElementById("event-title");
  const shareLinkEl = document.getElementById("share-link");
  const rangeDaySelect = document.getElementById("range-day");
  const rangeFromInput = document.getElementById("range-from");
  const rangeToInput = document.getElementById("range-to");
  const rangeApplyBtn = document.getElementById("range-apply");
  const bestSlotsList = document.getElementById("best-slots");
  const participantCountEl = document.getElementById("participant-count");

  const participantNameInput = document.getElementById("participant-name");
  const saveBtn = document.getElementById("save-availability");
  const clearBtn = document.getElementById("clear-availability");

  const mySlotsKey = `hsync:${eventId}:mySlots`;
  const myNameKey = `hsync:${eventId}:myName`;

  let eventData = null;
  let cellsByIndex = new Map();
  let mySlots = new Set(
    JSON.parse(localStorage.getItem(mySlotsKey) || "[]").map(Number)
  );

  // drag selection state
  let isPointerDown = false;
  let dragMode = null; // "add" or "remove"

  // Pre-fill participant name from localStorage
  const storedName = localStorage.getItem(myNameKey);
  if (storedName && participantNameInput) {
    participantNameInput.value = storedName;
  }

  // Set share link
  if (shareLinkEl) {
    shareLinkEl.value = window.location.href;
  }

  async function loadEvent() {
    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`);
      if (!res.ok) {
        throw new Error("Event not found.");
      }
      eventData = await res.json();

      if (eventTitleEl) {
        eventTitleEl.textContent = eventData.title || "Availability poll";
      }

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

  function renderGrid() {
    if (!gridEl || !eventData) return;

    gridEl.innerHTML = "";
    cellsByIndex = new Map();

    const days = eventData.dates.length;
    const rows = eventData.grid.slotsPerDay;
    const maxCount = eventData.grid.maxCount || 0;
    const aggregate = eventData.grid.aggregate || [];

    // Set up CSS grid templates
    const templateCols = `minmax(60px, 80px) repeat(${days}, minmax(56px, 1fr))`;

    // Header row: blank time cell + day headers
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

    // Body rows
    for (let row = 0; row < rows; row++) {
      const rowEl = document.createElement("div");
      rowEl.className = "grid-row";
      rowEl.style.gridTemplateColumns = templateCols;

      // time label
      const timeCell = document.createElement("div");
      timeCell.className = "grid-time-cell";
      timeCell.textContent = eventData.times[row] || "";
      rowEl.appendChild(timeCell);

      // day cells
      for (let day = 0; day < days; day++) {
        const slotIndex = day * rows + row;
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.index = String(slotIndex);

        const count = (aggregate[row] && aggregate[row][day]) || 0;
        const level = maxCount === 0 ? 0 : Math.ceil((count / maxCount) * 4);
        cell.classList.add(`heat-${level}`);

        if (mySlots.has(slotIndex)) {
          cell.classList.add("my-slot");
        }

        attachCellListeners(cell);
        cellsByIndex.set(slotIndex, cell);

        rowEl.appendChild(cell);
      }

      gridEl.appendChild(rowEl);
    }

    // Global pointer up to end drag
    window.addEventListener("pointerup", () => {
      isPointerDown = false;
      dragMode = null;
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

    cell.addEventListener("pointerenter", (e) => {
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

    // Persist locally
    localStorage.setItem(mySlotsKey, JSON.stringify(Array.from(mySlots)));
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

    let fromMinutes;
    let toMinutes;
    try {
      const [fh, fm] = fromValue.split(":").map(Number);
      const [th, tm] = toValue.split(":").map(Number);
      fromMinutes = fh * 60 + fm;
      toMinutes = th * 60 + tm;
    } catch {
      alert("Invalid time values.");
      return;
    }

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
    const endRow = clampToRow(toMinutes - 1); // inclusive

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

      const names =
        (whoGrid[row] && whoGrid[row][day]) ? whoGrid[row][day] : [];

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

      const namesLabel =
        slot.names && slot.names.length
          ? slot.names.join(", ")
          : "No one yet";

      // This is where the browser tooltip comes from:
      li.title = `Available: ${namesLabel}`;

      li.innerHTML = `
        <span>${formatDateLabel(slot.dateIso)} @ ${slot.timeLabel}</span>
        <span>${slot.count} available</span>
      `;

      bestSlotsList.appendChild(li);
    });
  }

  participantCountEl.textContent = `${
    participants.length
  } participant${participants.length === 1 ? "" : "s"} have responded.`;
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
      const res = await fetch(`/api/events/${encodeURIComponent(eventId)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantName: name,
          slots: slotsArray
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save availability.");
      }

      localStorage.setItem(myNameKey, name);
      alert("Availability saved!");

      await loadEvent(); // refresh aggregates & best slots
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

  // Listeners
  if (saveBtn) {
    saveBtn.addEventListener("click", saveAvailability);
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", clearMyAvailability);
  }
  if (rangeApplyBtn) {
    rangeApplyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      applyRangeSelection();
    });
  }

  loadEvent();
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  if (document.body.classList.contains("page-home")) {
    loadCurrentUserAndTheme().then(() => {
      initHomePage();
    });
  }

  if (document.body.classList.contains("page-event")) {
    loadCurrentUserAndTheme().then(() => {
      initEventPage();
    });
  }

  if (document.body.classList.contains("page-appearance")) {
    // initAppearancePage will call loadCurrentUserAndTheme itself
    initAppearancePage();
  }
});
