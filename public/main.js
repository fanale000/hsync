/**
 * Frontend code
 * @module main
 */

/**
 * Google OAuth 2.0 Client ID for sign-in and calendar access
 */
const GOOGLE_CLIENT_ID = "19747295970-tp902n56girks9e8kegdl1vlod13l3ti.apps.googleusercontent.com";

// ============================================================================
// DOM UTILITY FUNCTIONS
// ============================================================================

/**
 * Selects a single element by CSS selector
 * @param {string} sel - CSS selector
 * @param {Element|Document} ctx - Optional context (defaults to document)
 * @returns {Element|null}
 */
function $(sel, ctx) {
  if (ctx === undefined) {
    ctx = document;
  }
  return ctx.querySelector(sel);
}

/**
 * Selects all elements matching a CSS selector
 * @param {string} sel - CSS selector
 * @param {Element|Document} ctx - Optional context (defaults to document)
 * @returns {Element[]}
 */
function $$(sel, ctx) {
  if (ctx === undefined || ctx === null) {
    ctx = document;
  }
  return Array.from(ctx.querySelectorAll(sel));
}

/**
 * Gets a URL query parameter value
 * @param {string} name - Parameter name
 * @returns {string|null}
 */
function getQueryParam(name) {
  const currentUrl = new URL(window.location.href);
  return currentUrl.searchParams.get(name);
}

// ============================================================================
// API COMMUNICATION
// ============================================================================

/**
 * Fetches JSON and throws on non-2xx responses
 * @param {string} url - Request URL
 * @param {RequestInit} opts - Fetch options
 * @returns {Promise<Object>} Parsed JSON
 * @throws {Error} On non-2xx status
 */
async function fetchJson(url, opts = {}) {
  // Make the HTTP request
  const res = await fetch(url, opts);
  
  // Read response text
  const text = await res.text().catch(() => "");
  
  // Parse JSON or use empty object
  let data = {};
  try { 
    data = text ? JSON.parse(text) : {}; 
  } catch {}
  
  // Throw error if response failed
  if (!res.ok) {
    // Get error message from response
    let msg = null;
    if (data && data.error) {
      msg = data.error;
    } else if (data && data.message) {
      msg = data.message;
    } else if (res.statusText) {
      msg = res.statusText;
    } else {
      msg = "HTTP " + res.status;
    }
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  
  return data;
}

/**
 * Decodes JWT payload without verification (client-side only)
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload
 */
function parseJwt(token) {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (e) {
    return null;
  }
}

// ============================================================================
// WEB STORAGE HELPERS
// ============================================================================

/**
 * Safe localStorage wrappers that catch errors
 */
function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    // Ignore storage errors
  }
}

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function safeRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    // Ignore storage errors
  }
}

/**
 * Stores last opened/joined event ID in localStorage
 */
function setLastOpenedEvent(id) {
  if (id) safeSet("hsync:lastOpenedEvent", String(id));
  else safeRemove("hsync:lastOpenedEvent");
}

function getLastOpenedEvent() {
  return safeGet("hsync:lastOpenedEvent");
}

function setLastJoinedEvent(id) {
  if (id) safeSet("hsync:lastJoinedEvent", String(id));
  else safeRemove("hsync:lastJoinedEvent");
}

function getLastJoinedEvent() {
  return safeGet("hsync:lastJoinedEvent");
}

/**
 * Stores current session's active event ID (cleared when tab closes)
 */
function setSessionEvent(id) {
  try {
    if (id) {
      sessionStorage.setItem("hsync:sessionEvent", String(id));
    } else {
      sessionStorage.removeItem("hsync:sessionEvent");
    }
  } catch (e) {
    // Ignore storage errors
  }
}

function getSessionEvent() {
  try {
    return sessionStorage.getItem("hsync:sessionEvent");
  } catch (e) {
    return null;
  }
}

function clearSessionEvent() {
  try {
    sessionStorage.removeItem("hsync:sessionEvent");
  } catch (e) {
    // Ignore storage errors
  }
}

// ============================================================================
// GOOGLE AUTHENTICATION & CALENDAR INTEGRATION
// ============================================================================

/**
 * Google Calendar OAuth token client (initialized on first use)
 */
let calendarTokenClient = null;

/**
 * SessionStorage key for cached calendar tokens
 */
const CAL_TOKEN_KEY = "hsync:calToken";

/**
 * Gets Google Calendar access token (uses cache if valid)
 * @param {boolean} forceRefresh - Bypass cache
 * @returns {Promise<string>} Access token
 */
function getCalendarAccessToken(forceRefresh = false) {
  try {
    if (!forceRefresh) {
      const raw = sessionStorage.getItem(CAL_TOKEN_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.access_token && obj.expires_at && Date.now() < obj.expires_at - 60000) {
          return Promise.resolve(obj.access_token);
        }
      }
    }
  } catch (e) {
    /* ignore parse errors and continue to request new token */
  }

  return new Promise((resolve, reject) => {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      return reject(new Error("Google API not loaded"));
    }

    if (!calendarTokenClient) {
      try {
        calendarTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.profile",
          callback: function(resp) {
            if (resp && resp.access_token) {
              let expires_in = Number(resp.expires_in);
              if (!expires_in) {
                expires_in = 55 * 60; // seconds
              }
              const expires_at = Date.now() + expires_in * 1000;
              try {
                sessionStorage.setItem(CAL_TOKEN_KEY, JSON.stringify({ access_token: resp.access_token, expires_at }));
              } catch (e) {
                // Ignore storage errors
              }
              resolve(resp.access_token);
            } else {
              reject(new Error("No access token returned"));
            }
          },
        });
      } catch (err) {
        return reject(err);
      }
    }

    try {
      calendarTokenClient.requestAccessToken();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Sends Google ID token to backend for session creation
 * @param {string} idToken - Google ID token
 * @returns {Promise<Object|null>} User object or null
 */
async function sendGoogleIdTokenToBackend(idToken) {
  if (!idToken) {
    return null;
  }
  try {
    const data = await fetchJson("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: idToken }),
    });
    if (data && data.user) {
      return data.user;
    } else {
      return null;
    }
  } catch (e) {
    console.warn("Backend google token exchange failed:", e);
    return null;
  }
}

/**
 * Sends calendar token to backend (best-effort, errors ignored)
 * @param {string} accessToken - Calendar access token
 */
async function sendCalendarAccessTokenToBackend(accessToken) {
  if (!accessToken) {
    return;
  }
  try {
    await fetchJson("/api/auth/google_calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: accessToken }),
    });
  } catch (e) {
    console.warn("Failed to send calendar token to backend:", e);
  }
}

/**
 * Fetches Google user profile using access token
 * @param {string} accessToken - OAuth access token
 * @returns {Promise<Object|null>} User profile or null
 */
async function fetchGoogleUserInfo(accessToken) {
  if (!accessToken) {
    return null;
  }
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (!res.ok) {
      throw new Error("Failed to fetch userinfo");
    }
    return await res.json();
  } catch (e) {
    console.warn("fetchGoogleUserInfo:", e);
    return null;
  }
}

// ============================================================================
// TOPBAR / PROFILE UI HELPERS
// ============================================================================

/**
 * Updates topbar with user profile picture and name
 * @param {string|null} pictureUrl - Profile picture URL
 * @param {string|null} name - Display name
 */
function setTopbarProfile(pictureUrl, name) {
  const pic = $("#topbar-profile-pic");
  const container = $("#gsi-topbar");
  
  if (pic) {
    if (pictureUrl) {
      pic.src = pictureUrl;
      pic.style.display = "inline-block";
    } else {
      pic.src = "";
      pic.style.display = "none";
    }
  }
  
  if (container) {
    if (pictureUrl) {
      container.style.display = "none";
    } else {
      container.style.display = "inline-flex";
    }
  }
  if (pictureUrl) safeSet("hsync:profilePic", pictureUrl); 
  else safeRemove("hsync:profilePic");
  
  if (name) safeSet("hsync:profileName", name); 
  else safeRemove("hsync:profileName");
}

/**
 * Initializes Google Sign-In button in topbar
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
    
    google.accounts.id.renderButton(el, {
      type: "icon",
      theme: "outline",
      size: "small",
      shape: "circle",
      logo_alignment: "left"
    });
  } catch (e) {
    console.warn("initTopbarGsi:", e);
  }
}

/**
 * Google sign-in callback: updates profile and optionally loads calendar
 */
window.handleGoogleCredentialResponse = async function(resp) {
  if (!resp || !resp.credential) {
    return;
  }
  const payload = parseJwt(resp.credential);
  let name = null;
  if (payload && payload.name) {
    name = payload.name;
  } else if (payload && payload.given_name) {
    name = payload.given_name;
  }
  let picture = null;
  if (payload && payload.picture) {
    picture = payload.picture;
  }
  if (picture || name) {
    setTopbarProfile(picture, name);
  }

  sendGoogleIdTokenToBackend(resp.credential).catch(() => {});

  if (document.body.classList.contains("page-event")) {
  if (document.body.classList.contains("page-event")) {
    try {
      const token = await getCalendarAccessToken().catch(() => null);
      if (token) {
        await sendCalendarAccessTokenToBackend(token).catch(() => {});
        if (!picture || !name) {
          const info = await fetchGoogleUserInfo(token).catch(function() {
            return null;
          });
          if (info) {
            let infoPicture = null;
            if (info.picture) {
              infoPicture = info.picture;
            }
            let infoName = null;
            if (info.name) {
              infoName = info.name;
            }
            setTopbarProfile(infoPicture, infoName);
          }
        }
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

// ============================================================================
// SIGN-OUT FUNCTIONALITY
// ============================================================================

/**
 * Signs out from Google and clears all local data
 */
async function signOutAllGoogle() {
  try {
    if (window.google && google.accounts && google.accounts.id && google.accounts.id.disableAutoSelect) {
      google.accounts.id.disableAutoSelect();
    }
  } catch (e) {}
  
  try {
    await fetch("/api/auth/logout", { method: "POST" }).catch(function() {});
  } catch (e) {}
  
  safeRemove("hsync:profilePic");
  safeRemove("hsync:profileName");
  safeRemove("hsync:lastOpenedEvent");
  safeRemove("hsync:lastJoinedEvent");
  
  setTopbarProfile(null, null);
  window.location.reload();
}

// ============================================================================
// PAGE INITIALIZATION HELPERS
// ============================================================================

/**
 * Loads user and theme from backend and applies to page
 * @returns {Promise<Object>} { user, themePrefs }
 */
async function loadCurrentUserAndTheme() {
  try {
    const me = await fetchJson("/api/me").catch(() => ({ user: null }));
    const themePrefs = await fetchJson("/api/theme").catch(() => null);
    
    if (themePrefs) {
      if (themePrefs.theme) {
        document.documentElement.dataset.theme = themePrefs.theme;
      }
      if (themePrefs.density) {
        document.documentElement.dataset.density = themePrefs.density;
      }
    }
    
    let user = null;
    if (me && me.user) {
      user = me.user;
    }
    let themePreferences = null;
    if (themePrefs) {
      themePreferences = themePrefs;
    }
    return {
      user: user,
      themePrefs: themePreferences
    };
  } catch (err) {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || "harvard";
    document.documentElement.dataset.density = document.documentElement.dataset.density || "comfortable";
    return { user: null, themePrefs: null };
  }
}

/**
 * Initializes home page: event creation form and logout button
 */
function initHomePage() {
  const form = $("#create-event-form");
  if (!form) return;
  
  form.addEventListener("submit", async function(ev) {
    ev.preventDefault();
    
    
    const titleElement = $("#title");
    let title = "";
    if (titleElement && titleElement.value) {
      title = titleElement.value.trim();
    }
    const startDateElement = $("#start-date");
    const startDate = startDateElement ? startDateElement.value : null;
    const endDateElement = $("#end-date");
    const endDate = endDateElement ? endDateElement.value : null;
    const startTimeElement = $("#start-time");
    const startTime = startTimeElement ? startTimeElement.value : null;
    const endTimeElement = $("#end-time");
    const endTime = endTimeElement ? endTimeElement.value : null;
    const slotMinutesElement = $("#slot-minutes");
    let slotMinutes = 30;
    if (slotMinutesElement && slotMinutesElement.value) {
      slotMinutes = Number(slotMinutesElement.value);
    }
    
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
      window.location.href = "/event.html?id=" + encodeURIComponent(data.id);
    } catch (err) {
      console.error(err);
      alert(err.message || "Error creating event.");
    }
  });

  const logoutBtn = $("#logout-all-google");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function(e) {
      e.preventDefault();
      if (confirm("Sign out of Google and clear saved profile info?")) {
        signOutAllGoogle();
      }
    });
  }
}

/**
 * Initializes join page: pre-fills event ID and handles navigation
 */
function initJoinPage() {
  const input = $("#join-event-input");
  const openBtn = $("#join-open-button");
  const msg = $("#join-saved-msg");
  const queryId = getQueryParam("id");

  function saveAndReport(id) {
    try {
      setLastJoinedEvent(id);
    } catch (e) {}
    if (msg) {
      msg.textContent = "Saved poll " + id + ". Click \"Open poll\" to go to it.";
    }
  }

  if (queryId) {
    if (input) input.value = queryId;
    saveAndReport(queryId);
  } else {
    const last = getLastJoinedEvent();
    if (last && input) input.value = last;
    if (last && msg) {
      msg.textContent = "Last saved poll: " + last;
    }
  }

  if (openBtn) {
    openBtn.addEventListener("click", function() {
      let raw = "";
      if (input && input.value) {
        raw = input.value.trim();
      }
      if (!raw) {
        return;
      }
      
      let id = raw;
      try {
        const maybeUrl = new URL(raw);
        const match = maybeUrl.searchParams.get("id");
        if (match) {
          id = match;
        } else {
          const parts = maybeUrl.pathname.split("/");
          id = parts[parts.length - 1] || parts[parts.length - 2] || "";
          if (id === "event.html") {
            id = maybeUrl.searchParams.get("id") || "";
          }
        }
      } catch {}
      
      if (!id) {
        alert("Could not find an event id in that link.");
        return;
      }
      
      saveAndReport(id);
      setSessionEvent(id);
      window.location.href = "/event.html?id=" + encodeURIComponent(id);
    });
  }
}

// ============================================================================
// PAGE INITIALIZERS
// ============================================================================

/**
 * Initializes event page: grid, selection, calendar overlay
 */
function initEventPage() {
  const eventId = getQueryParam("id");
  if (!eventId) {
    alert("Missing event id in URL.");
    return;
  }

  setSessionEvent(eventId);
  setLastOpenedEvent(eventId);

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
  const overlayBtn1 = $("#load-calendar-overlay");
  const overlayBtn2 = $("#overlay-calendar");
  const overlayBtn = overlayBtn1 || overlayBtn2;
  const overlayStatus = $("#calendar-overlay-status");

  const mySlotsKey = `hsync:${eventId}:mySlots`;
  const myNameKey = `hsync:${eventId}:myName`;

  let eventData = null;
  let cellsByIndex = new Map();
  let mySlots = new Set(JSON.parse(safeGet(mySlotsKey) || "[]").map(Number));
  let calendarBusy = new Set();
  let calendarEventsBySlot = new Map();

  let _calendarTooltip = null;
  function createCalendarTooltip() {
    if (_calendarTooltip) return _calendarTooltip;
    _calendarTooltip = document.createElement("div");
    _calendarTooltip.className = "calendar-tooltip";
    _calendarTooltip.style.position = "fixed";
    _calendarTooltip.style.zIndex = 9999;
    _calendarTooltip.style.display = "none";
    document.body.appendChild(_calendarTooltip);
    return _calendarTooltip;
  }

  function formatEventForTooltip(ev) {
    let start = "";
    if (ev.start) {
      start = new Date(ev.start).toLocaleString();
    }
    let end = "";
    if (ev.end) {
      end = new Date(ev.end).toLocaleString();
    }
    let time = "";
    if (start && end) {
      time = start + " — " + end;
    } else if (start) {
      time = start;
    } else if (end) {
      time = end;
    }
    let loc = "";
    if (ev.location) {
      loc = "<div class=\"cal-ev-loc\">" + escapeHtml(ev.location) + "</div>";
    }
    let desc = "";
    if (ev.description) {
      desc = "<div class=\"cal-ev-desc\">" + escapeHtml(ev.description) + "</div>";
    }
    let summary = "(no title)";
    if (ev.summary) {
      summary = ev.summary;
    }
    return "<div class=\"cal-ev\">" +
      "<div class=\"cal-ev-title\">" + escapeHtml(summary) + "</div>" +
      "<div class=\"cal-ev-time\">" + escapeHtml(time) + "</div>" +
      loc +
      desc +
      "</div>";
  }

  /**
   * Escapes HTML to prevent XSS
   * @param {string} s - String to escape
   * @returns {string} Escaped string
   */
  function escapeHtml(s) {
    const stringValue = String(s || "");
    return stringValue.replace(/[&<>"']/g, function(m) {
      if (m === "&") {
        return "&amp;";
      } else if (m === "<") {
        return "&lt;";
      } else if (m === ">") {
        return "&gt;";
      } else if (m === '"') {
        return "&quot;";
      } else if (m === "'") {
        return "&#39;";
      } else {
        return m;
      }
    });
  }

  function showCalendarTooltipForSlot(idx, cell) {
    const events = calendarEventsBySlot.get(idx);
    if (!events || !events.length) return;
    const tip = createCalendarTooltip();
    tip.innerHTML = events.map(formatEventForTooltip).join("<hr/>");
    tip.style.display = "block";
    const rect = cell.getBoundingClientRect();
    const padding = 8;
    const maxW = Math.min(360, Math.max(180, rect.width * 2));
    tip.style.maxWidth = maxW + "px";
    let top = rect.top - tip.offsetHeight - padding;
    if (top < 6) {
      top = rect.bottom + padding;
    }
    let left = rect.left + (rect.width / 2) - (tip.offsetWidth / 2);
    left = Math.max(6, Math.min(left, window.innerWidth - tip.offsetWidth - 6));
    tip.style.top = top + "px";
    tip.style.left = left + "px";
  }

  function hideCalendarTooltip() {
    if (!_calendarTooltip) return;
    _calendarTooltip.style.display = "none";
  }

  if (safeGet(myNameKey) && participantName) participantName.value = safeGet(myNameKey);
  if (shareEl) shareEl.value = window.location.href;

  let isDown = false;
  let dragMode = null;
  window.addEventListener("pointerup", function() {
    isDown = false;
    dragMode = null;
  });

  async function loadEvent() {
    try {
      eventData = await fetchJson("/api/events/" + encodeURIComponent(eventId));
      if (titleEl) {
        if (eventData.title) {
          titleEl.textContent = eventData.title;
        } else {
          titleEl.textContent = "Availability poll";
        }
      }
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
    eventData.dates.forEach(function(d, i) {
      const opt = document.createElement("option");
      opt.value = i;
      const dateObject = new Date(d + "T00:00:00");
      opt.textContent = dateObject.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
      rangeDay.appendChild(opt);
    });
  }

  /**
   * Attaches event listeners to grid cell for drag selection and tooltips
   */
  function attachCellListeners(cell) {
    cell.addEventListener("pointerdown", function(e) {
      e.preventDefault();
      const idx = Number(cell.dataset.index);
      const isSelected = mySlots.has(idx);
      isDown = true;
      if (isSelected) {
        dragMode = "remove";
      } else {
        dragMode = "add";
      }
      const shouldSelect = dragMode === "add";
      toggleSlot(idx, shouldSelect);
    });
    
    cell.addEventListener("pointerenter", function() {
      if (!isDown || !dragMode) {
        return;
      }
      const shouldSelect = dragMode === "add";
      toggleSlot(Number(cell.dataset.index), shouldSelect);
    });
    
    cell.addEventListener("mouseenter", function(ev) {
      const idx = Number(cell.dataset.index);
      if (calendarEventsBySlot.has(idx)) {
        cell._calendarHoverTimeout = setTimeout(function() {
          showCalendarTooltipForSlot(idx, cell);
        }, 180);
      }
    });
    
    cell.addEventListener("mouseleave", function() {
      clearTimeout(cell._calendarHoverTimeout);
      hideCalendarTooltip();
    });
  }

  /**
   * Toggles slot selection and saves to localStorage
   * @param {number} idx - Slot index
   * @param {boolean} select - true to select, false to deselect
   */
  function toggleSlot(idx, select) {
    if (!Number.isInteger(idx)) return;
    const cell = cellsByIndex.get(idx);
    if (!cell) return;
    
    if (select) {
      mySlots.add(idx);
      cell.classList.add("my-slot");
    } else {
      mySlots.delete(idx);
      cell.classList.remove("my-slot");
    }
    
    safeSet(mySlotsKey, JSON.stringify(Array.from(mySlots)));
  }

  /**
   * Renders availability grid with heatmap and selection
   */
  function renderGrid() {
    if (!gridEl || !eventData) return;
    
    gridEl.innerHTML = "";
    cellsByIndex = new Map();
    
    const days = eventData.dates.length;
    const rows = eventData.grid.slotsPerDay;
    const maxCount = eventData.grid.maxCount || 0;
    const aggregate = eventData.grid.aggregate || [];
    const templateCols = "minmax(60px,80px) repeat(" + days + ", minmax(56px,1fr))";

    const header = document.createElement("div");
    header.className = "grid-header-row";
    header.style.gridTemplateColumns = templateCols;
    header.appendChild(Object.assign(document.createElement("div"), {
      className: "grid-time-cell"
    }));
    
    eventData.dates.forEach(function(d) {
      const h = document.createElement("div");
      h.className = "grid-day-header";
      const dateObject = new Date(d + "T00:00:00");
      h.textContent = dateObject.toLocaleDateString(undefined, {
        weekday: "short",
        month: "numeric",
        day: "numeric"
      });
      header.appendChild(h);
    });
    gridEl.appendChild(header);

    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "grid-row";
      rowEl.style.gridTemplateColumns = templateCols;
      
      const timeCell = document.createElement("div");
      timeCell.className = "grid-time-cell";
      if (eventData.times[r]) {
        timeCell.textContent = eventData.times[r];
      } else {
        timeCell.textContent = "";
      }
      rowEl.appendChild(timeCell);

      for (let d = 0; d < days; d++) {
        const idx = d * rows + r;
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.index = String(idx);
        const count = (aggregate[r] && aggregate[r][d]) || 0;
        let level = 0;
        if (maxCount !== 0) {
          level = Math.ceil((count / maxCount) * 4);
        }
        cell.classList.add("heat-" + level);
        
        if (mySlots.has(idx)) {
          cell.classList.add("my-slot");
        }
        
        attachCellListeners(cell);
        cellsByIndex.set(idx, cell);
        rowEl.appendChild(cell);
      }
      gridEl.appendChild(rowEl);
    }
  }

  /**
   * Renders top 5 time slots with most participants
   */
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
        items.push({
          day: d,
          row: r,
          count: cnt,
          names: (who[r] && who[r][d]) || []
        });
      }
    }
    
    items.sort(function(a, b) {
      return b.count - a.count;
    });
    
    if (items.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No availability submitted yet.";
      bestSlots.appendChild(li);
    } else {
      items.slice(0, 5).forEach(function(s) {
        const li = document.createElement("li");
        const mainDiv = document.createElement("div");
        mainDiv.className = "best-slot-main";
        
        const dateSpan = document.createElement("span");
        const dateObject = new Date(eventData.dates[s.day] + "T00:00:00");
        const formattedDate = dateObject.toLocaleDateString(undefined, {
          weekday: "short",
          month: "numeric",
          day: "numeric"
        });
        dateSpan.textContent = formattedDate + " @ " + eventData.times[s.row];
        
        const countSpan = document.createElement("span");
        countSpan.textContent = s.count + " available";
        
        mainDiv.appendChild(dateSpan);
        mainDiv.appendChild(countSpan);
        li.appendChild(mainDiv);
        
        const p = document.createElement("div");
        p.className = "best-slot-participants";
        
        if (!s.names.length) {
          p.textContent = "No one has picked this time yet.";
        } else {
          const label = document.createElement("span");
          label.textContent = "Participants:";
          p.appendChild(label);
          
          const sel = document.createElement("select");
          sel.className = "participant-dropdown";
          const opt = document.createElement("option");
          opt.disabled = true;
          opt.selected = true;
          let participantText = s.names.length + " participant";
          if (s.names.length > 1) {
            participantText = participantText + "s";
          }
          opt.textContent = participantText;
          sel.appendChild(opt);
          
          s.names.forEach(function(n) {
            const o = document.createElement("option");
            o.value = n;
            o.textContent = n;
            sel.appendChild(o);
          });
          
          p.appendChild(sel);
        }
        li.appendChild(p);
        bestSlots.appendChild(li);
      });
    }
    
    if (participantCountEl) {
      let participantsArray = [];
      if (eventData.participants) {
        participantsArray = eventData.participants;
      }
      const count = participantsArray.length;
      let participantText = count + " participant";
      if (count !== 1) {
        participantText = participantText + "s";
      }
      participantCountEl.textContent = participantText + " have responded.";
    }
  }

  /**
   * Saves selected slots to backend
   */
  async function saveAvailability() {
    if (!eventData) return;
    
    let name = "";
    if (participantName && participantName.value) {
      name = participantName.value.trim();
    }
    if (!name) {
      alert("Please enter your name before saving.");
      if (participantName) {
        participantName.focus();
      }
      return;
    }
    
    try {
      const slotsArray = Array.from(mySlots);
      await fetchJson("/api/events/" + encodeURIComponent(eventId) + "/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantName: name,
          slots: slotsArray
        }),
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
    cellsByIndex.forEach(function(c) {
      c.classList.remove("my-slot");
    });
  }

  /**
   * Builds time ranges for each slot (used for calendar overlap detection)
   * @returns {Array<Object>} Array of { start, end } objects
   */
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

  /**
   * Loads Google Calendar events and overlays them on the availability grid
   * 
   * This function:
   * 1. Obtains a Google Calendar API access token (prompts user if needed)
   * 2. Fetches calendar events from the user's primary calendar for the event date range
   * 3. Determines which time slots overlap with calendar events
   * 4. Marks those slots as "busy" in the UI with visual styling
   * 5. Stores event details for tooltip display on hover
   * 
   * The calendar overlay helps users see their existing commitments when
   * selecting available times, preventing double-booking.
   * 
   * @param {HTMLElement|null} statusEl - Optional status element to display progress/errors
   * @returns {Promise<void>}
   * 
   * @see https://developers.google.com/calendar/api/v3/reference/events/list
   */
  async function loadCalendarOverlayForCurrentEvent(statusEl) {
    if (!eventData) {
      if (statusEl) {
        statusEl.textContent = "Event not loaded yet.";
      }
      return;
    }
    try {
      if (statusEl) statusEl.textContent = "Contacting Google Calendar...";
      const token = await getCalendarAccessToken();
      if (!token) throw new Error("No calendar token");
      // fetch events
      const first = eventData.dates[0];
      const last = eventData.dates[eventData.dates.length - 1];
      const startHours = Math.floor(eventData.startTimeMinutes / 60);
      const startHoursString = String(startHours).padStart(2, "0");
      const startMinutes = eventData.startTimeMinutes % 60;
      const startMinutesString = String(startMinutes).padStart(2, "0");
      const startDateString = first + "T" + startHoursString + ":" + startMinutesString + ":00";
      const startISO = new Date(startDateString).toISOString();
      
      const endHours = Math.floor(eventData.endTimeMinutes / 60);
      const endHoursString = String(endHours).padStart(2, "0");
      const endMinutes = eventData.endTimeMinutes % 60;
      const endMinutesString = String(endMinutes).padStart(2, "0");
      const endDateString = last + "T" + endHoursString + ":" + endMinutesString + ":00";
      const endISO = new Date(endDateString).toISOString();
      const params = new URLSearchParams({ timeMin: startISO, timeMax: endISO, singleEvents: "true", orderBy: "startTime" });
      const calendarUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + params.toString();
      const resp = await fetch(calendarUrl, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!resp.ok) throw new Error(`Calendar error ${resp.status}`);
      const data = await resp.json();
      const ranges = buildSlotRanges();
      calendarBusy.clear();
      calendarEventsBySlot.clear();
      let itemsArray = [];
      if (data.items) {
        itemsArray = data.items;
      }
      for (let i = 0; i < itemsArray.length; i++) {
        const ev = itemsArray[i];
        let startDateTime = null;
        if (ev.start && ev.start.dateTime) {
          startDateTime = ev.start.dateTime;
        } else if (ev.start && ev.start.date) {
          startDateTime = ev.start.date + "T00:00:00";
        }
        const s = new Date(startDateTime).getTime();
        
        let endDateTime = null;
        if (ev.end && ev.end.dateTime) {
          endDateTime = ev.end.dateTime;
        } else if (ev.end && ev.end.date) {
          endDateTime = ev.end.date + "T23:59:59";
        }
        const e = new Date(endDateTime).getTime();
        
        ranges.forEach(function(r, idx) {
          if (r && r.start < e && r.end > s) {
            calendarBusy.add(idx);
            let list = calendarEventsBySlot.get(idx);
            if (!list) {
              list = [];
            }
            let summary = "";
            if (ev.summary) {
              summary = ev.summary;
            }
            let startValue = null;
            if (ev.start && ev.start.dateTime) {
              startValue = ev.start.dateTime;
            } else if (ev.start && ev.start.date) {
              startValue = ev.start.date;
            }
            let endValue = null;
            if (ev.end && ev.end.dateTime) {
              endValue = ev.end.dateTime;
            } else if (ev.end && ev.end.date) {
              endValue = ev.end.date;
            }
            let location = "";
            if (ev.location) {
              location = ev.location;
            }
            let description = "";
            if (ev.description) {
              description = ev.description;
            }
            list.push({
              summary: summary,
              start: startValue,
              end: endValue,
              location: location,
              description: description,
              raw: ev,
            });
            calendarEventsBySlot.set(idx, list);
          }
        });
      }
       // apply to DOM
       cellsByIndex.forEach(function(cell, idx) {
         const isBusy = calendarBusy.has(idx);
         cell.classList.toggle("busy-calendar", isBusy);
       });
       if (statusEl) {
         let itemsCount = 0;
         if (data.items) {
           itemsCount = data.items.length;
         }
         statusEl.textContent = "Overlay applied from " + itemsCount + " event(s).";
       }
       // optionally send token to backend
       sendCalendarAccessTokenToBackend(token).catch(function() {
         // Ignore errors
       });
    } catch (e) {
      console.error(e);
      if (statusEl) {
        if (e.message) {
          statusEl.textContent = e.message;
        } else {
          statusEl.textContent = "Failed to load calendar overlay.";
        }
      }
    }
  }

  // ========================================================================
  // UI EVENT HANDLERS
  // ========================================================================
  /**
   * BLOCK: Wire Up UI Event Handlers
   * 
   * Attaches click handlers to all interactive buttons on the event page.
   */
  
  // Save button: Save selected slots to backend
  if (saveBtn) {
    saveBtn.addEventListener("click", saveAvailability);
  }
  
  // Clear button: Clear local selection (doesn't affect server)
  if (clearBtn) {
    clearBtn.addEventListener("click", clearMyAvailability);
  }
  
  /**
   * Range Apply Button Handler
   * 
   * Allows users to quickly select a range of time slots on a specific day.
   * Useful for mobile devices where tapping individual cells is tedious.
   * 
   * Process:
   * 1. Get selected day, start time, and end time
   * 2. Convert times to minutes since midnight
   * 3. Calculate which grid rows correspond to those times
   * 4. Select all slots in that range for the selected day
   * 
   * Time-to-Row Conversion:
   * - Formula: row = floor((timeMinutes - startTimeMinutes) / slotMinutes)
   * - Clamped to valid row range (0 to rows-1)
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/floor
   */
  if (rangeApply) {
    rangeApply.addEventListener("click", function(ev) {
      ev.preventDefault();
      
      // Get form values
      let dayIndex = 0;
      if (rangeDay && rangeDay.value) {
        dayIndex = Number(rangeDay.value);
      }
      let from = null;
      if (rangeFrom && rangeFrom.value) {
        from = rangeFrom.value;
      }
      let to = null;
      if (rangeTo && rangeTo.value) {
        to = rangeTo.value;
      }
    
    // Validate inputs
    if (!from || !to) {
      alert("Please fill both From and To times.");
      return;
    }
    
      // Parse time strings (HH:MM format)
      const fromParts = from.split(":");
      const fh = Number(fromParts[0]);
      const fm = Number(fromParts[1]);
      const toParts = to.split(":");
      const th = Number(toParts[0]);
      const tm = Number(toParts[1]);
    
    // Convert to minutes since midnight
    const fromMinutes = fh * 60 + fm;
    const toMinutes = th * 60 + tm;
    
    // Validate time range
    if (toMinutes <= fromMinutes) {
      alert("End time must be after start time.");
      return;
    }
    
    // Calculate which grid rows correspond to these times
    const start = eventData.startTimeMinutes;
    const step = eventData.slotMinutes;
    const rows = eventData.grid.slotsPerDay;
    
      /**
       * Clamp function: Converts time in minutes to grid row index
       * 
       * Formula: row = floor((timeMinutes - startTimeMinutes) / slotMinutes)
       * Clamped to valid range: [0, rows-1]
       */
      function clamp(mins) {
        const calculatedRow = Math.floor((mins - start) / step);
        return Math.max(0, Math.min(rows - 1, calculatedRow));
      }
      
      const sRow = clamp(fromMinutes); // Start row
      const eRow = clamp(toMinutes - 1); // End row (subtract 1 to include end time's slot)
      
      // Select all slots in range for the selected day
      // Slot index formula: (dayIndex * rows) + rowIndex
      for (let r = sRow; r <= eRow; r++) {
        toggleSlot(dayIndex * rows + r, true);
      }
    });
  }

  if (overlayBtn) {
    overlayBtn.addEventListener("click", function() {
      loadCalendarOverlayForCurrentEvent(overlayStatus);
    });
  }
  // expose loader for other code (e.g. sign-in flow)
  window.loadCalendarOverlayForCurrentEvent = loadCalendarOverlayForCurrentEvent;

  // ========================================================================
  // INITIAL PAGE LOAD
  // ========================================================================
  /**
   * BLOCK: Initial Event Load and Auto-Apply Calendar Overlay
   * 
   * When the event page loads:
   * 1. Fetch event data from backend
   * 2. Render the grid and UI
   * 3. If user has a valid cached calendar token, auto-apply calendar overlay
   * 
   * Auto-Apply Logic:
   * - Checks sessionStorage for cached calendar token
   * - Only applies if token is still valid (1 minute safety margin)
   * - Avoids prompting user if they've already granted calendar access
   * - Provides seamless experience for returning users
   */
  loadEvent().then(() => {
    // Auto-apply calendar overlay if a valid session-scoped calendar token is cached
    // This avoids prompting the user or requiring them to click the overlay button
    try {
      const raw = sessionStorage.getItem(CAL_TOKEN_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        // Only auto-apply when token still valid (1 minute safety margin)
        // Date.now() returns milliseconds, expires_at is also in milliseconds
        if (obj && obj.access_token && obj.expires_at && Date.now() < obj.expires_at - 60000) {
          loadCalendarOverlayForCurrentEvent(overlayStatus);
        }
      }
    } catch (e) {
      /* non-fatal - if parsing fails, just skip auto-apply */
    }
  });
}

/**
 * BLOCK: Appearance Page Initialization
 * 
 * This function sets up the appearance/theme settings page:
 * - Form submission handler for theme and density preferences
 * - Saves preferences to backend (requires authentication)
 * - Applies theme immediately to current page
 * 
 * Theme Application:
 * - Sets data-theme attribute on <html> element
 * - CSS uses attribute selectors to apply theme styles
 * - Example: <html data-theme="midnight"> triggers midnight theme
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit_event
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dataset
 */
function initAppearancePage() {
  const form = $("#appearance-form");
  if (!form) return;
  
  /**
   * Form Submit Handler
   * 
   * Handles appearance form submission:
   * - Gets selected theme and density from radio buttons
   * - Sends to backend for persistence
   * - Applies theme immediately to current page
   */
  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    
    // Get selected radio button values
    // querySelector with :checked pseudo-class gets the selected option
    // Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/:checked
    const themeInput = form.querySelector('input[name="theme"]:checked');
    let theme = null;
    if (themeInput && themeInput.value) {
      theme = themeInput.value;
    }
    const densityInput = form.querySelector('input[name="density"]:checked');
    let density = null;
    if (densityInput && densityInput.value) {
      density = densityInput.value;
    }
    
    try {
      // Save preferences to backend
      const data = await fetchJson("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, density }),
      });
      
      // Apply theme immediately (no page reload needed)
      if (data && data.theme) {
        document.documentElement.dataset.theme = data.theme;
      }
      
      alert("Appearance saved.");
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to save appearance.");
    }
  });
}

// ============================================================================
// APPLICATION BOOTSTRAP - DOMContentLoaded Handler
// ============================================================================

/**
 * BLOCK: Application Initialization
 * 
 * This is the main entry point that runs when the DOM is fully loaded.
 * It initializes all page-specific functionality based on the current page.
 * 
 * Initialization Order:
 * 1. Restore profile picture/name from localStorage (if available)
 * 2. Initialize Google Sign-In button (after short delay for API loading)
 * 3. Load user and theme from backend
 * 4. Initialize page-specific functionality
 * 5. Wire up topbar navigation behavior
 * 
 * Page Detection:
 * - Uses body class names to identify page type
 * - Each page has its own initializer function
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Document/DOMContentLoaded_event
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/setTimeout
 */
document.addEventListener("DOMContentLoaded", function() {
  /**
   * BLOCK: Restore Profile from localStorage
   * 
   * Rehydrates the topbar profile picture and name from localStorage.
   * This provides instant visual feedback without waiting for Google API.
   */
  const storedPic = safeGet("hsync:profilePic");
  const storedName = safeGet("hsync:profileName");
  if (storedPic || storedName) {
    setTopbarProfile(storedPic, storedName);
  }
  
  /**
   * BLOCK: Initialize Google Sign-In Button
   * 
   * Delayed by 200ms to ensure Google's GSI script has loaded.
   * The script is loaded with async defer, so it may not be ready immediately.
   */
  setTimeout(initTopbarGsi, 200);

  /**
   * BLOCK: Page-Specific Initialization
   * 
   * Detects current page type and calls appropriate initializer.
   * Each initializer is wrapped in loadCurrentUserAndTheme() to ensure
   * user data and theme are loaded before page-specific code runs.
   */
  if (document.body.classList.contains("page-home")) {
    loadCurrentUserAndTheme().then(function() {
      initHomePage();
    });
  }
  if (document.body.classList.contains("page-join")) {
    loadCurrentUserAndTheme().then(function() {
      initJoinPage();
    });
  }
  if (document.body.classList.contains("page-event")) {
    loadCurrentUserAndTheme().then(function() {
      initEventPage();
    });
  }
  if (document.body.classList.contains("page-appearance")) {
    initAppearancePage();
  }

  /**
   * BLOCK: Topbar Event Link Smart Navigation
   * 
   * Makes the "Event" link in the topbar navigate to the most relevant event:
   * 1. Session event (current tab's active event) - highest priority
   * 2. Last opened event (from localStorage) - second priority
   * 3. Last joined event (from localStorage) - third priority
   * 4. Join page (if no saved events) - fallback
   * 
   * Special handling:
   * - Respects modifier keys (Ctrl/Cmd/Shift) and middle-click for new tabs
   * - Prevents default navigation to use smart routing
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent
   */
  try {
    const eventLink = document.querySelector('.topbar-nav a[href="event.html"]');
    if (eventLink) {
      eventLink.addEventListener("click", function(ev) {
        // Allow default behavior for modifier keys (new tab, etc.)
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) {
          return;
        }
        
        ev.preventDefault();
        
        // Prefer session-scoped event for this tab, then fall back to persisted IDs
        const sessionId = getSessionEvent();
        let last = null;
        if (sessionId) {
          last = sessionId;
        } else {
          const lastOpened = getLastOpenedEvent();
          if (lastOpened) {
            last = lastOpened;
          } else {
            const lastJoined = getLastJoinedEvent();
            if (lastJoined) {
              last = lastJoined;
            }
          }
        }
        
        if (last) {
          window.location.href = "/event.html?id=" + encodeURIComponent(last);
        } else {
          window.location.href = "/join.html";
        }
      });
    }
  } catch (e) {
    console.warn("Could not wire Event topbar link:", e);
  }
});
}
