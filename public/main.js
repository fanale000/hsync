/**
 * main.js - HSync Frontend Client Application
 * 
 * This is the main client-side JavaScript file for the HSync scheduling application.
 * It handles all user interactions, UI rendering, Google authentication, calendar integration,
 * and communication with the backend API.
 * 
 * Key Technologies:
 * - Vanilla JavaScript (ES6+) - No framework dependencies
 * - Google Identity Services (GSI) - For Google Sign-In
 *   Documentation: https://developers.google.com/identity/gsi/web
 * - Google Calendar API - For calendar event overlay
 *   Documentation: https://developers.google.com/calendar/api
 * - Fetch API - For HTTP requests to backend
 *   Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
 * - Web Storage APIs - localStorage and sessionStorage for persistence
 *   Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 * - Pointer Events API - For drag-to-select functionality
 *   Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
 * 
 * Architecture:
 * - Page-specific initializers (initHomePage, initJoinPage, initEventPage, initAppearancePage)
 * - Shared utility functions for DOM manipulation, storage, and API calls
 * - Google OAuth integration for authentication and calendar access
 * - Real-time availability grid rendering with heatmap visualization
 * 
 * @module main
 */

/**
 * Google OAuth 2.0 Client ID
 * 
 * This is the client ID obtained from Google Cloud Console when setting up OAuth credentials.
 * It's used for both Google Sign-In (ID token) and Calendar API access (access token).
 * 
 * @see https://console.cloud.google.com/apis/credentials
 * @see https://developers.google.com/identity/protocols/oauth2
 */
const GOOGLE_CLIENT_ID = "19747295970-tp902n56girks9e8kegdl1vlod13l3ti.apps.googleusercontent.com";

// ============================================================================
// DOM UTILITY FUNCTIONS
// ============================================================================

/**
 * jQuery-like selector function for single element queries
 * 
 * Shorthand for document.querySelector with optional context parameter.
 * 
 * @param {string} sel - CSS selector string
 * @param {Element|Document} ctx - Optional context element (defaults to document)
 * @returns {Element|null} First matching element or null
 * 
 * @example
 * const title = $("#event-title");
 * const button = $(".btn", container);
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector
 */
const $ = (sel, ctx = document) => ctx.querySelector(sel);

/**
 * jQuery-like selector function for multiple element queries
 * 
 * Returns an array of all matching elements (not a NodeList).
 * 
 * @param {string} sel - CSS selector string
 * @param {Element|Document} ctx - Optional context element (defaults to document)
 * @returns {Element[]} Array of matching elements
 * 
 * @example
 * const buttons = $$(".btn");
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelectorAll
 */
const $$ = (sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel));

/**
 * Extracts a query parameter value from the current page URL
 * 
 * @param {string} name - Query parameter name
 * @returns {string|null} Parameter value or null if not found
 * 
 * @example
 * // URL: /event.html?id=abc123
 * const eventId = getQueryParam("id"); // "abc123"
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/URL/searchParams
 */
const getQueryParam = (name) => new URL(window.location.href).searchParams.get(name);

// ============================================================================
// API COMMUNICATION
// ============================================================================

/**
 * Lightweight fetch wrapper that automatically parses JSON and throws on errors
 * 
 * This utility function wraps the Fetch API to provide a simpler interface:
 * - Automatically parses JSON responses
 * - Throws errors for non-2xx status codes
 * - Extracts error messages from response body
 * - Preserves status code and response body in error object
 * 
 * @param {string} url - Request URL (relative or absolute)
 * @param {RequestInit} opts - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Object>} Parsed JSON response data
 * @throws {Error} If response status is not 2xx, error includes status and body
 * 
 * @example
 * try {
 *   const data = await fetchJson("/api/events", { method: "POST", body: JSON.stringify({...}) });
 * } catch (err) {
 *   console.error("Request failed:", err.status, err.message);
 * }
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Response
 */
async function fetchJson(url, opts = {}) {
  // Make the HTTP request
  const res = await fetch(url, opts);
  
  // Read response body as text (with fallback to empty string on error)
  const text = await res.text().catch(() => "");
  
  // Attempt to parse as JSON, fallback to empty object if parsing fails
  let data = {};
  try { 
    data = text ? JSON.parse(text) : {}; 
  } catch {}
  
  // If response is not OK (status not in 200-299 range), throw an error
  if (!res.ok) {
    // Extract error message from response body, fallback to status text or status code
    const msg = data?.error || data?.message || res.statusText || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status; // Attach status code for error handling
    err.body = data; // Attach parsed body for detailed error information
    throw err;
  }
  
  return data;
}

/**
 * Decodes a JWT (JSON Web Token) payload without verification
 * 
 * This function extracts the payload from a JWT token without verifying the signature.
 * It's used for client-side extraction of user information from Google ID tokens.
 * 
 * WARNING: This does NOT verify the token signature. For security, tokens should
 * always be verified server-side. This is only used for extracting display information.
 * 
 * JWT structure: header.payload.signature
 * - Header: Algorithm and token type
 * - Payload: Claims (user data)
 * - Signature: Cryptographic signature (not used here)
 * 
 * @param {string} token - JWT token string
 * @returns {Object|null} Decoded payload object or null on error
 * 
 * @example
 * const payload = parseJwt(idToken);
 * // payload: { sub: "123456789", name: "John Doe", email: "john@example.com", ... }
 * 
 * @see https://jwt.io/introduction
 * @see https://developers.google.com/identity/protocols/oauth2/openid-connect#obtainuserinfo
 */
function parseJwt(token) {
  if (!token) return null;
  try {
    // JWT format: header.payload.signature (three parts separated by dots)
    // We only need the payload (middle part)
    const payload = token.split(".")[1];
    
    // Base64URL decoding: replace URL-safe characters with standard Base64 characters
    // Base64URL uses - and _ instead of + and /, and omits padding
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    
    // decodeURIComponent(escape(...)) is a compatibility shim for handling
    // UTF-8 encoded strings in older JavaScript environments
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (e) {
    // Return null on any error (malformed token, parse error, etc.)
    return null;
  }
}

/* -------------------------
   Local / session storage helpers
   ------------------------- */
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeRemove(key) { try { localStorage.removeItem(key); } catch (e) {} }

function setLastOpenedEvent(id) { if (id) safeSet("hsync:lastOpenedEvent", String(id)); else safeRemove("hsync:lastOpenedEvent"); }
function getLastOpenedEvent() { return safeGet("hsync:lastOpenedEvent"); }
function setLastJoinedEvent(id) { if (id) safeSet("hsync:lastJoinedEvent", String(id)); else safeRemove("hsync:lastJoinedEvent"); }
function getLastJoinedEvent() { return safeGet("hsync:lastJoinedEvent"); }

// Session-scoped current event (persists only for this tab/window)
function setSessionEvent(id) { try { if (id) sessionStorage.setItem("hsync:sessionEvent", String(id)); else sessionStorage.removeItem("hsync:sessionEvent"); } catch (e) {} }
function getSessionEvent() { try { return sessionStorage.getItem("hsync:sessionEvent"); } catch (e) { return null; } }
function clearSessionEvent() { try { sessionStorage.removeItem("hsync:sessionEvent"); } catch (e) {} }

// ============================================================================
// GOOGLE AUTHENTICATION & CALENDAR INTEGRATION
// ============================================================================

/**
 * Google OAuth 2.0 Token Client instance
 * 
 * This is a singleton instance of the Google OAuth 2.0 token client used to
 * obtain access tokens for the Google Calendar API. It's initialized lazily
 * on first use.
 * 
 * @type {google.accounts.oauth2.TokenClient|null}
 * 
 * @see https://developers.google.com/identity/oauth2/web/guides/use-token-model
 */
let calendarTokenClient = null;

/**
 * SessionStorage key for caching calendar access tokens
 * 
 * Tokens are cached in sessionStorage to avoid prompting the user repeatedly.
 * They expire after ~1 hour, so we check expiry before reusing.
 */
const CAL_TOKEN_KEY = "hsync:calToken";

/**
 * Obtains a Google Calendar API access token
 * 
 * This function manages the OAuth 2.0 flow for accessing the user's Google Calendar:
 * 1. Checks for a cached token in sessionStorage
 * 2. If cached token is valid (not expired), returns it immediately
 * 3. Otherwise, initializes/uses the OAuth token client to request a new token
 * 4. The token client will show a consent dialog if the user hasn't granted permission
 * 
 * The access token is used to make authenticated requests to the Google Calendar API
 * to fetch the user's calendar events for the overlay feature.
 * 
 * @param {boolean} forceRefresh - If true, bypasses cache and requests a new token
 * @returns {Promise<string>} Access token string
 * @throws {Error} If Google API is not loaded or token request fails
 * 
 * @example
 * const token = await getCalendarAccessToken();
 * // Use token to fetch calendar events
 * 
 * @see https://developers.google.com/identity/oauth2/web/guides/use-token-model
 * @see https://developers.google.com/calendar/api/guides/overview
 */
function getCalendarAccessToken(forceRefresh = false) {
  try {
    if (!forceRefresh) {
      const raw = sessionStorage.getItem(CAL_TOKEN_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj?.access_token && obj?.expires_at && Date.now() < obj.expires_at - 60000) {
          return Promise.resolve(obj.access_token);
        }
      }
    }
  } catch (e) { /* ignore parse errors and continue to request new token */ }

  return new Promise((resolve, reject) => {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      return reject(new Error("Google API not loaded"));
    }

    if (!calendarTokenClient) {
      try {
        calendarTokenClient = google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.profile",
          callback: (resp) => {
            if (resp && resp.access_token) {
              const expires_in = Number(resp.expires_in) || (55 * 60); // seconds
              const expires_at = Date.now() + expires_in * 1000;
              try {
                sessionStorage.setItem(CAL_TOKEN_KEY, JSON.stringify({ access_token: resp.access_token, expires_at }));
              } catch (e) {}
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
      // Will prompt user if no valid cached token exists
      calendarTokenClient.requestAccessToken();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Sends Google ID token to backend for server-side session creation
 * 
 * When a user signs in with Google, the frontend receives an ID token (JWT).
 * This function forwards that token to the backend, which verifies it and
 * creates a server-side session. This is optional - the frontend can work
 * without it, but server-side sessions enable features like theme persistence.
 * 
 * @param {string} idToken - Google ID token (JWT) from Google Sign-In
 * @returns {Promise<Object|null>} Backend user object or null on error
 * 
 * @see https://developers.google.com/identity/sign-in/web/backend-auth
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
 * Optionally sends calendar access token to backend (best-effort, non-blocking)
 * 
 * This function attempts to send the calendar access token to the backend,
 * but failures are silently ignored. This allows the backend to potentially
 * use the token for server-side calendar operations, though currently the
 * backend doesn't implement this endpoint.
 * 
 * @param {string} accessToken - Google Calendar API access token
 * @returns {Promise<void>} Resolves regardless of success/failure
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
 * Fetches Google user profile information using an OAuth access token
 * 
 * Uses the Google OAuth 2.0 userinfo endpoint to retrieve the user's profile
 * information (name, email, picture) when those details aren't available
 * from the ID token.
 * 
 * @param {string} accessToken - OAuth 2.0 access token
 * @returns {Promise<Object|null>} User profile object or null on error
 * 
 * @see https://developers.google.com/identity/protocols/oauth2/openid-connect#obtainuserinfo
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
      // mark as the session's active poll for this tab (survives navigation between pages)
      setSessionEvent(id);
      window.location.href = `/event.html?id=${encodeURIComponent(id)}`;
    });
  }
}

// ============================================================================
// PAGE INITIALIZERS
// ============================================================================

/**
 * Initializes the event/availability page
 * 
 * This is the main initializer for the event page, which displays the
 * availability grid and allows users to:
 * - View aggregated availability from all participants
 * - Select their own available time slots (via click or drag)
 * - Save their availability to the backend
 * - Overlay their Google Calendar to see existing commitments
 * - Use range selection to quickly select multiple slots
 * 
 * The function sets up:
 * - Event data loading from the backend
 * - Grid rendering with heatmap visualization
 * - Interactive cell selection (click and drag)
 * - Calendar overlay integration
 * - Best slots display
 * - Form submission handlers
 * 
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
 */
function initEventPage() {
  const eventId = getQueryParam("id");
  if (!eventId) { alert("Missing event id in URL."); return; }

  // make this poll the session's active poll (cleared only when tab closes or user joins another)
  setSessionEvent(eventId);
  // also remember as last opened (persistent)
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
  const overlayBtn = $("#load-calendar-overlay") || $("#overlay-calendar");
  const overlayStatus = $("#calendar-overlay-status");

  const mySlotsKey = `hsync:${eventId}:mySlots`;
  const myNameKey = `hsync:${eventId}:myName`;

  let eventData = null;
  let cellsByIndex = new Map();
  let mySlots = new Set(JSON.parse(safeGet(mySlotsKey) || "[]").map(Number));
  let calendarBusy = new Set();
  // map slotIndex -> array of calendar event objects (used for hover tooltip)
  let calendarEventsBySlot = new Map();

  // Tooltip element (lazy-created)
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
    // ev: { summary, start, end, location, description }
    const start = ev.start ? new Date(ev.start).toLocaleString() : "";
    const end = ev.end ? new Date(ev.end).toLocaleString() : "";
    const time = start && end ? `${start} — ${end}` : start || end || "";
    const loc = ev.location ? `<div class="cal-ev-loc">${escapeHtml(ev.location)}</div>` : "";
    const desc = ev.description ? `<div class="cal-ev-desc">${escapeHtml(ev.description)}</div>` : "";
    return `<div class="cal-ev">
        <div class="cal-ev-title">${escapeHtml(ev.summary || "(no title)")}</div>
        <div class="cal-ev-time">${escapeHtml(time)}</div>
        ${loc}
        ${desc}
      </div>`;
  }

  /**
   * Escapes HTML special characters to prevent XSS attacks
   * 
   * This function converts potentially dangerous HTML characters into their
   * HTML entity equivalents, preventing malicious scripts from being executed
   * when user-generated content is inserted into the DOM.
   * 
   * @param {string} s - String to escape
   * @returns {string} Escaped string safe for HTML insertion
   * 
   * @example
   * escapeHtml("<script>alert('XSS')</script>")
   * // Returns: "&lt;script&gt;alert(&#39;XSS&#39;)&lt;/script&gt;"
   * 
   * @see https://owasp.org/www-community/attacks/xss/
   */
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({ 
      "&": "&amp;", 
      "<": "&lt;", 
      ">": "&gt;", 
      '"': "&quot;", 
      "'": "&#39;" 
    }[m]));
  }

  function showCalendarTooltipForSlot(idx, cell) {
    const events = calendarEventsBySlot.get(idx);
    if (!events || !events.length) return;
    const tip = createCalendarTooltip();
    tip.innerHTML = events.map(formatEventForTooltip).join("<hr/>");
    tip.style.display = "block";
    // position: prefer above cell, else below
    const rect = cell.getBoundingClientRect();
    const padding = 8;
    const maxW = Math.min(360, Math.max(180, rect.width * 2));
    tip.style.maxWidth = maxW + "px";
    // try above
    let top = rect.top - tip.offsetHeight - padding;
    if (top < 6) top = rect.bottom + padding; // fallback below
    // horizontal center
    let left = rect.left + (rect.width / 2) - (tip.offsetWidth / 2);
    // clamp
    left = Math.max(6, Math.min(left, window.innerWidth - tip.offsetWidth - 6));
    tip.style.top = `${top}px`;
    tip.style.left = `${left}px`;
  }

  function hideCalendarTooltip() {
    if (!_calendarTooltip) return;
    _calendarTooltip.style.display = "none";
  }

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
    // show calendar event details on hover if this slot has busy events
    cell.addEventListener("mouseenter", (ev) => {
      const idx = Number(cell.dataset.index);
      if (calendarEventsBySlot.has(idx)) {
        // small delay to avoid flicker while dragging
        cell._calendarHoverTimeout = setTimeout(() => showCalendarTooltipForSlot(idx, cell), 180);
      }
    });
    cell.addEventListener("mouseleave", () => {
      clearTimeout(cell._calendarHoverTimeout);
      hideCalendarTooltip();
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
        const mainDiv = document.createElement("div");
        mainDiv.className = "best-slot-main";
        const dateSpan = document.createElement("span");
        dateSpan.textContent = `${(new Date(eventData.dates[s.day] + "T00:00:00")).toLocaleDateString(undefined,{ weekday:"short", month:"numeric", day:"numeric" })} @ ${eventData.times[s.row]}`;
        const countSpan = document.createElement("span");
        countSpan.textContent = `${s.count} available`;
        mainDiv.appendChild(dateSpan);
        mainDiv.appendChild(countSpan);
        li.appendChild(mainDiv);
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

  /**
   * Builds an array of time ranges for each slot in the event
   * 
   * This function creates an array where each element represents a time slot
   * with its start and end timestamps. This is used to determine which calendar
   * events overlap with which availability slots.
   * 
   * The array is indexed by slot index (same as the grid cells), and each
   * element contains { start: timestamp, end: timestamp }.
   * 
   * @returns {Array<Object>} Array of { start: number, end: number } objects
   *                          indexed by slot index, or empty array if no event data
   */
  function buildSlotRanges() {
    if (!eventData) return [];
    const perDay = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const minutes = eventData.slotMinutes;
    const ranges = new Array(days * perDay);
    
    // Build time ranges for each slot
    for (let d = 0; d < days; d++) {
      for (let r = 0; r < perDay; r++) {
        // Calculate start time in minutes since midnight
        const startMin = eventData.startTimeMinutes + r * minutes;
        
        // Format as HH:MM for Date constructor
        const h = Math.floor(startMin / 60).toString().padStart(2, "0");
        const m = (startMin % 60).toString().padStart(2, "0");
        
        // Create Date object and get timestamp (milliseconds since epoch)
        const start = new Date(`${eventData.dates[d]}T${h}:${m}:00`).getTime();
        const end = start + minutes * 60000; // Add slot duration in milliseconds
        
        // Store in array at slot index (day * slotsPerDay + row)
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
      calendarEventsBySlot.clear();
      for (const ev of (data.items || [])) {
        const s = new Date(ev.start?.dateTime || (ev.start?.date + "T00:00:00")).getTime();
        const e = new Date(ev.end?.dateTime || (ev.end?.date + "T23:59:59")).getTime();
        ranges.forEach((r, idx) => {
          if (r && r.start < e && r.end > s) {
            calendarBusy.add(idx);
            const list = calendarEventsBySlot.get(idx) || [];
            list.push({
              summary: ev.summary || "",
              start: ev.start?.dateTime || ev.start?.date,
              end: ev.end?.dateTime || ev.end?.date,
              location: ev.location || "",
              description: ev.description || "",
              raw: ev,
            });
            calendarEventsBySlot.set(idx, list);
          }
        });
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
  loadEvent().then(() => {
    // Auto-apply calendar overlay if a valid session-scoped calendar token is cached.
    // This avoids prompting the user or requiring them to click the overlay button.
    try {
      const raw = sessionStorage.getItem(CAL_TOKEN_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        // only auto-apply when token still valid (1 minute safety margin)
        if (obj?.access_token && obj?.expires_at && Date.now() < obj.expires_at - 60000) {
          loadCalendarOverlayForCurrentEvent(overlayStatus);
        }
      }
    } catch (e) { /* non-fatal */ }
  });
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
      // prefer the session-scoped event for this tab, then fall back to persisted ids
      const sessionId = getSessionEvent();
      const last = sessionId || getLastOpenedEvent() || getLastJoinedEvent();
      if (last) window.location.href = `/event.html?id=${encodeURIComponent(last)}`;
      else window.location.href = "/join.html";
    });
  } catch (e) { console.warn("Could not wire Event topbar link:", e); }
});
