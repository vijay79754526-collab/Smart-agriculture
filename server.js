const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config({
  path: path.join(__dirname, ".env")
});

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "smart-agri-secret";
const PASSWORD_RESET_CODE_SECRET = crypto
  .createHmac("sha256", JWT_SECRET)
  .update("smart-agriculture-password-reset")
  .digest();

// Folders and database
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "uploads"));
const DB_FILE = path.join(DATA_DIR, "db.json");
const PASSWORD_RESET_CHALLENGES_FILE = path.join(DATA_DIR, "password-reset-challenges.json");
const users = [];
const passwordResetChallenges = new Map();
const passwordResetCooldowns = new Map();
const passwordResetIpAttempts = new Map();

// Create folders if missing
for (const folder of [DATA_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

function persistPasswordResetChallenges() {
  const temporaryFile = `${PASSWORD_RESET_CHALLENGES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporaryFile,
    JSON.stringify([...passwordResetChallenges.entries()]),
    { mode: 0o600 }
  );
  fs.renameSync(temporaryFile, PASSWORD_RESET_CHALLENGES_FILE);
}

if (fs.existsSync(PASSWORD_RESET_CHALLENGES_FILE)) {
  const savedChallenges = JSON.parse(fs.readFileSync(PASSWORD_RESET_CHALLENGES_FILE, "utf8"));
  if (!Array.isArray(savedChallenges)) {
    throw new Error("Password reset challenge store has an invalid format.");
  }
  for (const [challengeId, challenge] of savedChallenges) {
    if (/^[a-f0-9]{48}$/.test(challengeId) &&
        challenge && Number.isFinite(challenge.expiresAt) &&
        challenge.expiresAt > Date.now() &&
        ["email-link", "sms-code"].includes(challenge.method)) {
      passwordResetChallenges.set(challengeId, challenge);
    }
  }
  persistPasswordResetChallenges();
}

// Create JSON database if missing
const DEFAULT_DB = {
  users: [],
  crops: [],
  expenses: [],
  readings: [],
  healthScans: [],
  soilTests: [],
  weatherRecords: [],
  activities: [],
  feedbacks: [],
  marketPrices: [],
  searchHistory: []
};

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR, { index: false }));

// Image upload setup
const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, UPLOAD_DIR);
  },
  filename: (req, file, callback) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    callback(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
    } else {
      callback(new Error("Please upload an image file."));
    }
  }
});

// Read and save JSON database
function readDB() {
  const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  const normalized = { ...DEFAULT_DB, ...data };

  Object.keys(DEFAULT_DB).forEach(key => {
    if (!Array.isArray(normalized[key])) {
      normalized[key] = [];
    }
  });

  return normalized;
}

function saveDB(data) {
  const normalized = { ...DEFAULT_DB, ...data };

  Object.keys(DEFAULT_DB).forEach(key => {
    if (!Array.isArray(normalized[key])) {
      normalized[key] = [];
    }
  });

  fs.writeFileSync(DB_FILE, JSON.stringify(normalized, null, 2));
}

function findUserById(id) {
  const storedUser = readDB().users.find(user => String(user.id) === String(id));
  return storedUser || users.find(user => String(user.id) === String(id));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    mobileNumber: user.mobileNumber || ""
  };
}

function normalizeMobileNumber(value) {
  const input = String(value || "").trim();
  if (!/^\+?[\d\s()-]+$/.test(input)) return "";
  const digits = input.replace(/\D/g, "");
  const nationalNumber = digits.length === 10
    ? digits
    : digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : "";
  return /^[6-9]\d{9}$/.test(nationalNumber) ? `+91${nationalNumber}` : "";
}

function isValidMobileNumber(value) {
  return /^\+91[6-9]\d{9}$/.test(value);
}

function passwordResetCodeHash(challengeId, code) {
  return crypto
    .createHmac("sha256", PASSWORD_RESET_CODE_SECRET)
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

function passwordResetTokenHash(resetId, token) {
  return crypto
    .createHmac("sha256", PASSWORD_RESET_CODE_SECRET)
    .update(`${resetId}:${token}`)
    .digest("hex");
}

function isEmailConfigured() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const password = String(process.env.SMTP_PASSWORD || "").trim();
  const from = String(process.env.SMTP_FROM || "").trim();
  const isPlaceholder = value => /^(your[-_ ]|replace[-_ ]|changeme|example|<)/i.test(value);
  return Boolean(host && user && password && from &&
    ![host, user, password, from].some(isPlaceholder));
}

function createSmtpTransporter() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
}

function isTwilioConfigured() {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const fromNumber = String(process.env.TWILIO_FROM_NUMBER || "").trim();
  const isPlaceholder = value => /^(your[-_ ]|replace[-_ ]|changeme|example|<)/i.test(value);
  return /^AC[0-9a-f]{32}$/i.test(accountSid) &&
    authToken.length > 0 &&
    /^\+[1-9]\d{7,14}$/.test(fromNumber) &&
    ![accountSid, authToken, fromNumber].some(isPlaceholder);
}

async function sendRegistrationEmail(user) {
  if (!isEmailConfigured()) {
    throw new Error("Registration confirmation email is not configured.");
  }

  try {
    await createSmtpTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to: user.email,
      subject: "Welcome to Smart Agriculture",
      text: `Hello ${user.name},\n\nYour Smart Agriculture account was created successfully. You can now log in and manage your farm.\n\nIf you did not create this account, please contact support.`
    });
  } catch (error) {
    console.error("Registration confirmation email delivery failed:", error.message);
    throw new Error("Registration confirmation email could not be sent.");
  }
}

async function sendRegistrationSms(user) {
  if (!isTwilioConfigured()) {
    throw new Error("Registration confirmation SMS is not configured.");
  }

  const accountSid = String(process.env.TWILIO_ACCOUNT_SID).trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN).trim();
  const form = new URLSearchParams({
    To: user.mobileNumber,
    From: String(process.env.TWILIO_FROM_NUMBER).trim(),
    Body: `Welcome to Smart Agriculture, ${user.name}! Your registration was successful.`
  });

  let response;
  try {
    response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form,
        signal: AbortSignal.timeout(12000)
      }
    );
  } catch (error) {
    console.error("Registration confirmation SMS delivery failed:", error.message);
    throw new Error("Registration confirmation SMS could not be sent.");
  }

  if (!response.ok) {
    console.error(`Registration confirmation SMS delivery failed with HTTP ${response.status}.`);
    throw new Error("Registration confirmation SMS could not be sent.");
  }
}

async function sendPasswordResetEmail(email, resetLink) {
  if (!isEmailConfigured()) {
    throw new Error("Email password reset is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in Back end/.env.");
  }

  const htmlResetLink = resetLink.replace(/&/g, "&amp;");
  try {
    await createSmtpTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: "Reset your Smart Agriculture password",
      text: `Use this link to create a new password: ${resetLink}\n\nThis link expires in 10 minutes and can only be used once. If you did not request this, you can ignore this email.`,
      html: `<p>We received a request to reset your Smart Agriculture password.</p><p><a href="${htmlResetLink}">Create a new password</a></p><p>This link expires in 10 minutes and can only be used once. If you did not request this, you can ignore this email.</p>`,
      textEncoding: "quoted-printable"
    });
  } catch (error) {
    console.error("Password reset email delivery failed:", error.message);
    throw new Error("Password reset email could not be sent. Check your SMTP settings and try again.");
  }
}

// Login and dashboard pages
app.get("/", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/reset-password", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/feature/:feature", (req, res) => {
  const features = [
    "crop-management",
    "crop-recommendations",
    "disease-guidance",
    "soil-testing",
    "weather-management",
    "market-prices",
    "farm-expenses",
    "feedback",
    "saved-searches"
  ];

  if (!features.includes(req.params.feature)) {
    return res.status(404).send("Feature page not found.");
  }

  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

function issueToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, mobileNumber: user.mobileNumber || "" },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Agriculture API is running" });
});

app.post("/api/register", async (req, res) => {
  const { name, email, mobileNumber, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedMobile = normalizeMobileNumber(mobileNumber);

  if (!name || !email || !mobileNumber || !password) {
    return res.status(400).json({ error: "Name, email, mobile number, and password are required." });
  }
  if (String(name).trim().length > 80 || normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: "Enter a name and a valid email address." });
  }
  if (!isValidMobileNumber(normalizedMobile)) {
    return res.status(400).json({ error: "Enter a valid Indian mobile number (10 digits, starting with 6–9)." });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters long." });
  }

  const db = readDB();
  const existing = [...db.users, ...users].find(user =>
    user.email.toLowerCase() === normalizedEmail ||
    (user.mobileNumber && normalizeMobileNumber(user.mobileNumber) === normalizedMobile)
  );
  if (existing) {
    return res.status(409).json({ error: "An account with this email or mobile number already exists." });
  }

  const user = {
    id: Date.now(),
    name: String(name).trim(),
    email: String(email).trim(),
    mobileNumber: normalizedMobile,
    passwordHash: bcrypt.hashSync(String(password), 10)
  };

  db.users.push(user);
  saveDB(db);
  users.push(user);

  const [emailResult, smsResult] = await Promise.allSettled([
    sendRegistrationEmail(user),
    sendRegistrationSms(user)
  ]);
  const emailSent = emailResult.status === "fulfilled";
  const smsSent = smsResult.status === "fulfilled";

  if (!emailSent) {
    console.error("Registration confirmation email was not delivered:", emailResult.reason.message);
  }
  if (!smsSent) {
    console.error("Registration confirmation SMS was not delivered:", smsResult.reason.message);
  }

  let message;
  if (emailSent && smsSent) {
    message = "Registration successful. Confirmation email and SMS sent. Please log in to continue.";
  } else if (emailSent) {
    message = "Registration successful. Confirmation email sent, but SMS could not be delivered. Please check the phone number. Please log in to continue.";
  } else if (smsSent) {
    message = "Registration successful. Confirmation SMS sent, but email could not be delivered. Please check your email address. Please log in to continue.";
  } else {
    message = "Registration successful, but the confirmation email and SMS could not be delivered. Please check your contact details. Please log in to continue.";
  }

  res.status(201).json({
    message,
    user: publicUser(user)
  });
});

app.post("/api/login", (req, res) => {
  const { email, identifier, mobileNumber, password } = req.body || {};
  const loginIdentifier = String(identifier || email || mobileNumber || "").trim();

  if (!loginIdentifier || !password) {
    return res.status(400).json({ error: "Email or mobile number and password are required." });
  }

  const db = readDB();
  const normalizedMobile = normalizeMobileNumber(loginIdentifier);
  const user = [...db.users, ...users].find(entry =>
    entry.email.toLowerCase() === loginIdentifier.toLowerCase() ||
    (entry.mobileNumber &&
      normalizeMobileNumber(entry.mobileNumber) === normalizedMobile &&
      isValidMobileNumber(normalizedMobile))
  );
  if (!user || !bcrypt.compareSync(String(password), user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or mobile number, or password." });
  }

  const token = issueToken(user);

  res.json({
    token,
    user: publicUser(user)
  });
});

app.post("/api/password-reset/request", async (req, res) => {
  const identifier = String(req.body?.identifier || "").trim();
  const normalizedEmail = identifier.toLowerCase();
  const isEmailIdentifier = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) &&
    normalizedEmail.length <= 254;
  if (!isEmailIdentifier) {
    return res.status(400).json({
      error: "Enter a valid email address."
    });
  }

  const now = Date.now();
  let removedExpiredChallenges = false;
  for (const [challengeId, challenge] of passwordResetChallenges) {
    if (challenge.expiresAt <= now) {
      passwordResetChallenges.delete(challengeId);
      removedExpiredChallenges = true;
    }
  }
  if (removedExpiredChallenges) persistPasswordResetChallenges();
  for (const [key, expiresAt] of passwordResetCooldowns) {
    if (expiresAt <= now) passwordResetCooldowns.delete(key);
  }
  if (passwordResetChallenges.size >= 10000) {
    return res.status(503).json({ error: "Password reset is temporarily busy. Please try again later." });
  }

  const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
  for (const [address, timestamps] of passwordResetIpAttempts) {
    const recent = timestamps.filter(timestamp => now - timestamp < 15 * 60 * 1000);
    if (recent.length) passwordResetIpAttempts.set(address, recent);
    else passwordResetIpAttempts.delete(address);
  }
  const ipAttempts = (passwordResetIpAttempts.get(ipAddress) || [])
    .filter(timestamp => now - timestamp < 15 * 60 * 1000);
  if (ipAttempts.length >= 5) {
    return res.status(429).json({ error: "Too many password reset requests. Please try again later." });
  }
  ipAttempts.push(now);
  passwordResetIpAttempts.set(ipAddress, ipAttempts);

  const identifierHash = crypto.createHash("sha256").update(normalizedEmail).digest("hex");
  const cooldownKey = `${ipAddress}:${identifierHash}`;
  if (passwordResetCooldowns.has(cooldownKey)) {
    return res.status(429).json({ error: "Please wait before requesting another password reset." });
  }
  passwordResetCooldowns.set(cooldownKey, now + 60 * 1000);

  const db = readDB();
  const account = [...db.users, ...users].find(user =>
    String(user.email || "").toLowerCase() === normalizedEmail
  );
  const challengeId = crypto.randomBytes(24).toString("hex");
  const resetChallenge = {
    method: "email-link",
    token: crypto.randomBytes(32).toString("hex")
  };

  passwordResetChallenges.set(challengeId, {
    userId: account ? String(account.id) : null,
    method: resetChallenge.method,
    tokenHash: passwordResetTokenHash(challengeId, resetChallenge.token),
    expiresAt: now + 10 * 60 * 1000,
    attempts: 0
  });
  persistPasswordResetChallenges();

  if (account) {
    try {
      let baseUrl;
      try {
        baseUrl = new URL(
          process.env.PUBLIC_APP_URL ||
          process.env.RENDER_EXTERNAL_URL ||
          `http://localhost:${PORT}`
        );
      } catch {
        throw new Error("Password reset link requires a valid PUBLIC_APP_URL in Back end/.env.");
      }
      if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") {
        throw new Error("Password reset links require PUBLIC_APP_URL to use HTTP or HTTPS.");
      }
      const resetUrl = new URL("/reset-password", baseUrl);
      resetUrl.searchParams.set("resetId", challengeId);
      resetUrl.searchParams.set("token", resetChallenge.token);
      await sendPasswordResetEmail(normalizedEmail, resetUrl.toString());
    } catch (error) {
      passwordResetChallenges.delete(challengeId);
      persistPasswordResetChallenges();
      passwordResetCooldowns.delete(cooldownKey);
      return res.status(503).json({
        error: error.message || "We could not send the password reset link. Check your delivery settings and try again."
      });
    }
  }

  res.json({
    method: resetChallenge.method,
    message: "If an account matches those details, a password reset link has been sent."
  });
});

app.post("/api/password-reset/complete", (req, res) => {
  const resetId = String(req.body?.resetId || "");
  const code = String(req.body?.code || "");
  const token = String(req.body?.token || "");
  const newPassword = String(req.body?.newPassword || "");
  const challenge = passwordResetChallenges.get(resetId);

  if (!/^[a-f0-9]{48}$/.test(resetId) || newPassword.length < 8) {
    return res.status(400).json({ error: "Enter a valid reset link and a new password with at least 8 characters." });
  }
  if (!challenge || challenge.expiresAt <= Date.now() || !challenge.userId) {
    passwordResetChallenges.delete(resetId);
    persistPasswordResetChallenges();
    return res.status(400).json({ error: "The password reset link is invalid or expired. Request another reset." });
  }

  challenge.attempts += 1;
  const isEmailLink = challenge.method === "email-link";
  const secretIsValid = isEmailLink
    ? /^[a-f0-9]{64}$/.test(token) &&
      crypto.timingSafeEqual(
        Buffer.from(passwordResetTokenHash(resetId, token), "hex"),
        Buffer.from(challenge.tokenHash, "hex")
      )
    : /^\d{6}$/.test(code) &&
      crypto.timingSafeEqual(
        Buffer.from(passwordResetCodeHash(resetId, code), "hex"),
        Buffer.from(challenge.codeHash, "hex")
      );
  if (challenge.attempts > 5 || !secretIsValid) {
    if (challenge.attempts >= 5) passwordResetChallenges.delete(resetId);
    persistPasswordResetChallenges();
    return res.status(400).json({ error: "The password reset link is invalid or expired. Request another reset." });
  }

  const db = readDB();
  let user = db.users.find(entry => String(entry.id) === challenge.userId);
  if (!user) {
    user = users.find(entry => String(entry.id) === challenge.userId);
    if (user) db.users.push(user);
  }
  if (!user) {
    passwordResetChallenges.delete(resetId);
    persistPasswordResetChallenges();
    return res.status(400).json({ error: "The password reset link is invalid or expired. Request another reset." });
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveDB(db);
  for (const [challengeId, activeChallenge] of passwordResetChallenges) {
    if (activeChallenge.userId === challenge.userId) {
      passwordResetChallenges.delete(challengeId);
    }
  }
  persistPasswordResetChallenges();
  res.json({
    message: "Password reset successfully. Please log in with your new password.",
    ...(isEmailLink ? { loginIdentifier: user.email } : {})
  });
});

app.get("/api/profile", requireAuth, (req, res) => {
  const user = findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "User profile not found. Please sign in again." });
  res.json(publicUser(user));
});

app.put("/api/profile", requireAuth, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim();
  const mobileNumber = normalizeMobileNumber(req.body?.mobileNumber);
  if (!name || name.length > 80 || !email || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a name and a valid email address." });
  }
  if (!isValidMobileNumber(mobileNumber)) {
    return res.status(400).json({ error: "Enter a valid Indian mobile number (10 digits, starting with 6–9)." });
  }

  const db = readDB();
  let user = db.users.find(entry => String(entry.id) === String(req.user.id));
  if (!user) {
    user = users.find(entry => String(entry.id) === String(req.user.id));
    if (user) db.users.push(user);
  }
  if (!user) return res.status(404).json({ error: "User profile not found. Please sign in again." });

  const duplicate = [...db.users, ...users].some(entry =>
    String(entry.id) !== String(user.id) &&
    (entry.email.toLowerCase() === email.toLowerCase() ||
      (entry.mobileNumber && normalizeMobileNumber(entry.mobileNumber) === mobileNumber))
  );
  if (duplicate) return res.status(409).json({ error: "An account with this email or mobile number already exists." });

  user.name = name;
  user.email = email;
  user.mobileNumber = mobileNumber;
  saveDB(db);
  const token = issueToken(user);
  res.json({ user: publicUser(user), token });
});

app.post("/api/profile/password", requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (!currentPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "Enter your current password and a new password with at least 8 characters." });
  }

  const db = readDB();
  let user = db.users.find(entry => String(entry.id) === String(req.user.id));
  if (!user) {
    user = users.find(entry => String(entry.id) === String(req.user.id));
    if (user) db.users.push(user);
  }
  if (!user) return res.status(404).json({ error: "User profile not found. Please sign in again." });
  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveDB(db);
  res.json({ message: "Password updated successfully." });
});

app.get("/api/search-history", requireAuth, (req, res) => {
  const history = readDB().searchHistory
    .filter(entry => String(entry.userId) === String(req.user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(history);
});

app.post("/api/search-history", requireAuth, (req, res) => {
  const { feature, summary, query } = req.body || {};
  const allowedFeatures = [
    "crop-recommendations", "disease-guidance", "soil-testing",
    "weather-management", "market-prices"
  ];
  if (!allowedFeatures.includes(feature) || typeof summary !== "string" ||
      !summary.trim() || summary.length > 160 ||
      !query || typeof query !== "object" || Array.isArray(query) ||
      JSON.stringify(query).length > 4000) {
    return res.status(400).json({ error: "The search details are invalid or too long to save." });
  }

  const db = readDB();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: req.user.id,
    feature,
    summary: summary.trim(),
    query,
    createdAt: new Date().toISOString()
  };
  db.searchHistory.push(entry);
  const userEntries = db.searchHistory
    .filter(item => String(item.userId) === String(req.user.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  while (userEntries.length > 100) {
    const oldest = userEntries.shift();
    db.searchHistory = db.searchHistory.filter(item => item.id !== oldest.id);
  }
  saveDB(db);
  res.status(201).json(entry);
});

app.delete("/api/search-history", requireAuth, (req, res) => {
  const db = readDB();
  const before = db.searchHistory.length;
  db.searchHistory = db.searchHistory.filter(
    entry => String(entry.userId) !== String(req.user.id)
  );
  saveDB(db);
  res.json({ deleted: before - db.searchHistory.length });
});

app.post("/api/logout", (req, res) => {
  res.json({ message: "Logged out successfully." });
});

// Dashboard
app.get("/api/dashboard", (req, res) => {
  const db = readDB();

  res.json({
    totalCrops: db.crops.length,
    totalExpenses: db.expenses.reduce(
      (sum, item) => sum + Number(item.amount || 0), 0
    ),
    totalReadings: db.readings.length,
    totalHealthScans: db.healthScans.length
  });
});

// Get crops
app.get("/api/crops", (req, res) => {
  res.json(readDB().crops);
});

// Add crop
app.post("/api/crops", requireAuth, (req, res) => {
  const { name, type, area, plantingDate, season, category, state, district } = req.body;

  if (!name) {
    return res.status(400).json({ error: "Crop name is required." });
  }

  const db = readDB();
  const crop = {
    id: Date.now(),
    name,
    type: type || "",
    category: category || "",
    area: Number(area || 0),
    plantingDate: plantingDate || "",
    state: state || "",
    district: district || "",
    season: season || "",
    createdAt: new Date().toISOString()
  };

  db.crops.push(crop);
  saveDB(db);

  res.status(201).json(crop);
});

// Delete crop
app.delete("/api/crops/:id", (req, res) => {
  const db = readDB();
  const oldLength = db.crops.length;

  db.crops = db.crops.filter(
    crop => String(crop.id) !== req.params.id
  );

  if (db.crops.length === oldLength) {
    return res.status(404).json({ error: "Crop not found." });
  }

  saveDB(db);
  res.json({ message: "Crop deleted successfully." });
});

// Get expenses
app.get("/api/expenses", (req, res) => {
  res.json(readDB().expenses);
});

// Add expense
app.post("/api/expenses", requireAuth, (req, res) => {
  const { item, title, amount, category, state, district } = req.body;
  const expenseTitle = item || title;

  if (!expenseTitle || amount === undefined || !Number.isFinite(Number(amount)) ||
      Number(amount) < 0) {
    return res.status(400).json({
      error: "Enter a valid expense title and amount."
    });
  }

  const db = readDB();
  const expense = {
    id: Date.now(),
    item: expenseTitle,
    title: expenseTitle,
    amount: Number(amount),
    category: category || "Other",
    state: state || "",
    district: district || "",
    date: new Date().toISOString()
  };

  db.expenses.push(expense);
  saveDB(db);

  res.status(201).json(expense);
});

// Save temperature and humidity readings
app.post("/api/field-readings", (req, res) => {
  const { temperature, humidity } = req.body;

  if (!Number.isFinite(Number(temperature)) ||
      !Number.isFinite(Number(humidity)) ||
      Number(humidity) < 0 || Number(humidity) > 100) {
    return res.status(400).json({
      error: "Enter valid temperature and humidity values."
    });
  }

  const db = readDB();
  const reading = {
    id: Date.now(),
    temperature: Number(temperature),
    humidity: Number(humidity),
    date: new Date().toISOString()
  };

  db.readings.push(reading);
  saveDB(db);

  res.status(201).json(reading);
});

// Disease guidance endpoint used by the frontend
app.post("/api/disease", upload.single("leaf"), (req, res) => {
  const symptom = req.body.symptom || "other";
  const crop = req.body.crop || "crop";

  const guidance = {
    spots: "Leaf spots may indicate fungal infection. Reduce humidity around the leaves, remove damaged foliage, and consider a recommended fungicide if necessary.",
    yellow: "Yellowing leaves often points to nutrient stress or water imbalance. Check soil moisture and consider a balanced nutrient application.",
    wilt: "Wilting suggests water stress, root issues, or wilt disease. Inspect roots, improve drainage, and water consistently.",
    other: "Check the crop health carefully and compare symptoms with local field conditions before applying treatment."
  };

  const result = guidance[symptom] || guidance.other;

  const scan = {
    id: Date.now(),
    crop,
    symptom,
    image: req.file ? `/uploads/${req.file.filename}` : null,
    result,
    date: new Date().toISOString(),
    note: "This is a practical field guide, not a laboratory diagnosis."
  };

  const db = readDB();
  db.healthScans.push(scan);
  saveDB(db);

  res.status(201).json({
    result,
    note: scan.note,
    image: scan.image
  });
});

app.post("/api/soil", (req, res) => {
  const { ph, nitrogen, phosphorus, potassium, moisture } = req.body || {};

  if ([ph, nitrogen, phosphorus, potassium, moisture].some(value => value === undefined || value === null || Number.isNaN(Number(value)))) {
    return res.status(400).json({ error: "All soil test values are required." });
  }

  const soilPH = Number(ph);
  const nitrogenValue = Number(nitrogen);
  const phosphorusValue = Number(phosphorus);
  const potassiumValue = Number(potassium);
  const moistureValue = Number(moisture);

  let guidance = "Soil conditions look generally stable. Maintain balanced nutrient management and monitor moisture closely.";

  if (soilPH < 6 || soilPH > 7.5) {
    guidance = "Soil pH is outside the ideal range. Adjust with lime or sulphur based on the direction required for your crop.";
  }

  if (nitrogenValue < 100 || phosphorusValue < 50 || potassiumValue < 100) {
    guidance = "Nutrient levels are below the target range. Apply a crop-specific fertiliser plan and re-test after application.";
  }

  if (moistureValue < 25 || moistureValue > 75) {
    guidance = "Moisture is outside the desirable range. Improve irrigation scheduling and soil structure to avoid under- or over-watering.";
  }

  res.json({ guidance });
});

app.get("/api/weather", (req, res) => {
  const state = (req.query.state || "Karnataka").toString();
  const district = (req.query.district || "Bengaluru").toString();

  const weatherMap = {
    "Karnataka": { Bengaluru: { temperatureC: 28, humidityPercent: 65, rainfallMm: 10 }, Mysuru: { temperatureC: 26, humidityPercent: 62, rainfallMm: 8 }, Belagavi: { temperatureC: 30, humidityPercent: 69, rainfallMm: 14 }, Bidar: { temperatureC: 31, humidityPercent: 70, rainfallMm: 16 }, Shimoga: { temperatureC: 27, humidityPercent: 67, rainfallMm: 12 } },
    "Tamil Nadu": { Chennai: { temperatureC: 32, humidityPercent: 72, rainfallMm: 9 }, Coimbatore: { temperatureC: 29, humidityPercent: 64, rainfallMm: 7 }, Madurai: { temperatureC: 31, humidityPercent: 68, rainfallMm: 11 }, Salem: { temperatureC: 30, humidityPercent: 66, rainfallMm: 8 }, Trichy: { temperatureC: 33, humidityPercent: 74, rainfallMm: 10 } },
    "Maharashtra": { Pune: { temperatureC: 27, humidityPercent: 63, rainfallMm: 6 }, Nashik: { temperatureC: 29, humidityPercent: 61, rainfallMm: 9 }, Nagpur: { temperatureC: 31, humidityPercent: 64, rainfallMm: 12 }, Solapur: { temperatureC: 33, humidityPercent: 66, rainfallMm: 4 }, Amravati: { temperatureC: 30, humidityPercent: 65, rainfallMm: 11 } },
    "Telangana": { Hyderabad: { temperatureC: 31, humidityPercent: 71, rainfallMm: 13 }, Warangal: { temperatureC: 30, humidityPercent: 69, rainfallMm: 15 }, Nizamabad: { temperatureC: 32, humidityPercent: 68, rainfallMm: 12 }, Karimnagar: { temperatureC: 29, humidityPercent: 67, rainfallMm: 10 }, Mahabubnagar: { temperatureC: 33, humidityPercent: 72, rainfallMm: 14 } },
    "Andhra Pradesh": { Visakhapatnam: { temperatureC: 30, humidityPercent: 73, rainfallMm: 15 }, Guntur: { temperatureC: 31, humidityPercent: 70, rainfallMm: 12 }, Kadapa: { temperatureC: 32, humidityPercent: 69, rainfallMm: 8 }, Vijayawada: { temperatureC: 31, humidityPercent: 71, rainfallMm: 14 }, Anantapur: { temperatureC: 34, humidityPercent: 62, rainfallMm: 5 } },
    "Punjab": { Ludhiana: { temperatureC: 29, humidityPercent: 58, rainfallMm: 4 }, Amritsar: { temperatureC: 28, humidityPercent: 60, rainfallMm: 5 }, Jalandhar: { temperatureC: 27, humidityPercent: 59, rainfallMm: 3 }, Patiala: { temperatureC: 30, humidityPercent: 58, rainfallMm: 5 }, Bathinda: { temperatureC: 33, humidityPercent: 52, rainfallMm: 2 } },
    "Kerala": { Thiruvananthapuram: { temperatureC: 29, humidityPercent: 79, rainfallMm: 18 }, Kozhikode: { temperatureC: 28, humidityPercent: 77, rainfallMm: 16 }, Ernakulam: { temperatureC: 30, humidityPercent: 81, rainfallMm: 19 }, Kannur: { temperatureC: 29, humidityPercent: 76, rainfallMm: 15 }, Palakkad: { temperatureC: 28, humidityPercent: 70, rainfallMm: 13 } },
    "Uttar Pradesh": { Lucknow: { temperatureC: 30, humidityPercent: 60, rainfallMm: 7 }, Varanasi: { temperatureC: 31, humidityPercent: 62, rainfallMm: 8 }, Kanpur: { temperatureC: 31, humidityPercent: 61, rainfallMm: 6 }, Agra: { temperatureC: 34, humidityPercent: 55, rainfallMm: 5 }, Meerut: { temperatureC: 32, humidityPercent: 57, rainfallMm: 6 } }
  };

  const districtAliases = {
    "Bengaluru Urban": "Bengaluru",
    "Bengaluru Rural": "Bengaluru",
    "Shivamogga": "Shimoga"
  };
  const forecast = weatherMap[state]?.[districtAliases[district] || district] ||
    { temperatureC: 29, humidityPercent: 68, rainfallMm: 10 };

  res.json({
    location: `${district}, ${state}`,
    mode: "Current field estimate",
    temperatureC: forecast.temperatureC,
    humidityPercent: forecast.humidityPercent,
    rainfallMm: forecast.rainfallMm,
    message: `Weather is suitable for routine crop monitoring and careful irrigation planning in ${district}.`
  });
});

const cropSuitabilityProfiles = {
  rice: { ph: [5.5, 7], moisture: [60, 85], temperature: [20, 35], humidity: [50, 95], rainfall: [5, 30], seasons: ["Monsoon", "Summer"] },
  wheat: { ph: [6, 7.5], moisture: [25, 60], temperature: [10, 25], humidity: [30, 75], rainfall: [0, 12], seasons: ["Winter"] },
  maize: { ph: [5.5, 7.5], moisture: [30, 70], temperature: [18, 32], humidity: [40, 85], rainfall: [2, 25], seasons: ["Monsoon", "Winter"] },
  tomato: { ph: [6, 7], moisture: [35, 65], temperature: [18, 30], humidity: [40, 75], rainfall: [0, 15], seasons: ["Winter", "Summer"] },
  potato: { ph: [5, 6.5], moisture: [30, 60], temperature: [15, 25], humidity: [40, 80], rainfall: [0, 15], seasons: ["Winter"] },
  onion: { ph: [6, 7], moisture: [25, 55], temperature: [13, 28], humidity: [35, 75], rainfall: [0, 12], seasons: ["Winter", "Summer"] },
  chilli: { ph: [6, 7.5], moisture: [30, 65], temperature: [20, 32], humidity: [40, 80], rainfall: [2, 20], seasons: ["Monsoon", "Winter"] },
  banana: { ph: [6, 7.5], moisture: [50, 80], temperature: [20, 35], humidity: [50, 90], rainfall: [5, 30], seasons: ["Monsoon", "Winter", "Summer"] },
  cotton: { ph: [5.8, 8], moisture: [25, 60], temperature: [21, 35], humidity: [35, 75], rainfall: [2, 20], seasons: ["Monsoon"] },
  soybean: { ph: [6, 7.5], moisture: [35, 65], temperature: [20, 32], humidity: [45, 85], rainfall: [3, 25], seasons: ["Monsoon"] },
  groundnut: { ph: [6, 7.5], moisture: [25, 55], temperature: [20, 30], humidity: [40, 80], rainfall: [2, 18], seasons: ["Monsoon", "Summer"] },
  ragi: { ph: [5, 7.5], moisture: [25, 60], temperature: [20, 32], humidity: [35, 80], rainfall: [1, 20], seasons: ["Monsoon"] },
  sugarcane: { ph: [6, 7.5], moisture: [50, 80], temperature: [20, 35], humidity: [45, 90], rainfall: [5, 30], seasons: ["Monsoon", "Winter", "Summer"] },
  grapes: { ph: [6.5, 7.5], moisture: [25, 55], temperature: [15, 32], humidity: [30, 70], rainfall: [0, 12], seasons: ["Winter", "Summer"] },
  "tur dal": { ph: [6, 7.5], moisture: [25, 55], temperature: [20, 32], humidity: [35, 80], rainfall: [1, 18], seasons: ["Monsoon"] }
};

app.post("/api/crop-recommendations", (req, res) => {
  const { season, state, district, weather } = req.body || {};
  if (!["Monsoon", "Winter", "Summer"].includes(season)) {
    return res.status(400).json({ error: "Select a valid planting season." });
  }

  const soilPH = Number(req.body.ph);
  const soilMoisture = Number(req.body.moisture);
  const temperature = Number(weather?.temperatureC);
  const humidity = Number(weather?.humidityPercent);
  const rainfall = Number(weather?.rainfallMm);
  if (!state || !district ||
      !Number.isFinite(soilPH) || soilPH < 0 || soilPH > 14 ||
      !Number.isFinite(soilMoisture) || soilMoisture < 0 || soilMoisture > 100 ||
      !Number.isFinite(temperature) || temperature < -20 || temperature > 60 ||
      !Number.isFinite(humidity) || humidity < 0 || humidity > 100 ||
      !Number.isFinite(rainfall) || rainfall < 0 || rainfall > 1000) {
    return res.status(400).json({ error: "Enter valid soil values and select a state and district with weather data." });
  }

  const recommendations = Object.entries(cropSuitabilityProfiles).map(([name, profile]) => {
    const factors = [
      { key: "Season", value: season, suitable: profile.seasons.includes(season), range: profile.seasons },
      { key: "Soil pH", value: soilPH, suitable: soilPH >= profile.ph[0] && soilPH <= profile.ph[1], range: profile.ph },
      { key: "Soil moisture", value: soilMoisture, suitable: soilMoisture >= profile.moisture[0] && soilMoisture <= profile.moisture[1], range: profile.moisture },
      { key: "Estimated temperature", value: temperature, suitable: temperature >= profile.temperature[0] && temperature <= profile.temperature[1], range: profile.temperature },
      { key: "Estimated humidity", value: humidity, suitable: humidity >= profile.humidity[0] && humidity <= profile.humidity[1], range: profile.humidity },
      { key: "Estimated daily rainfall", value: rainfall, suitable: rainfall >= profile.rainfall[0] && rainfall <= profile.rainfall[1], range: profile.rainfall }
    ];
    const score = Math.round(
      factors.filter(factor => factor.suitable).length / factors.length * 100
    );

    return {
      crop: name.replace(/\b[a-z]/g, letter => letter.toUpperCase()),
      score,
      factors
    };
  }).sort((a, b) => b.score - a.score || a.crop.localeCompare(b.crop));

  res.json({
    season,
    state,
    district,
    recommendations: recommendations.slice(0, 5),
    weather: { temperatureC: temperature, humidityPercent: humidity, rainfallMm: rainfall },
    advisory: "Rule-based planning estimate only. Soil type, drainage, variety, nutrient levels, forecast, and local recommendations can change crop suitability."
  });
});

const marketPriceCache = new Map();
const marketCacheDurationMs = 10 * 60 * 1000;
const marketDatasetId = "9ef84268-d588-465a-a308-a864a43d0070";
const vegetableNames = [
  "amaranth", "ash gourd", "baby corn", "beans", "beetroot", "bitter gourd",
  "bottle gourd", "brinjal", "broccoli", "cabbage", "capsicum", "carrot",
  "cauliflower", "celery", "chilli", "cluster beans", "colocasia", "cucumber",
  "drumstick", "elephant yam", "french beans", "garlic", "ginger",
  "green chilli", "green peas", "ivy gourd", "kohlrabi", "lady finger", "lettuce",
  "methi leaves", "mint", "mushroom", "mustard leaves", "okra", "onion", "peas", "pointed gourd",
  "potato", "pumpkin", "radish", "ridge gourd", "snake gourd", "spinach",
  "raw banana", "raw papaya", "sweet potato", "tapioca", "taro", "tinda",
  "tomato", "turnip", "yam", "zucchini", "coriander leaves", "curry leaves",
  "drumstick leaves"
].map(name => name.replace(/[^a-z]/gi, "").toLowerCase());
const flowerNames = [
  "aster", "carnation", "chrysanthemum", "crossandra", "flower", "gerbera",
  "gladiolus", "hibiscus", "jasmine", "lily", "lotus", "marigold", "orchid",
  "rose", "tuberose"
].map(name => name.replace(/[^a-z]/gi, "").toLowerCase());
const districtAliases = {
  "Bengaluru Urban": "Bengaluru",
  "Bengaluru Rural": "Bengaluru",
  "Shivamogga": "Shimoga"
};

function classifyMarketCommodity(value) {
  const commodity = String(value || "").replace(/[^a-z]/gi, "").toLowerCase();
  if (!commodity) return null;
  if (commodity.includes("flower") || flowerNames.some(name => commodity === name || commodity.startsWith(name))) {
    return "Flowers";
  }
  if (commodity.includes("vegetable") || vegetableNames.some(name => commodity === name || commodity.startsWith(name))) {
    return "Vegetables";
  }
  return null;
}

function parseMarketDate(value) {
  const text = String(value || "").trim();
  const dayFirst = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dayFirst) {
    return Date.UTC(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]));
  }
  const timestamp = Date.parse(text);
  return Number.isNaN(timestamp) ? null : timestamp;
}

const estimatedMarketCatalog = [
  ["amaranth", 25, 55, 40], ["ash gourd", 15, 30, 22], ["baby corn", 50, 100, 75],
  ["beans", 35, 80, 55], ["beetroot", 25, 50, 38], ["bitter gourd", 30, 65, 48],
  ["bottle gourd", 15, 35, 25], ["brinjal", 20, 50, 35], ["broccoli", 60, 130, 95],
  ["cabbage", 12, 30, 20], ["capsicum", 35, 90, 60], ["carrot", 25, 65, 45],
  ["cauliflower", 18, 50, 32], ["celery", 50, 120, 85], ["chilli", 35, 100, 65],
  ["cluster beans", 35, 80, 55], ["colocasia", 25, 55, 40], ["cucumber", 18, 45, 30],
  ["drumstick", 30, 75, 50], ["elephant yam", 25, 60, 42], ["french beans", 40, 90, 65],
  ["garlic", 100, 240, 160], ["ginger", 80, 200, 130], ["green chilli", 35, 100, 65],
  ["green peas", 40, 100, 70], ["ivy gourd", 25, 60, 42], ["kohlrabi", 20, 50, 35],
  ["lady finger", 30, 75, 50], ["lettuce", 40, 100, 70], ["methi leaves", 15, 35, 25],
  ["mint", 30, 80, 55], ["mushroom", 100, 250, 170], ["mustard leaves", 15, 35, 25],
  ["okra", 30, 75, 50], ["onion", 18, 45, 30], ["peas", 40, 100, 70],
  ["pointed gourd", 35, 85, 60], ["potato", 15, 35, 24], ["pumpkin", 15, 35, 24],
  ["radish", 15, 35, 24], ["ridge gourd", 25, 60, 42], ["snake gourd", 25, 60, 42],
  ["spinach", 15, 35, 25], ["raw banana", 20, 50, 35], ["raw papaya", 15, 40, 28],
  ["sweet potato", 25, 60, 42], ["tapioca", 20, 45, 32], ["taro", 25, 55, 40],
  ["tinda", 25, 60, 42], ["tomato", 18, 50, 32], ["turnip", 20, 45, 32],
  ["yam", 30, 70, 48], ["zucchini", 40, 100, 70], ["coriander leaves", 30, 100, 60],
  ["curry leaves", 50, 150, 90], ["drumstick leaves", 25, 60, 40],
  ["aster", 80, 220, 140, "Flowers"], ["carnation", 120, 350, 220, "Flowers"],
  ["chrysanthemum", 60, 180, 110, "Flowers"], ["crossandra", 100, 350, 200, "Flowers"],
  ["flower", 60, 220, 130, "Flowers"], ["gerbera", 100, 300, 180, "Flowers"],
  ["gladiolus", 80, 240, 150, "Flowers"], ["hibiscus", 60, 200, 120, "Flowers"],
  ["jasmine", 250, 900, 500, "Flowers"], ["lily", 150, 450, 280, "Flowers"],
  ["lotus", 100, 350, 200, "Flowers"], ["marigold", 40, 160, 90, "Flowers"],
  ["orchid", 250, 900, 500, "Flowers"], ["rose", 100, 400, 220, "Flowers"],
  ["tuberose", 100, 350, 200, "Flowers"]
];

function createEstimatedMarketReport(state, district) {
  return {
    state,
    district,
    estimate: true,
    scope: "India-wide planning estimate; not a district mandi quote",
    prices: estimatedMarketCatalog.map(([name, minPrice, maxPrice, modalPrice, category]) => ({
      category: category || "Vegetables",
      crop: name.replace(/\b[a-z]/g, letter => letter.toUpperCase()),
      market: "Indicative estimate",
      minPrice,
      maxPrice,
      modalPrice,
      unit: "per kg"
    }))
  };
}

app.get("/api/market", async (req, res) => {
  const state = String(req.query.state || "").trim();
  const district = String(req.query.district || "").trim();
  if (!state || !district) {
    return res.status(400).json({ error: "Select a state and district to view mandi prices." });
  }

  const apiKey = process.env.DATA_GOV_IN_API_KEY;
  if (!apiKey) {
    return res.json(createEstimatedMarketReport(state, district));
  }

  const districtAliases = {
    "Bengaluru Urban": "Bengaluru",
    "Bengaluru Rural": "Bengaluru",
    "Shivamogga": "Shimoga"
  };
  const marketDistrict = districtAliases[district] || district;
  const cacheKey = `${state.toLowerCase()}|${marketDistrict.toLowerCase()}`;
  const cached = marketPriceCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < marketCacheDurationMs) {
    return res.json(cached.result);
  }

  const endpoint = new URL(`https://api.data.gov.in/resource/${marketDatasetId}`);
  endpoint.search = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    limit: "1000",
    "sort[Arrival_Date]": "desc",
    "filters[State]": state,
    "filters[District]": marketDistrict
  }).toString();

  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) {
      console.error(`data.gov.in mandi-price request failed with HTTP ${response.status}.`);
      return res.json(createEstimatedMarketReport(state, district));
    }

    const payload = await response.json();
    if (!Array.isArray(payload.records)) {
      console.error("data.gov.in returned an unexpected mandi-price response.");
      return res.json(createEstimatedMarketReport(state, district));
    }

    const matchingRecords = payload.records
      .map(record => ({
        record,
        category: classifyMarketCommodity(record.Commodity),
        timestamp: parseMarketDate(record.Arrival_Date)
      }))
      .filter(item => item.category && item.timestamp !== null);
    const latestTimestamp = matchingRecords.reduce(
      (latest, item) => Math.max(latest, item.timestamp),
      0
    );
    const latestRecords = matchingRecords.filter(item => item.timestamp === latestTimestamp);
    const result = {
      state,
      district,
      source: "data.gov.in",
      estimate: false,
      arrivalDate: latestRecords[0]?.record.Arrival_Date || null,
      prices: latestRecords.map(({ record, category }) => ({
        category,
        crop: String(record.Commodity || "").trim(),
        market: String(record.Market || "").trim(),
        variety: String(record.Variety || "").trim(),
        minPrice: Number(record.Min_Price),
        maxPrice: Number(record.Max_Price),
        modalPrice: Number(record.Modal_Price)
      })).filter(price =>
        price.crop && price.market &&
        [price.minPrice, price.maxPrice, price.modalPrice].every(Number.isFinite)
      )
    };

    if (result.prices.length === 0) {
      return res.json(createEstimatedMarketReport(state, district));
    }

    marketPriceCache.set(cacheKey, { cachedAt: Date.now(), result });
    return res.json(result);
  } catch (error) {
    console.error("data.gov.in mandi-price request failed:", error.message);
    return res.json(createEstimatedMarketReport(state, district));
  }
});

app.get("/api/market-sample", (req, res) => {
  const state = (req.query.state || "Karnataka").toString();
  const district = (req.query.district || "Bengaluru").toString();

  const priceMap = {
    "Karnataka": { Bengaluru: [{ crop: "Rice", pricePerQuintal: 2450, market: "Yeshwanthpur Mandi" }, { crop: "Tomato", pricePerQuintal: 1900, market: "Bengaluru Market" }, { crop: "Maize", pricePerQuintal: 1750, market: "City Market" }], Mysuru: [{ crop: "Rice", pricePerQuintal: 2380, market: "Mysuru Mandi" }, { crop: "Tur Dal", pricePerQuintal: 5100, market: "Mysuru Market" }, { crop: "Banana", pricePerQuintal: 1650, market: "Local Market" }], Belagavi: [{ crop: "Maize", pricePerQuintal: 1800, market: "Belagavi Market" }, { crop: "Sugarcane", pricePerQuintal: 3300, market: "Belagavi Mandi" }, { crop: "Groundnut", pricePerQuintal: 4300, market: "Local Market" }], Bidar: [{ crop: "Cotton", pricePerQuintal: 6200, market: "Bidar Mandi" }, { crop: "Soybean", pricePerQuintal: 4100, market: "Market Yard" }, { crop: "Tur Dal", pricePerQuintal: 5300, market: "Bidar Market" }], Shimoga: [{ crop: "Rice", pricePerQuintal: 2400, market: "Shimoga Mandi" }, { crop: "Arecanut", pricePerQuintal: 7500, market: "Local Market" }, { crop: "Coconut", pricePerQuintal: 3100, market: "Coastal Market" }] },
    "Tamil Nadu": { Chennai: [{ crop: "Rice", pricePerQuintal: 2500, market: "Koyambedu Mandi" }, { crop: "Tomato", pricePerQuintal: 2000, market: "Pallikaranai Market" }, { crop: "Groundnut", pricePerQuintal: 4350, market: "City Mandi" }], Coimbatore: [{ crop: "Maize", pricePerQuintal: 1850, market: "Coimbatore Mandi" }, { crop: "Tur Dal", pricePerQuintal: 5250, market: "Peelamedu Market" }, { crop: "Onion", pricePerQuintal: 2100, market: "Wholesale Market" }], Madurai: [{ crop: "Rice", pricePerQuintal: 2460, market: "Madurai Mandi" }, { crop: "Banana", pricePerQuintal: 1700, market: "Local Market" }, { crop: "Chilli", pricePerQuintal: 5400, market: "Fruit Market" }], Salem: [{ crop: "Tur Dal", pricePerQuintal: 5200, market: "Salem Mandi" }, { crop: "Coconut", pricePerQuintal: 3000, market: "Farmers Market" }, { crop: "Groundnut", pricePerQuintal: 4300, market: "Local Market" }], Trichy: [{ crop: "Rice", pricePerQuintal: 2440, market: "Trichy Mandi" }, { crop: "Banana", pricePerQuintal: 1800, market: "Urban Market" }, { crop: "Onion", pricePerQuintal: 2050, market: "Town Market" }] },
    "Maharashtra": { Pune: [{ crop: "Wheat", pricePerQuintal: 2350, market: "Pune Mandi" }, { crop: "Onion", pricePerQuintal: 2150, market: "Market Yard" }, { crop: "Soybean", pricePerQuintal: 4200, market: "Pune Market" }], Nashik: [{ crop: "Grapes", pricePerQuintal: 4400, market: "Nashik Mandi" }, { crop: "Onion", pricePerQuintal: 2250, market: "Wholesale Market" }, { crop: "Cotton", pricePerQuintal: 6100, market: "Local Mandi" }], Nagpur: [{ crop: "Soybean", pricePerQuintal: 4050, market: "Nagpur Mandi" }, { crop: "Cotton", pricePerQuintal: 6250, market: "Trade Yard" }, { crop: "Wheat", pricePerQuintal: 2320, market: "City Market" }], Solapur: [{ crop: "Tur Dal", pricePerQuintal: 5190, market: "Solapur Mandi" }, { crop: "Jowar", pricePerQuintal: 1950, market: "Local Market" }, { crop: "Groundnut", pricePerQuintal: 4250, market: "Mandi" }], Amravati: [{ crop: "Cotton", pricePerQuintal: 6150, market: "Amravati Mandi" }, { crop: "Soybean", pricePerQuintal: 4100, market: "Agriculture Market" }, { crop: "Wheat", pricePerQuintal: 2300, market: "Market Yard" }] },
    "Telangana": { Hyderabad: [{ crop: "Rice", pricePerQuintal: 2480, market: "Moinabad Mandi" }, { crop: "Tur Dal", pricePerQuintal: 5150, market: "Hyderabad Market" }, { crop: "Cotton", pricePerQuintal: 6150, market: "City Market" }], Warangal: [{ crop: "Maize", pricePerQuintal: 1820, market: "Warangal Market" }, { crop: "Rice", pricePerQuintal: 2420, market: "Local Mandi" }, { crop: "Chilli", pricePerQuintal: 5380, market: "Warehouse Market" }], Nizamabad: [{ crop: "Rice", pricePerQuintal: 2410, market: "Nizamabad Mandi" }, { crop: "Cotton", pricePerQuintal: 6180, market: "District Market" }, { crop: "Maize", pricePerQuintal: 1790, market: "Farmers Yard" }], Karimnagar: [{ crop: "Rice", pricePerQuintal: 2385, market: "Karimnagar Mandi" }, { crop: "Maize", pricePerQuintal: 1780, market: "Market Yard" }, { crop: "Tur Dal", pricePerQuintal: 5100, market: "Local Market" }], Mahabubnagar: [{ crop: "Cotton", pricePerQuintal: 6200, market: "Mahabubnagar Mandi" }, { crop: "Tur Dal", pricePerQuintal: 5180, market: "Regional Mandi" }, { crop: "Groundnut", pricePerQuintal: 4320, market: "Farm Gate" }] },
    "Andhra Pradesh": { Visakhapatnam: [{ crop: "Rice", pricePerQuintal: 2400, market: "Visakhapatnam Mandi" }, { crop: "Paddy", pricePerQuintal: 2360, market: "Sea Port Market" }, { crop: "Banana", pricePerQuintal: 1750, market: "Local Yard" }], Guntur: [{ crop: "Chilli", pricePerQuintal: 5450, market: "Guntur Market" }, { crop: "Cotton", pricePerQuintal: 6120, market: "Guntur Mandi" }, { crop: "Groundnut", pricePerQuintal: 4280, market: "Market Yard" }], Kadapa: [{ crop: "Groundnut", pricePerQuintal: 4300, market: "Kadapa Mandi" }, { crop: "Rice", pricePerQuintal: 2390, market: "Rural Market" }, { crop: "Tur Dal", pricePerQuintal: 5150, market: "Local Market" }], Vijayawada: [{ crop: "Rice", pricePerQuintal: 2430, market: "Vijayawada Mandi" }, { crop: "Maize", pricePerQuintal: 1840, market: "City Market" }, { crop: "Cotton", pricePerQuintal: 6100, market: "Wholesale Market" }], Anantapur: [{ crop: "Groundnut", pricePerQuintal: 4250, market: "Anantapur Mandi" }, { crop: "Pulses", pricePerQuintal: 5050, market: "Market Yard" }, { crop: "Cotton", pricePerQuintal: 6060, market: "Local Market" }] },
    "Punjab": { Ludhiana: [{ crop: "Wheat", pricePerQuintal: 2380, market: "Ludhiana Mandi" }, { crop: "Rice", pricePerQuintal: 2520, market: "Grain Market" }, { crop: "Maize", pricePerQuintal: 1910, market: "Farmers Yard" }], Amritsar: [{ crop: "Wheat", pricePerQuintal: 2360, market: "Amritsar Market" }, { crop: "Rice", pricePerQuintal: 2490, market: "Mandi" }, { crop: "Cotton", pricePerQuintal: 6000, market: "Regional Market" }], Jalandhar: [{ crop: "Rice", pricePerQuintal: 2500, market: "Jalandhar Mandi" }, { crop: "Wheat", pricePerQuintal: 2370, market: "Wholesale Market" }, { crop: "Maize", pricePerQuintal: 1880, market: "Local Market" }], Patiala: [{ crop: "Rice", pricePerQuintal: 2515, market: "Patiala Mandi" }, { crop: "Wheat", pricePerQuintal: 2365, market: "Regional Market" }, { crop: "Cotton", pricePerQuintal: 6050, market: "Market Yard" }], Bathinda: [{ crop: "Wheat", pricePerQuintal: 2335, market: "Bathinda Market" }, { crop: "Cotton", pricePerQuintal: 6080, market: "Bathinda Mandi" }, { crop: "Rice", pricePerQuintal: 2480, market: "Local Market" }] },
    "Kerala": { Thiruvananthapuram: [{ crop: "Coconut", pricePerQuintal: 3100, market: "Trivandrum Market" }, { crop: "Banana", pricePerQuintal: 1750, market: "Wholesale Market" }, { crop: "Rice", pricePerQuintal: 2480, market: "Regional Mandi" }], Kozhikode: [{ crop: "Coconut", pricePerQuintal: 3120, market: "Kozhikode Market" }, { crop: "Rubber", pricePerQuintal: 7200, market: "Local Market" }, { crop: "Rice", pricePerQuintal: 2460, market: "Mandi" }], Ernakulam: [{ crop: "Coconut", pricePerQuintal: 3200, market: "Ernakulam Mandi" }, { crop: "Banana", pricePerQuintal: 1800, market: "Market Yard" }, { crop: "Pepper", pricePerQuintal: 9300, market: "Local Market" }], Kannur: [{ crop: "Coconut", pricePerQuintal: 3180, market: "Kannur Mandi" }, { crop: "Rice", pricePerQuintal: 2470, market: "Market Yard" }, { crop: "Pepper", pricePerQuintal: 9200, market: "Farmers Market" }], Palakkad: [{ crop: "Coconut", pricePerQuintal: 3080, market: "Palakkad Market" }, { crop: "Rice", pricePerQuintal: 2450, market: "Regional Mandi" }, { crop: "Banana", pricePerQuintal: 1710, market: "Wholesale Market" }] },
    "Uttar Pradesh": { Lucknow: [{ crop: "Wheat", pricePerQuintal: 2340, market: "Lucknow Mandi" }, { crop: "Rice", pricePerQuintal: 2470, market: "Grain Market" }, { crop: "Potato", pricePerQuintal: 1200, market: "Vegetable Market" }], Varanasi: [{ crop: "Rice", pricePerQuintal: 2450, market: "Varanasi Mandi" }, { crop: "Wheat", pricePerQuintal: 2335, market: "Regional Market" }, { crop: "Potato", pricePerQuintal: 1180, market: "Local Market" }], Kanpur: [{ crop: "Wheat", pricePerQuintal: 2320, market: "Kanpur Mandi" }, { crop: "Rice", pricePerQuintal: 2460, market: "Grain Market" }, { crop: "Potato", pricePerQuintal: 1210, market: "Wholesale Market" }], Agra: [{ crop: "Wheat", pricePerQuintal: 2310, market: "Agra Market" }, { crop: "Rice", pricePerQuintal: 2440, market: "Town Mandi" }, { crop: "Sugarcane", pricePerQuintal: 3350, market: "Local Market" }], Meerut: [{ crop: "Wheat", pricePerQuintal: 2345, market: "Meerut Mandi" }, { crop: "Rice", pricePerQuintal: 2465, market: "Regional Market" }, { crop: "Potato", pricePerQuintal: 1225, market: "Vegetable Market" }] }
  };

  const districtAliases = {
    "Bengaluru Urban": "Bengaluru",
    "Bengaluru Rural": "Bengaluru",
    "Shivamogga": "Shimoga"
  };
  const prices = priceMap[state]?.[districtAliases[district] || district] || [
    { crop: "Rice", pricePerQuintal: 2400, market: `${district} mandi` },
    { crop: "Wheat", pricePerQuintal: 2350, market: `${district} market` }
  ];

  res.json({
    location: `${district}, ${state}`,
    mode: "Market trend",
    message: `Local mandi conditions are steady for ${district}. Monitor transport and demand before selling.`,
    prices
  });
});

// Seed suggestions
app.get("/api/feedback", (req, res) => {
  const db = readDB();
  res.json(db.feedbacks || []);
});

app.post("/api/feedback", requireAuth, (req, res) => {
  const { category, rating, message } = req.body || {};

  if (!category || !message || !Number.isFinite(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
    return res.status(400).json({ error: "Please provide a valid category, rating, and feedback message." });
  }

  const db = readDB();
  const feedback = {
    id: Date.now(),
    category: String(category).trim(),
    rating: Number(rating),
    message: String(message).trim(),
    createdAt: new Date().toISOString()
  };

  db.feedbacks.push(feedback);
  saveDB(db);

  res.status(201).json({ message: "Feedback submitted successfully." });
});

app.get("/api/seeds", (req, res) => {
  res.json([
    {
      name: "Ragi",
      season: "Rainy season (Monsoon)",
      suggestion: "Suitable for many rain-fed areas; check local conditions."
    },
    {
      name: "Maize",
      season: "Rainy season (Monsoon) or Winter, depending on location",
      suggestion: "Choose a locally recommended variety and suitable planting time."
    },
    {
      name: "Green gram",
      season: "Season depends on local climate",
      suggestion: "Check soil drainage and local agricultural recommendations."
    },
    {
      name: "Tomato",
      season: "Depends on region and variety",
      suggestion: "Select disease-resistant seeds recommended for your area."
    }
  ]);
});

// Handle errors
app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(400).json({
    error: err.message || "Something went wrong."
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Smart Agriculture App running at http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other server or change PORT in .env.`
    );
  } else {
    console.error(err);
  }
});