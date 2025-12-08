/**
 * Frontend
 *   Code formatted using the Prettier extension
 *   Documentation: https://www.w3schools.com/html/
 *   Referenced ChatGPT: https://www.chatgpt.com, CoPilot, Cursor for form implementation guidance
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
 * @module main
 */

/**
 * Google OAuth 2.0 Client ID
 * 
 * This is the client ID obtained from Google Cloud Console when setting up OAuth credentials.
 * It's used for both Google Sign-In and calendar access
 * 
 * @see https://console.cloud.google.com/apis/credentials
 * @see https://developers.google.com/identity/protocols/oauth2
 * Client ID is unique and obtained from Cloud Console
 */
const GOOGLE_CLIENT_ID = "19747295970-tp902n56girks9e8kegdl1vlod13l3ti.apps.googleusercontent.com";

// ============================================================================
// DOM UTILITY FUNCTIONS
// ============================================================================

/**
 * Generated with ChatGPT to help with setup
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
 * Returns an array of all matching elements
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

// ============================================================================
// WEB STORAGE HELPERS
// ============================================================================

/**
 * BLOCK: Safe localStorage Wrappers
 * 
 * These functions wrap localStorage operations with try-catch to handle errors gracefully.
 * localStorage can throw errors in certain scenarios:
 * - Quota exceeded (storage limit reached, typically 5-10MB)
 * - Private browsing mode (some browsers disable localStorage)
 * - Security restrictions
 * 
 * By catching errors, the app continues to function even if storage fails.
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Storage/setItem
 */
function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeRemove(key) { try { localStorage.removeItem(key); } catch (e) {} }

/**
 * BLOCK: Persistent Event ID Storage (localStorage)
 * 
 * These functions store/retrieve the last opened/joined event ID in localStorage.
 * localStorage persists across browser sessions, so users can return to their
 * last event even after closing the browser.
 * 
 * Use Cases:
 * - Last opened event: Event the user was viewing
 * - Last joined event: Event the user most recently joined
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
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
 * BLOCK: Session-Scoped Event Storage (sessionStorage)
 * 
 * These functions store/retrieve the current session's active event ID.
 * sessionStorage persists only for the current browser tab/window and is cleared
 * when the tab is closed. This is used to track the "current" event for navigation.
 * 
 * Key difference from localStorage:
 * - localStorage: Persists across browser sessions (survives browser restart)
 * - sessionStorage: Cleared when tab/window closes (session-scoped)
 * 
 * Use Case:
 * - Tracks which event is "active" in the current tab
 * - Used by topbar "Event" link to navigate to current event
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
 */
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

// ============================================================================
// TOPBAR / PROFILE UI HELPERS
// ============================================================================

/**
 * BLOCK: Update Topbar Profile Display
 * 
 * This function updates the topbar to show the user's profile picture and name
 * after they sign in with Google. It also manages the visibility of the
 * Google Sign-In button (hides it when user is signed in).
 * 
 * Behavior:
 * - Shows profile picture if provided, hides it if null
 * - Hides Google Sign-In button when user is signed in
 * - Persists profile data to localStorage for reuse across page navigations
 * 
 * @param {string|null} pictureUrl - User's profile picture URL from Google
 * @param {string|null} name - User's display name from Google
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/style
 */
function setTopbarProfile(pictureUrl, name) {
  const pic = $("#topbar-profile-pic");
  const container = $("#gsi-topbar");
  
  // Update profile picture visibility and source
  if (pic) {
    if (pictureUrl) { 
      pic.src = pictureUrl; 
      pic.style.display = "inline-block"; 
    } else { 
      pic.src = ""; 
      pic.style.display = "none"; 
    }
  }
  
  // Hide Google Sign-In button when user is signed in
  if (container) container.style.display = pictureUrl ? "none" : "inline-flex";
  
  // Persist to localStorage for reuse across pages
  if (pictureUrl) safeSet("hsync:profilePic", pictureUrl); 
  else safeRemove("hsync:profilePic");
  
  if (name) safeSet("hsync:profileName", name); 
  else safeRemove("hsync:profileName");
}

/**
 * BLOCK: Initialize Google Sign-In Button
 * 
 * This function initializes and renders the Google Sign-In button in the topbar.
 * It uses the Google Identity Services (GSI) API to create a small icon button.
 * 
 * Process:
 * 1. Check if Google API is loaded (window.google.accounts.id)
 * 2. Initialize GSI with client ID and callback function
 * 3. Render the button in the specified container element
 * 
 * Button Configuration:
 * - type: "icon" - Small icon-only button (fits in topbar)
 * - theme: "outline" - Outlined style
 * - size: "small" - Compact size for topbar
 * - shape: "circle" - Circular button
 * - logo_alignment: "left" - Google logo on left side
 * 
 * Documentation: https://developers.google.com/identity/gsi/web/guides/display-button
 */
function initTopbarGsi() {
  const el = $("#gsi-topbar");
  // Check if Google API is loaded before attempting to use it
  if (!el || !window.google || !google.accounts || !google.accounts.id) return;
  
  try {
    // Initialize Google Identity Services
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: window.handleGoogleCredentialResponse, // Callback function for when user signs in
      auto_select: false, // Don't auto-select if only one Google account
    });
    
    // Render the button in the topbar container
    google.accounts.id.renderButton(el, { 
      type: "icon", 
      theme: "outline", 
      size: "small", 
      shape: "circle", 
      logo_alignment: "left" 
    });
  } catch (e) {
    // Non-fatal error - button just won't appear if this fails
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

// ============================================================================
// SIGN-OUT FUNCTIONALITY
// ============================================================================

/**
 * BLOCK: Sign Out All Google Services
 * 
 * This function performs a complete sign-out from Google services:
 * 1. Disables Google's auto-select feature
 * 2. Sends logout request to backend (clears server session)
 * 3. Clears all locally stored profile data from localStorage
 * 4. Updates UI to hide profile and show sign-in button
 * 5. Reloads page to clear any in-memory JavaScript state
 * 
 * All operations are wrapped in try-catch to ensure the function completes
 * even if some steps fail (best-effort approach).
 * 
 * Documentation: https://developers.google.com/identity/gsi/web/guides/revoke
 */
async function signOutAllGoogle() {
  // Disable Google's auto-select feature
  try { 
    if (window.google && google.accounts && google.accounts.id && google.accounts.id.disableAutoSelect) {
      google.accounts.id.disableAutoSelect(); 
    }
  } catch (e) {}
  
  // Clear server-side session
  try { 
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {}); 
  } catch (e) {}
  
  // Clear all locally stored profile data
  safeRemove("hsync:profilePic"); 
  safeRemove("hsync:profileName");
  safeRemove("hsync:lastOpenedEvent"); 
  safeRemove("hsync:lastJoinedEvent");
  
  // Update UI to show sign-in button and hide profile
  setTopbarProfile(null, null);
  
  // Reload page to clear any in-memory state
  // Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Location/reload
  window.location.reload();
}

// ============================================================================
// PAGE INITIALIZATION HELPERS
// ============================================================================

/**
 * BLOCK: Load Current User and Theme Preferences
 * 
 * This function loads the authenticated user's information and theme preferences
 * from the backend and applies them to the page.
 * 
 * Process:
 * 1. Fetch current user from /api/me endpoint
 * 2. Fetch theme preferences from /api/theme endpoint
 * 3. Apply theme by setting data-theme attribute on <html> element
 * 4. Apply density by setting data-density attribute on <html> element
 * 5. Return user and theme data for use by page initializers
 * 
 * Theme Application:
 * - Sets data-theme attribute which CSS uses with attribute selectors
 * - Example: <html data-theme="harvard"> triggers :root[data-theme="harvard"] styles
 * 
 * Error Handling:
 * - All fetch errors are caught and default values are used
 * - Ensures page always has valid theme/density settings
 * 
 * @returns {Promise<Object>} Object with user and themePrefs properties
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/dataset
 */
async function loadCurrentUserAndTheme() {
  try {
    // Fetch user info (may return null if not signed in)
    const me = await fetchJson("/api/me").catch(() => ({ user: null }));
    
    // Fetch theme preferences (may return null if not signed in or no preferences)
    const themePrefs = await fetchJson("/api/theme").catch(() => null);
    
    // Apply theme preferences to document root
    if (themePrefs) {
      if (themePrefs.theme) {
        // Set data-theme attribute which CSS uses for theme switching
        document.documentElement.dataset.theme = themePrefs.theme;
      }
      if (themePrefs.density) {
        // Set data-density attribute which CSS uses for grid density
        document.documentElement.dataset.density = themePrefs.density;
      }
    }
    
    return { 
      user: (me && me.user) || null, 
      themePrefs: themePrefs || null 
    };
  } catch (err) {
    // Ensure defaults are set even on error
    document.documentElement.dataset.theme = document.documentElement.dataset.theme || "harvard";
    document.documentElement.dataset.density = document.documentElement.dataset.density || "comfortable";
    return { user: null, themePrefs: null };
  }
}

/**
 * BLOCK: Home Page Initialization
 * 
 * This function sets up the home page functionality:
 * - Event creation form submission handler
 * - Logout button click handler
 * 
 * Event Creation Flow:
 * 1. User fills out form (title, dates, times, slot length)
 * 2. Form submission is intercepted (preventDefault)
 * 3. Form data is validated
 * 4. POST request sent to /api/events
 * 5. On success, redirect to event page with new event ID
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/submit_event
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault
 */
function initHomePage() {
  const form = $("#create-event-form");
  if (!form) return;
  
  /**
   * Form Submit Handler
   * 
   * Handles the event creation form submission:
   * - Prevents default form submission (page reload)
   * - Extracts and validates form values
   * - Sends POST request to create event
   * - Redirects to event page on success
   */
  form.addEventListener("submit", async (ev) => {
    // Prevent default form submission (which would reload the page)
    ev.preventDefault();
    
    // Extract form values
    const title = ($("#title")?.value || "").trim();
    const startDate = $("#start-date")?.value;
    const endDate = $("#end-date")?.value;
    const startTime = $("#start-time")?.value;
    const endTime = $("#end-time")?.value;
    const slotMinutes = Number($("#slot-minutes")?.value || 30);
    
    // Validate required fields
    if (!title || !startDate || !endDate || !startTime || !endTime) {
      alert("Please fill out all fields.");
      return;
    }
    
    try {
      // Create event via API
      const data = await fetchJson("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, startDate, endDate, startTime, endTime, slotMinutes }),
      });
      
      // Redirect to event page with new event ID
      // encodeURIComponent ensures special characters in ID are URL-safe
      // Documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
      window.location.href = `/event.html?id=${encodeURIComponent(data.id)}`;
    } catch (err) {
      console.error(err);
      alert(err.message || "Error creating event.");
    }
  });

  // Optional logout button handler (if button exists on home page)
  const logoutBtn = $("#logout-all-google");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // Confirm before signing out
      if (confirm("Sign out of Google and clear saved profile info?")) {
        signOutAllGoogle();
      }
    });
  }
}

/**
 * BLOCK: Join Page Initialization
 * 
 * This function sets up the join page functionality:
 * - Pre-fills input with event ID from URL query parameter (if present)
 * - Restores last joined event ID from localStorage
 * - Handles "Open poll" button click to extract event ID and navigate
 * 
 * Event ID Extraction Logic:
 * The function is flexible and accepts:
 * - Full HSync URLs: https://example.com/event.html?id=abc123
 * - Partial URLs: /event.html?id=abc123
 * - Plain event IDs: abc123
 * 
 * It tries to parse as URL first, then falls back to treating as plain ID.
 * 
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/URL
 * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
 */
function initJoinPage() {
  const input = $("#join-event-input");
  const openBtn = $("#join-open-button");
  const msg = $("#join-saved-msg");
  const queryId = getQueryParam("id");

  /**
   * Helper function to save event ID and show confirmation message
   */
  function saveAndReport(id) {
    try { 
      setLastJoinedEvent(id); 
    } catch (e) {}
    if (msg) {
      msg.textContent = `Saved poll ${id}. Click "Open poll" to go to it.`;
    }
  }

  // If event ID is in URL query parameter, pre-fill and save it
  if (queryId) {
    if (input) input.value = queryId;
    saveAndReport(queryId);
  } else {
    // Otherwise, restore last joined event from localStorage
    const last = getLastJoinedEvent();
    if (last && input) input.value = last;
    if (last && msg) msg.textContent = `Last saved poll: ${last}`;
  }

  /**
   * Open Poll Button Click Handler
   * 
   * Extracts event ID from input (handles URLs or plain IDs) and navigates to event page.
   */
  if (openBtn) {
    openBtn.addEventListener("click", () => {
      const raw = (input?.value || "").trim();
      if (!raw) return;
      
      // Try to extract ID from URL or accept raw id
      let id = raw;
      try {
        // Attempt to parse as URL
        const maybeUrl = new URL(raw);
        // First try: get ID from query parameter
        const match = maybeUrl.searchParams.get("id");
        if (match) {
          id = match;
        } else {
          // Second try: extract from pathname (e.g., /event.html or /abc123)
          const parts = maybeUrl.pathname.split("/");
          id = parts[parts.length - 1] || parts[parts.length - 2] || "";
          // If pathname ends with "event.html", try query param again
          if (id === "event.html") {
            id = maybeUrl.searchParams.get("id") || "";
          }
        }
      } catch {
        // If URL parsing fails, treat as plain event ID
        /* plain id allowed */
      }
      
      if (!id) {
        alert("Could not find an event id in that link.");
        return;
      }
      
      // Save ID and navigate to event page
      saveAndReport(id);
      // Mark as session's active poll (for navigation)
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

  // ========================================================================
  // POINTER EVENT HANDLING FOR DRAG-TO-SELECT
  // ========================================================================
  /**
   * BLOCK: Drag State Management
   * 
   * These variables track the state of pointer drag operations:
   * - isDown: Whether pointer is currently pressed down
   * - dragMode: "add" or "remove" - determines if dragging adds or removes slots
   * 
   * Global pointerup listener ensures drag state is cleared when user releases
   * pointer anywhere on the page (not just over grid cells).
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerup_event
   */
  let isDown = false;
  let dragMode = null;
  // Global listener to clear drag state when pointer is released anywhere
  window.addEventListener("pointerup", () => { 
    isDown = false; 
    dragMode = null; 
  });

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

  /**
   * BLOCK: Attach Event Listeners to Grid Cell
   * 
   * This function attaches all necessary event listeners to a grid cell:
   * - pointerdown: Start drag operation (click or touch start)
   * - pointerenter: Continue drag operation (while dragging over cells)
   * - mouseenter: Show calendar tooltip on hover (if cell has calendar events)
   * - mouseleave: Hide calendar tooltip when mouse leaves
   * 
   * Drag-to-Select Logic:
   * - On pointerdown: Determine if we're adding or removing based on current state
   * - On pointerenter: Continue adding/removing while dragging
   * - Works for both mouse and touch interactions
   * 
   * Tooltip Logic:
   * - Small delay (180ms) prevents tooltip from flickering while dragging
   * - Only shows if cell has calendar events associated with it
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerdown_event
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerenter_event
   */
  function attachCellListeners(cell) {
    /**
     * Pointer Down Handler - Start drag operation
     * 
     * When user clicks/touches a cell:
     * - Determine if cell is already selected
     * - Set drag mode: "add" if unselected, "remove" if selected
     * - Toggle the cell immediately
     */
    cell.addEventListener("pointerdown", (e) => {
      e.preventDefault(); // Prevent text selection or other default behaviors
      const idx = Number(cell.dataset.index);
      const isSelected = mySlots.has(idx);
      isDown = true; // Mark that drag operation has started
      dragMode = isSelected ? "remove" : "add"; // Determine drag direction
      toggleSlot(idx, dragMode === "add"); // Toggle immediately on click
    });
    
    /**
     * Pointer Enter Handler - Continue drag operation
     * 
     * While dragging, when pointer enters a cell:
     * - Only works if drag is active (isDown && dragMode set)
     * - Toggles cells as user drags over them
     */
    cell.addEventListener("pointerenter", () => {
      if (!isDown || !dragMode) return; // Only work during active drag
      toggleSlot(Number(cell.dataset.index), dragMode === "add");
    });
    
    /**
     * Mouse Enter Handler - Show calendar tooltip
     * 
     * When mouse hovers over a cell with calendar events:
     * - Wait 180ms before showing tooltip (prevents flicker while dragging)
     * - Shows details of calendar events that conflict with this time slot
     */
    cell.addEventListener("mouseenter", (ev) => {
      const idx = Number(cell.dataset.index);
      if (calendarEventsBySlot.has(idx)) {
        // Small delay to avoid flicker while dragging
        cell._calendarHoverTimeout = setTimeout(() => {
          showCalendarTooltipForSlot(idx, cell);
        }, 180);
      }
    });
    
    /**
     * Mouse Leave Handler - Hide calendar tooltip
     * 
     * Clears the timeout and hides tooltip when mouse leaves cell.
     */
    cell.addEventListener("mouseleave", () => {
      clearTimeout(cell._calendarHoverTimeout);
      hideCalendarTooltip();
    });
  }

  /**
   * BLOCK: Toggle Slot Selection State
   * 
   * This function adds or removes a slot from the user's selection:
   * - Updates the Set data structure (mySlots)
   * - Updates the DOM (adds/removes CSS class)
   * - Persists to localStorage for restoration on page reload
   * 
   * Data Structures:
   * - mySlots: Set<number> - Fast lookup for selected slot indices
   * - cellsByIndex: Map<number, HTMLElement> - Fast lookup for DOM elements
   * 
   * Persistence:
   * - Saves to localStorage with key specific to this event
   * - Converted to JSON array for storage (Sets can't be directly stored)
   * 
   * @param {number} idx - Slot index to toggle
   * @param {boolean} select - true to select, false to deselect
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Set
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map
   */
  function toggleSlot(idx, select) {
    // Validate slot index is an integer
    if (!Number.isInteger(idx)) return;
    
    // Get DOM element for this slot index
    const cell = cellsByIndex.get(idx);
    if (!cell) return;
    
    // Update data structure and DOM
    if (select) {
      mySlots.add(idx); // Add to Set
      cell.classList.add("my-slot"); // Add CSS class for styling
    } else {
      mySlots.delete(idx); // Remove from Set
      cell.classList.remove("my-slot"); // Remove CSS class
    }
    
    // Persist to localStorage
    // Convert Set to Array for JSON serialization
    safeSet(mySlotsKey, JSON.stringify(Array.from(mySlots)));
  }

  /**
   * BLOCK: Render Availability Grid
   * 
   * This function dynamically generates the interactive availability grid:
   * - Creates header row with day labels
   * - Creates time rows with time labels and availability cells
   * - Applies heatmap colors based on participant count
   * - Marks user's selected slots
   * - Attaches event listeners for interaction
   * 
   * Grid Structure:
   * - Uses CSS Grid layout (gridTemplateColumns)
   * - First column: time labels (fixed width)
   * - Remaining columns: one per day (flexible width)
   * 
   * Slot Indexing System:
   * - Slots are numbered sequentially: 0, 1, 2, ...
   * - Formula: slotIndex = (dayIndex * slotsPerDay) + rowIndex
   * - Example: Day 0, Row 5 = slot 5; Day 1, Row 5 = slot (1*slotsPerDay + 5)
   * 
   * Heatmap Calculation:
   * - level = Math.ceil((count / maxCount) * 4)
   * - Creates 5 heat levels (0-4) based on relative availability
   * - Level 0: no one available (gray)
   * - Level 4: most people available (dark red)
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Grid_Layout
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/Document/createElement
   */
  function renderGrid() {
    if (!gridEl || !eventData) return;
    
    // Clear existing grid
    gridEl.innerHTML = "";
    cellsByIndex = new Map(); // Reset cell index map
    
    // Extract grid dimensions and data
    const days = eventData.dates.length;
    const rows = eventData.grid.slotsPerDay;
    const maxCount = eventData.grid.maxCount || 0;
    const aggregate = eventData.grid.aggregate || [];

    /**
     * CSS Grid Template Columns
     * 
     * Defines the column structure:
     * - First column: minmax(60px, 80px) - Time column (fixed width range)
     * - Remaining columns: repeat(days, minmax(56px, 1fr)) - Day columns (flexible)
     * 
     * minmax() ensures minimum width while allowing growth
     * 1fr means "take remaining space proportionally"
     */
    const templateCols = `minmax(60px,80px) repeat(${days}, minmax(56px,1fr))`;

    // ========================================================================
    // HEADER ROW - Day Labels
    // ========================================================================
    const header = document.createElement("div");
    header.className = "grid-header-row";
    header.style.gridTemplateColumns = templateCols;
    
    // Empty cell for time column header
    header.appendChild(Object.assign(document.createElement("div"), { 
      className: "grid-time-cell" 
    }));
    
    // Create day header cells
    eventData.dates.forEach((d) => {
      const h = document.createElement("div");
      h.className = "grid-day-header";
      // Format date: "Mon, 1/15" (weekday, month/day)
      h.textContent = (new Date(d + "T00:00:00")).toLocaleDateString(undefined, { 
        weekday: "short", 
        month: "numeric", 
        day: "numeric" 
      });
      header.appendChild(h);
    });
    gridEl.appendChild(header);

    // ========================================================================
    // TIME ROWS - Time Labels and Availability Cells
    // ========================================================================
    for (let r = 0; r < rows; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "grid-row";
      rowEl.style.gridTemplateColumns = templateCols;
      
      // Time label cell (leftmost column)
      const timeCell = document.createElement("div");
      timeCell.className = "grid-time-cell";
      timeCell.textContent = eventData.times[r] || "";
      rowEl.appendChild(timeCell);

      // Availability cells (one per day)
      for (let d = 0; d < days; d++) {
        // Calculate slot index: (day * slotsPerDay) + row
        const idx = d * rows + r;
        
        // Create cell element
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.dataset.index = String(idx); // Store index for event handlers
        
        // Get participant count for this slot
        const count = (aggregate[r] && aggregate[r][d]) || 0;
        
        // Calculate heatmap level (0-4)
        // Formula: (count / maxCount) * 4, rounded up
        // This creates 5 levels of "heat" based on availability
        const level = maxCount === 0 ? 0 : Math.ceil((count / maxCount) * 4);
        cell.classList.add(`heat-${level}`);
        
        // Mark user's selected slots
        if (mySlots.has(idx)) {
          cell.classList.add("my-slot");
        }
        
        // Attach event listeners for interaction
        attachCellListeners(cell);
        
        // Store in map for quick lookup
        cellsByIndex.set(idx, cell);
        rowEl.appendChild(cell);
      }
      gridEl.appendChild(rowEl);
    }
  }

  /**
   * BLOCK: Render Best Time Slots List
   * 
   * This function displays the top 5 time slots with the most participants available.
   * 
   * Process:
   * 1. Collect all slots with at least 1 participant
   * 2. Sort by participant count (descending)
   * 3. Take top 5 slots
   * 4. Render each with date, time, count, and participant names dropdown
   * 
   * Data Structure:
   * - aggregate[row][day] = count of available people
   * - who[row][day] = array of participant names
   * 
   * Rendering:
   * - Each slot shows: date @ time, participant count
   * - Dropdown menu lists all participants for that slot
   * - Uses textContent (not innerHTML) for XSS safety
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort
   */
  function renderBestSlots() {
    if (!bestSlots || !eventData) return;
    
    // Clear existing list
    bestSlots.innerHTML = "";
    
    // Extract grid data
    const agg = eventData.grid.aggregate || [];
    const who = eventData.grid.who || [];
    const rows = eventData.grid.slotsPerDay;
    const days = eventData.dates.length;
    const participants = eventData.participants || [];

    /**
     * Collect all slots with availability
     * 
     * Iterates through all day/row combinations and collects
     * slots that have at least 1 participant available.
     */
    const items = [];
    for (let d = 0; d < days; d++) {
      for (let r = 0; r < rows; r++) {
        const cnt = (agg[r] && agg[r][d]) || 0;
        if (cnt <= 0) continue; // Skip empty slots
        items.push({ 
          day: d, 
          row: r, 
          count: cnt, 
          names: (who[r] && who[r][d]) || [] 
        });
      }
    }
    
    /**
     * Sort by participant count (highest first)
     * 
     * Sort function: (a, b) => b.count - a.count
     * Returns negative if a < b, positive if a > b, 0 if equal
     * This sorts in descending order (highest count first)
     */
    items.sort((a, b) => b.count - a.count);
    
    // Render results
    if (items.length === 0) {
      // No availability yet
      const li = document.createElement("li");
      li.textContent = "No availability submitted yet.";
      bestSlots.appendChild(li);
    } else {
      // Render top 5 slots
      items.slice(0, 5).forEach((s) => {
        const li = document.createElement("li");
        
        // Main info: date @ time and count
        const mainDiv = document.createElement("div");
        mainDiv.className = "best-slot-main";
        
        const dateSpan = document.createElement("span");
        dateSpan.textContent = `${(new Date(eventData.dates[s.day] + "T00:00:00")).toLocaleDateString(undefined,{ 
          weekday:"short", 
          month:"numeric", 
          day:"numeric" 
        })} @ ${eventData.times[s.row]}`;
        
        const countSpan = document.createElement("span");
        countSpan.textContent = `${s.count} available`;
        
        mainDiv.appendChild(dateSpan);
        mainDiv.appendChild(countSpan);
        li.appendChild(mainDiv);
        
        // Participants list
        const p = document.createElement("div");
        p.className = "best-slot-participants";
        
        if (!s.names.length) {
          p.textContent = "No one has picked this time yet.";
        } else {
          // Label
          const label = document.createElement("span");
          label.textContent = "Participants:";
          p.appendChild(label);
          
          // Dropdown with participant names
          const sel = document.createElement("select");
          sel.className = "participant-dropdown";
          
          // Default option showing count
          const opt = document.createElement("option");
          opt.disabled = true;
          opt.selected = true;
          opt.textContent = `${s.names.length} participant${s.names.length > 1 ? "s" : ""}`;
          sel.appendChild(opt);
          
          // Individual participant options
          s.names.forEach(n => {
            const o = document.createElement("option");
            o.value = n;
            o.textContent = n; // Uses textContent for XSS safety
            sel.appendChild(o);
          });
          
          p.appendChild(sel);
        }
        li.appendChild(p);
        bestSlots.appendChild(li);
      });
    }
    
    // Update participant count display
    if (participantCountEl) {
      const count = (eventData.participants || []).length;
      participantCountEl.textContent = `${count} participant${count === 1 ? "" : "s"} have responded.`;
    }
  }

  /**
   * BLOCK: Save Availability to Backend
   * 
   * This function saves the user's selected time slots to the server:
   * 1. Validates that a name is entered
   * 2. Sends POST request with name and selected slot indices
   * 3. Saves name to localStorage for future use
   * 4. Reloads event data to show updated aggregates
   * 
   * Data Sent:
   * - participantName: User's name (validated on server)
   * - slots: Array of slot indices (converted from Set)
   * 
   * After Save:
   * - Name is saved to localStorage
   * - Event data is reloaded to show updated heatmap
   * - User sees confirmation message
   * 
   * Documentation: https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus
   */
  async function saveAvailability() {
    if (!eventData) return;
    
    // Get and validate name
    const name = (participantName?.value || "").trim();
    if (!name) {
      alert("Please enter your name before saving.");
      participantName?.focus(); // Focus input for user convenience
      return;
    }
    
    try {
      // Send availability to backend
      await fetchJson(`/api/events/${encodeURIComponent(eventId)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Convert Set to Array for JSON serialization
        body: JSON.stringify({ 
          participantName: name, 
          slots: Array.from(mySlots) 
        }),
      });
      
      // Save name to localStorage for future use
      safeSet(myNameKey, name);
      
      alert("Availability saved!");
      
      // Reload event to show updated aggregates
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

  // ========================================================================
  // UI EVENT HANDLERS
  // ========================================================================
  /**
   * BLOCK: Wire Up UI Event Handlers
   * 
   * Attaches click handlers to all interactive buttons on the event page.
   */
  
  // Save button: Save selected slots to backend
  saveBtn && saveBtn.addEventListener("click", saveAvailability);
  
  // Clear button: Clear local selection (doesn't affect server)
  clearBtn && clearBtn.addEventListener("click", clearMyAvailability);
  
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
  rangeApply && rangeApply.addEventListener("click", (ev) => {
    ev.preventDefault();
    
    // Get form values
    const dayIndex = Number(rangeDay?.value || 0);
    const from = rangeFrom?.value;
    const to = rangeTo?.value;
    
    // Validate inputs
    if (!from || !to) {
      alert("Please fill both From and To times.");
      return;
    }
    
    // Parse time strings (HH:MM format)
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm] = to.split(":").map(Number);
    
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
    const clamp = (mins) => Math.max(0, Math.min(rows - 1, Math.floor((mins - start) / step)));
    
    const sRow = clamp(fromMinutes); // Start row
    const eRow = clamp(toMinutes - 1); // End row (subtract 1 to include end time's slot)
    
    // Select all slots in range for the selected day
    // Slot index formula: (dayIndex * rows) + rowIndex
    for (let r = sRow; r <= eRow; r++) {
      toggleSlot(dayIndex * rows + r, true);
    }
  });

  if (overlayBtn) overlayBtn.addEventListener("click", () => loadCalendarOverlayForCurrentEvent(overlayStatus));
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
        if (obj?.access_token && obj?.expires_at && Date.now() < obj.expires_at - 60000) {
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
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    // Get selected radio button values
    // querySelector with :checked pseudo-class gets the selected option
    // Documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/:checked
    const theme = form.querySelector('input[name="theme"]:checked')?.value;
    const density = form.querySelector('input[name="density"]:checked')?.value;
    
    try {
      // Save preferences to backend
      const data = await fetchJson("/api/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, density }),
      });
      
      // Apply theme immediately (no page reload needed)
      if (data?.theme) {
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
document.addEventListener("DOMContentLoaded", () => {
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
    loadCurrentUserAndTheme().then(initHomePage);
  }
  if (document.body.classList.contains("page-join")) {
    loadCurrentUserAndTheme().then(initJoinPage);
  }
  if (document.body.classList.contains("page-event")) {
    loadCurrentUserAndTheme().then(initEventPage);
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
      eventLink.addEventListener("click", (ev) => {
        // Allow default behavior for modifier keys (new tab, etc.)
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) {
          return;
        }
        
        ev.preventDefault();
        
        // Prefer session-scoped event for this tab, then fall back to persisted IDs
        const sessionId = getSessionEvent();
        const last = sessionId || getLastOpenedEvent() || getLastJoinedEvent();
        
        if (last) {
          window.location.href = `/event.html?id=${encodeURIComponent(last)}`;
        } else {
          window.location.href = "/join.html";
        }
      });
    }
  } catch (e) {
    console.warn("Could not wire Event topbar link:", e);
  }
});
