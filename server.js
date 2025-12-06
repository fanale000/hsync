// server.js
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const { OAuth2Client } = require("google-auth-library");
const cookieSession = require("cookie-session");

// TODO: replace with your real client ID from Google Cloud Console
const GOOGLE_CLIENT_ID =
  "889787397602-gku8r94alb2b10s9lm35e2s2irbdntoq.apps.googleusercontent.com";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
app.use(express.json());
app.use(
  cookieSession({
    name: "hsync_session",
    keys: ["a-very-secret-key-1", "a-very-secret-key-2"], // replace in real app
    maxAge: 7 * 24 * 60 * 60 * 1000, // 1 week
  })
);

app.use(express.static(path.join(__dirname, "public")));

// In-memory event store (for a real deployment, use a DB)
const events = {};

function generateId() {
  return crypto.randomBytes(4).toString("hex");
}

function parseTimeToMinutes(t) {
  // t = "HH:MM"
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatTime(minutes) {
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  const mm = m.toString().padStart(2, "0");
  return `${h}:${mm} ${ampm}`;
}
// aggregate[row][day] = number of people available
function computeAggregate(event) {
  const totalMinutes = event.endTimeMinutes - event.startTimeMinutes;
  const slotsPerDay = Math.floor(totalMinutes / event.slotMinutes);
  const days = event.dates.length;

  // Number of people available per slot
  const aggregate = Array.from({ length: slotsPerDay }, () =>
    Array(days).fill(0)
  );

  // Names per slot
  const who = Array.from({ length: slotsPerDay }, () =>
    Array.from({ length: days }, () => [])
  );

  let maxCount = 0;

  for (const p of Object.values(event.participants)) {
    for (const slotIndex of p.slots) {
      const idx = Number(slotIndex);
      if (!Number.isInteger(idx)) continue;

      const row = idx % slotsPerDay;
      const col = Math.floor(idx / slotsPerDay);

      if (row < 0 || row >= slotsPerDay || col < 0 || col >= days) continue;

      aggregate[row][col]++;
      who[row][col].push(p.name);

      if (aggregate[row][col] > maxCount) {
        maxCount = aggregate[row][col];
      }
    }
  }

  return { aggregate, who, maxCount, slotsPerDay };
}

// Create event
app.post("/api/events", (req, res) => {
  const { title, startDate, endDate, startTime, endTime, slotMinutes } =
    req.body || {};

  if (
    !title ||
    !startDate ||
    !endDate ||
    !startTime ||
    !endTime ||
    !slotMinutes
  ) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const dates = [];
  let current = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(current.getTime()) || isNaN(end.getTime()) || current > end) {
    return res.status(400).json({ error: "Invalid date range." });
  }

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10)); // YYYY-MM-DD
    current.setDate(current.getDate() + 1);
  }

  const startTimeMinutes = parseTimeToMinutes(startTime);
  const endTimeMinutes = parseTimeToMinutes(endTime);
  const span = endTimeMinutes - startTimeMinutes;

  const slotMins = Number(slotMinutes);
  if (!Number.isInteger(slotMins) || slotMins <= 0) {
    return res.status(400).json({ error: "Invalid slot length." });
  }

  const slotsPerDay = Math.floor(span / slotMins);
  if (slotsPerDay <= 0) {
    return res.status(400).json({ error: "Invalid time range." });
  }

  const id = generateId();

  events[id] = {
    id,
    title: title.trim(),
    dates,
    slotMinutes: slotMins,
    startTimeMinutes,
    endTimeMinutes,
    participants: {}, // key: normalizedName -> { name, slots: Set<number> }
  };

  console.log("Created event", id, events[id]);
  res.json({ id });
});

// Get event + aggregated availability
app.get("/api/events/:id", (req, res) => {
  const event = events[req.params.id];
  if (!event) {
    return res.status(404).json({ error: "Event not found." });
  }

  const { aggregate, who, maxCount, slotsPerDay } = computeAggregate(event);
  const times = [];

  for (let i = 0; i < slotsPerDay; i++) {
    const minutes = event.startTimeMinutes + i * event.slotMinutes;
    times.push(formatTime(minutes));
  }

  res.json({
    id: event.id,
    title: event.title,
    dates: event.dates,
    times,
    slotMinutes: event.slotMinutes,
    startTimeMinutes: event.startTimeMinutes,
    endTimeMinutes: event.endTimeMinutes,
    grid: {
      aggregate, // [row][day] -> count
      who, // [row][day] -> ["Name1", "Name2"]
      maxCount,
      slotsPerDay,
    },
    participants: Object.values(event.participants).map((p) => ({
      name: p.name,
    })),
  });
});

// Save / update a participant's availability
app.post("/api/events/:id/availability", (req, res) => {
  const event = events[req.params.id];
  if (!event) {
    return res.status(404).json({ error: "Event not found." });
  }

  const { participantName, slots } = req.body || {};
  if (!participantName || !Array.isArray(slots)) {
    return res.status(400).json({ error: "Invalid payload." });
  }

  const cleanedName = participantName.trim();
  if (!cleanedName) {
    return res.status(400).json({ error: "Name is required." });
  }

  const totalMinutes = event.endTimeMinutes - event.startTimeMinutes;
  const slotsPerDay = Math.floor(totalMinutes / event.slotMinutes);
  const days = event.dates.length;
  const maxIndex = slotsPerDay * days - 1;

  const clampedSlots = new Set();
  for (const s of slots) {
    const idx = Number(s);
    if (Number.isInteger(idx) && idx >= 0 && idx <= maxIndex) {
      clampedSlots.add(idx);
    }
  }

  const key = cleanedName.toLowerCase();
  event.participants[key] = {
    name: cleanedName,
    slots: clampedSlots,
  };

  console.log(`Updated availability for ${cleanedName} on event ${event.id}`);
  res.json({ ok: true });
});

async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  // payload has fields like: sub (user ID), name, email, picture
  return {
    googleId: payload.sub,
    name: payload.name,
    email: payload.email,
  };
}

// Simple in-memory user store (for demo)
const users = {}; // key: googleId -> { googleId, name, email }
// userId -> appearance settings
const themes = {}; // { [googleId]: { theme: "harvard", density: "comfortable" } }

app.post("/api/auth/google", async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return res.status(400).json({ error: "Missing idToken" });
    }

    const userInfo = await verifyGoogleToken(idToken);

    // store / update the user
    users[userInfo.googleId] = userInfo;

    // set session
    req.session.user = {
      googleId: userInfo.googleId,
      name: userInfo.name,
      email: userInfo.email,
    };

    res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// Get current logged-in user
app.get("/api/me", (req, res) => {
  if (!req.session.user) {
    return res.json({ user: null });
  }
  res.json({ user: req.session.user });
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// Default appearance if user has no saved theme
const defaultTheme = {
  theme: "harvard",
  density: "comfortable",
};

// Get appearance for current logged-in user
app.get("/api/theme", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const googleId = req.session.user.googleId;
  const prefs = themes[googleId] || defaultTheme;
  res.json(prefs);
});

// Save appearance for current logged-in user
app.post("/api/theme", (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const googleId = req.session.user.googleId;
  const { theme, density } = req.body || {};

  const allowedThemes = new Set(["harvard", "midnight", "forest"]);
  const allowedDensity = new Set(["comfortable", "compact"]);

  const safeTheme = allowedThemes.has(theme) ? theme : defaultTheme.theme;
  const safeDensity = allowedDensity.has(density)
    ? density
    : defaultTheme.density;

  themes[googleId] = {
    theme: safeTheme,
    density: safeDensity,
  };

  console.log(`Saved theme for ${googleId}:`, themes[googleId]);
  res.json({ ok: true, theme: themes[googleId] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`HSync server listening at http://localhost:${PORT}`);
});
