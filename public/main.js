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
  // Fetch response
  const res = await fetch(url, opts);
  
  // Read response text
  let text = "";
  try {
    text = await res.text();
  } catch (e) {
    text = "";
  }
  
  // Parse JSON
  let data = {};
  try { 
    data = text ? JSON.parse(text) : {}; 
  } catch {}
  
  // Handle errors
  if (!res.ok) {
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
  } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
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
function getCalendarAccessToken(forceRefresh) {
  if (forceRefresh === undefined) {
    forceRefresh = false;
  }
  // Check cache first
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

  // Request new token
  return new Promise(function(resolve, reject) {
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
                expires_in = 55 * 60;
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
  // Extract user info from JWT
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

  // Send token to backend
  sendGoogleIdTokenToBackend(resp.credential).catch(function() {});

  // Load calendar if on event page
  if (document.body.classList.contains("page-event")) {
    try {
      let token = null;
      try {
        token = await getCalendarAccessToken();
      } catch (e) {
        token = null;
      }
      if (token) {
        sendCalendarAccessTokenToBackend(token).catch(function() {});
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
    // Fetch user data
    let me = { user: null };
    try {
      me = await fetchJson("/api/me");
    } catch (e) {
      me = { user: null };
    }
    // Fetch theme preferences
    let themePrefs = null;
    try {
      themePrefs = await fetchJson("/api/theme");
    } catch (e) {
      themePrefs = null;
    }
    
    // Apply theme to page
    if (themePrefs) {
      if (themePrefs.theme) {
        document.documentElement.dataset.theme = themePrefs.theme;
      }
      if (themePrefs.density) {
        document.documentElement.dataset.density = themePrefs.density;
      }
    }
    
    // Return data
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
    // Fallback to defaults
    let currentTheme = document.documentElement.dataset.theme;
    if (!currentTheme) {
      currentTheme = "harvard";
    }
    document.documentElement.dataset.theme = currentTheme;
    let currentDensity = document.documentElement.dataset.density;
    if (!currentDensity) {
      currentDensity = "comfortable";
    }
    document.documentElement.dataset.density = currentDensity;
    return { user: null, themePrefs: null };
  }
}

/**
 * Initializes home page: event creation form and logout button
 */
function initHomePage() {
  const form = $("#create-event-form");
  if (!form) return;
  
  // Handle form submission
  form.addEventListener("submit", async function(ev) {
    ev.preventDefault();
    
    // Get form values
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
        body: JSON.stringify({
          title: title,
          startDate: startDate,
          endDate: endDate,
          startTime: startTime,
          endTime: endTime,
          slotMinutes: slotMinutes
        }),
      });
      window.location.href = "/event.html?id=" + encodeURIComponent(data.id);
    } catch (err) {
      console.error(err);
      alert(err.message || "Error creating event.");
    }
  });

  // Handle logout button
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

  // Save event ID and show message
  function saveAndReport(id) {
    try {
      setLastJoinedEvent(id);
    } catch (e) {}
    if (msg) {
      msg.textContent = "Saved poll " + id + ". Click \"Open poll\" to go to it.";
    }
  }

  // Pre-fill input from URL or last saved
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

  // Handle open button click
  if (openBtn) {
    openBtn.addEventListener("click", function() {
      // Get input value
      let raw = "";
      if (input && input.value) {
        raw = input.value.trim();
      }
      if (!raw) {
        return;
      }
      
      // Extract event ID from URL or text
      let id = raw;
      try {
        const maybeUrl = new URL(raw);
        const match = maybeUrl.searchParams.get("id");
        if (match) {
          id = match;
        } else {
          const parts = maybeUrl.pathname.split("/");
          let lastPart = parts[parts.length - 1];
          let secondLastPart = parts[parts.length - 2];
          if (lastPart) {
            id = lastPart;
          } else if (secondLastPart) {
            id = secondLastPart;
          } else {
            id = "";
          }
          if (id === "event.html") {
            const queryId = maybeUrl.searchParams.get("id");
            if (queryId) {
              id = queryId;
            } else {
              id = "";
            }
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

  // Cache DOM elements
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
  let overlayBtn = null;
  if (overlayBtn1) {
    overlayBtn = overlayBtn1;
  } else if (overlayBtn2) {
    overlayBtn = overlayBtn2;
  }
  const overlayStatus = $("#calendar-overlay-status");

  const mySlotsKey = "hsync:" + eventId + ":mySlots";
  const myNameKey = "hsync:" + eventId + ":myName";

  // Initialize state
  let eventData = null;
  let cellsByIndex = new Map();
  let mySlotsArrayString = safeGet(mySlotsKey);
  if (!mySlotsArrayString) {
    mySlotsArrayString = "[]";
  }
  let mySlotsArray = JSON.parse(mySlotsArrayString);
  let mySlotsNumberArray = [];
  for (let i = 0; i < mySlotsArray.length; i++) {
    mySlotsNumberArray.push(Number(mySlotsArray[i]));
  }
  let mySlots = new Set(mySlotsNumberArray);
  let calendarBusy = new Set();
  let calendarEventsBySlot = new Map();

  // Calendar tooltip management
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

  // Format calendar event for tooltip display
  function formatEventForTooltip(ev) {
    // Format time range
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
    // Format location and description
    let loc = "";
    if (ev.location) {
      loc = "<div class=\"cal-ev-loc\">" + escapeHtml(ev.location) + "</div>";
    }
    let desc = "";
    if (ev.description) {
      desc = "<div class=\"cal-ev-desc\">" + escapeHtml(ev.description) + "</div>";
    }
    // Format summary
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

  // Show tooltip with calendar events for a slot
  function showCalendarTooltipForSlot(idx, cell) {
    const events = calendarEventsBySlot.get(idx);
    if (!events || !events.length) return;
    // Create and format tooltip
    const tip = createCalendarTooltip();
    let formattedEvents = [];
    for (let i = 0; i < events.length; i++) {
      formattedEvents.push(formatEventForTooltip(events[i]));
    }
    tip.innerHTML = formattedEvents.join("<hr/>");
    tip.style.display = "block";
    // Position tooltip above or below cell
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

  // Restore saved name and share link
  if (safeGet(myNameKey) && participantName) participantName.value = safeGet(myNameKey);
  if (shareEl) shareEl.value = window.location.href;

  // Track drag selection state
  let isDown = false;
  let dragMode = null;
  window.addEventListener("pointerup", function() {
    isDown = false;
    dragMode = null;
  });

  // Load event data and render UI
  async function loadEvent() {
    try {
      eventData = await fetchJson("/api/events/" + encodeURIComponent(eventId));
      // Update title
      if (titleEl) {
        if (eventData.title) {
          titleEl.textContent = eventData.title;
        } else {
          titleEl.textContent = "Availability poll";
        }
      }
      // Render components
      renderRangeOptions();
      renderGrid();
      renderBestSlots();
    } catch (err) {
      console.error(err);
      alert(err.message || "Error loading event.");
    }
  }

  // Populate day selector dropdown
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
  // Add click, drag, and hover listeners to grid cell
  function attachCellListeners(cell) {
    // Handle click/drag start
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
    
    // Handle drag over
    cell.addEventListener("pointerenter", function() {
      if (!isDown || !dragMode) {
        return;
      }
      const shouldSelect = dragMode === "add";
      toggleSlot(Number(cell.dataset.index), shouldSelect);
    });
    
    // Show calendar tooltip on hover
    cell.addEventListener("mouseenter", function(ev) {
      const idx = Number(cell.dataset.index);
      if (calendarEventsBySlot.has(idx)) {
        cell._calendarHoverTimeout = setTimeout(function() {
          showCalendarTooltipForSlot(idx, cell);
        }, 180);
      }
    });
    
    // Hide tooltip on mouse leave
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
  // Render availability grid with heatmap
  function renderGrid() {
    if (!gridEl || !eventData) return;
    
    gridEl.innerHTML = "";
    cellsByIndex = new Map();
    
    // Calculate grid dimensions
    const days = eventData.dates.length;
    const rows = eventData.grid.slotsPerDay;
    const maxCount = eventData.grid.maxCount || 0;
    const aggregate = eventData.grid.aggregate || [];
    const templateCols = "minmax(60px,80px) repeat(" + days + ", minmax(56px,1fr))";

    // Create header row
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

    // Create time rows
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

      // Create day cells for this time slot
      for (let d = 0; d < days; d++) {
        const idx = d * rows + r;
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.index = String(idx);
        // Calculate heatmap level
        let count = 0;
        if (aggregate[r] && aggregate[r][d]) {
          count = aggregate[r][d];
        }
        let level = 0;
        if (maxCount !== 0) {
          level = Math.ceil((count / maxCount) * 4);
        }
        cell.classList.add("heat-" + level);
        
        // Mark user's selected slots
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
  // Render top 5 best time slots
  function renderBestSlots() {
    if (!bestSlots || !eventData) return;
    
    bestSlots.innerHTML = "";
    const agg = eventData.grid.aggregate || [];
    const who = eventData.grid.who || [];
    const rows = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const participants = eventData.participants || [];

    // Collect all slots with availability
    const items = [];
    for (let d = 0; d < days; d++) {
      for (let r = 0; r < rows; r++) {
        const cnt = (agg[r] && agg[r][d]) || 0;
        if (cnt <= 0) continue;
        items.push({
          day: d,
          row: r,
          count: cnt,
          names: (who[r] && who[r][d]) ? who[r][d] : []
        });
      }
    }
    
    // Sort by participant count
    items.sort(function(a, b) {
      return b.count - a.count;
    });
    
    // Render top 5 or empty message
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
        
        // Add participant list
        const p = document.createElement("div");
        p.className = "best-slot-participants";
        
        if (!s.names.length) {
          p.textContent = "No one has picked this time yet.";
        } else {
          // Create dropdown with participant names
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
    
    // Update participant count
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
  // Save user's availability to backend
  async function saveAvailability() {
    if (!eventData) return;
    
    // Validate name
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
    
    // Send to backend
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
  // Build time ranges for calendar overlap detection
  function buildSlotRanges() {
    if (!eventData) return [];
    const perDay = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const minutes = eventData.slotMinutes;
    const ranges = new Array(days * perDay);
    
    // Calculate start/end timestamps for each slot
    for (let d = 0; d < days; d++) {
      for (let r = 0; r < perDay; r++) {
        const startMin = eventData.startTimeMinutes + r * minutes;
        const h = Math.floor(startMin / 60).toString().padStart(2, "0");
        const m = (startMin % 60).toString().padStart(2, "0");
        const dateTimeString = eventData.dates[d] + "T" + h + ":" + m + ":00";
        const start = new Date(dateTimeString).getTime();
        const end = start + minutes * 60000;
        ranges[d * perDay + r] = {
          start: start,
          end: end
        };
      }
    }
    return ranges;
  }

/**
 * Loads calendar events and overlays them on the grid
 * @param {HTMLElement|null} statusEl - Status element
 */
  // Load calendar events and mark overlapping slots
  async function loadCalendarOverlayForCurrentEvent(statusEl) {
    if (!eventData) {
      if (statusEl) {
        statusEl.textContent = "Event not loaded yet.";
      }
      return;
    }
    try {
      // Get access token
      if (statusEl) statusEl.textContent = "Contacting Google Calendar...";
      const token = await getCalendarAccessToken();
      if (!token) throw new Error("No calendar token");
      // Build date range for API request
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
      // Fetch calendar events
      const params = new URLSearchParams({ timeMin: startISO, timeMax: endISO, singleEvents: "true", orderBy: "startTime" });
      const calendarUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + params.toString();
      const resp = await fetch(calendarUrl, {
        headers: { Authorization: "Bearer " + token },
      });
      if (!resp.ok) {
        throw new Error("Calendar error " + resp.status);
      }
      const data = await resp.json();
      // Find overlapping slots
      const ranges = buildSlotRanges();
      calendarBusy.clear();
      calendarEventsBySlot.clear();
      let itemsArray = [];
      if (data.items) {
        itemsArray = data.items;
      }
      for (let i = 0; i < itemsArray.length; i++) {
        // Parse event times
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
        
        // Check which slots overlap with this event
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
      // Apply busy styling to overlapping cells
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
      sendCalendarAccessTokenToBackend(token).catch(function() {});
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

  // Wire up button handlers
  if (saveBtn) {
    saveBtn.addEventListener("click", saveAvailability);
  }
  
  if (clearBtn) {
    clearBtn.addEventListener("click", clearMyAvailability);
  }
  
  // Handle range selection
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
    
      // Parse times
      const fromParts = from.split(":");
      const fh = Number(fromParts[0]);
      const fm = Number(fromParts[1]);
      const toParts = to.split(":");
      const th = Number(toParts[0]);
      const tm = Number(toParts[1]);
      
      // Convert to minutes
      const fromMinutes = fh * 60 + fm;
      const toMinutes = th * 60 + tm;
      
      if (toMinutes <= fromMinutes) {
        alert("End time must be after start time.");
        return;
      }
      
      // Calculate row indices
      const start = eventData.startTimeMinutes;
      const step = eventData.slotMinutes;
      const rows = eventData.grid.slotsPerDay;
      
      function clamp(mins) {
        const calculatedRow = Math.floor((mins - start) / step);
        return Math.max(0, Math.min(rows - 1, calculatedRow));
      }
      
      const sRow = clamp(fromMinutes);
      const eRow = clamp(toMinutes - 1);
      
      // Select all slots in range
      for (let r = sRow; r <= eRow; r++) {
        toggleSlot(dayIndex * rows + r, true);
      }
    });
  }

  // Handle calendar overlay button
  if (overlayBtn) {
    overlayBtn.addEventListener("click", function() {
      loadCalendarOverlayForCurrentEvent(overlayStatus);
    });
  }
  window.loadCalendarOverlayForCurrentEvent = loadCalendarOverlayForCurrentEvent;

  // Load event and auto-apply calendar overlay if token cached
  loadEvent().then(function() {
    try {
      const raw = sessionStorage.getItem(CAL_TOKEN_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && obj.access_token && obj.expires_at && Date.now() < obj.expires_at - 60000) {
          loadCalendarOverlayForCurrentEvent(overlayStatus);
        }
      }
    } catch (e) {}
  });
}

/**
 * Initializes appearance page: theme and density settings
 */
function initAppearancePage() {
  const form = $("#appearance-form");
  if (!form) return;
  
  // Handle form submission
  form.addEventListener("submit", async function(e) {
    e.preventDefault();
    
    // Get selected values
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
    
    // Save to backend
    try {
      const data = await fetchJson("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme: theme,
          density: density
        }),
      });
      
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

document.addEventListener("DOMContentLoaded", function() {
  // Restore profile from localStorage
  const storedPic = safeGet("hsync:profilePic");
  const storedName = safeGet("hsync:profileName");
  if (storedPic || storedName) {
    setTopbarProfile(storedPic, storedName);
  }
  
  // Initialize Google Sign-In button
  setTimeout(initTopbarGsi, 200);

  // Initialize page-specific functionality
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

  // Wire up smart navigation for event link
  try {
    const eventLink = document.querySelector('.topbar-nav a[href="event.html"]');
    if (eventLink) {
      eventLink.addEventListener("click", function(ev) {
        // Allow default for modifier keys
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) {
          return;
        }
        
        ev.preventDefault();
        
        // Navigate to most relevant event
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