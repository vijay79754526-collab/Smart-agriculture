const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const agricultureServices = require("./Back end/agriculture-services");
const marketPrices = require("./Back end/market-prices");
const dotenv = require("dotenv");
const appEnvPath = path.join(__dirname, ".env");
const backendEnvPath = path.join(__dirname, "Back end", ".env");
dotenv.config({ path: appEnvPath });
if (fs.existsSync(backendEnvPath)) {
  const backendEnv = dotenv.parse(fs.readFileSync(backendEnvPath));
  for (const [key, value] of Object.entries(backendEnv)) {
    if (!["PORT", "PUBLIC_APP_URL", "RENDER_EXTERNAL_URL"].includes(key) &&
        process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const app = express();
const PORT = process.env.PORT || 3001;
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("A strong JWT_SECRET must be configured.");
}
const PASSWORD_RESET_CODE_SECRET = crypto
  .createHmac("sha256", JWT_SECRET)
  .update("smart-agriculture-password-reset")
  .digest();

// Folders and database
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, "data"));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, "uploads"));
const ROOT_DB_FILE = path.join(DATA_DIR, "db.json");
const BACKEND_DB_FILE = path.join(__dirname, "Back end", "data", "db.json");
function databaseHasUsers(file) {
  if (!fs.existsSync(file)) return false;
  const savedData = JSON.parse(fs.readFileSync(file, "utf8"));
  return Array.isArray(savedData.users) && savedData.users.length > 0;
}
const DB_FILE = !process.env.DATA_DIR &&
  databaseHasUsers(BACKEND_DB_FILE) &&
  !databaseHasUsers(ROOT_DB_FILE)
  ? BACKEND_DB_FILE
  : ROOT_DB_FILE;
const PASSWORD_RESET_CHALLENGES_FILE = path.join(DATA_DIR, "password-reset-challenges.json");
const users = [];
const passwordResetChallenges = new Map();
const passwordResetCooldowns = new Map();
const passwordResetIpAttempts = new Map();
const PASSWORD_RESET_TTL_MS = 5 * 60 * 1000;

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
  try {
    fs.renameSync(temporaryFile, PASSWORD_RESET_CHALLENGES_FILE);
  } catch (error) {
    if (!["EPERM", "EEXIST", "ENOTEMPTY"].includes(error.code)) {
      throw error;
    }
    fs.copyFileSync(temporaryFile, PASSWORD_RESET_CHALLENGES_FILE);
    fs.unlinkSync(temporaryFile);
  }
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
        challenge.method === "email-otp") {
      passwordResetChallenges.set(challengeId, challenge);
    }
  }
  persistPasswordResetChallenges();
}

// Create JSON database if missing
const DEFAULT_DB = {
  users: [],
  crops: [],
  cropHistory: [],
  expenses: [],
  irrigationRecords: [],
  readings: [],
  healthScans: [],
  soilTests: [],
  weatherRecords: [],
  activities: [],
  feedbacks: [],
  marketPrices: [],
  marketPriceSnapshots: [],
  searchHistory: [],
  dashboardArchives: [],
  weatherAlerts: []
};
const ARCHIVABLE_COLLECTIONS = [
  "crops",
  "cropHistory",
  "expenses",
  "irrigationRecords",
  "readings",
  "healthScans",
  "soilTests",
  "weatherRecords",
  "activities",
  "feedbacks",
  "marketPrices",
  "searchHistory",
  "weatherAlerts"
];

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
    mobileNumber: user.mobileNumber || "",
    state: user.state || "",
    district: user.district || ""
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

async function sendPasswordResetCode(email, code) {
  if (!isEmailConfigured()) {
    throw new Error("Email password reset is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in Back end/.env.");
  }

  const requestedAt = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  }).format(new Date());
  try {
    const result = await createSmtpTransporter().sendMail({
      from: process.env.SMTP_FROM,
      to: email,
      subject: `Your Smart Agriculture password reset code - ${requestedAt} IST`,
      text: `Your password reset code is ${code}. It expires in 5 minutes and can only be used once. If you did not request this, you can ignore this email.`,
      html: `<p>Your Smart Agriculture password reset code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>This code expires in 5 minutes and can only be used once. If you did not request this, you can ignore this email.</p>`,
      textEncoding: "quoted-printable"
    });
    if (!Array.isArray(result.accepted) ||
        !result.accepted.some(address => String(address).toLowerCase() === email.toLowerCase())) {
      throw new Error("The SMTP server did not accept the reset email recipient.");
    }
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

app.get("/register", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/reset-password", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "reset-password.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/recommendation-form", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "recommendation-form.html"));
});

app.get("/recommendation-results", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "recommendation-results.html"));
});

app.get("/manage-crops", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "manage-crops.html"));
});

app.get("/crop-history", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "crop-history.html"));
});

app.get("/history", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "history.html"));
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
    "irrigation-management",
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
  if (removedExpiredChallenges) {
    try {
      persistPasswordResetChallenges();
    } catch (error) {
      console.error("Expired password reset challenges could not be removed:", error.message);
      return res.status(503).json({ error: "Password reset is temporarily unavailable. Please try again later." });
    }
  }
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
  if (ipAttempts.length >= 50) {
    return res.status(429).json({ error: "Too many password reset requests. Please try again later." });
  }
  ipAttempts.push(now);
  passwordResetIpAttempts.set(ipAddress, ipAttempts);

  const identifierHash = crypto.createHash("sha256").update(normalizedEmail).digest("hex");
  const cooldownKey = identifierHash;
  if (passwordResetCooldowns.has(cooldownKey)) {
    return res.status(429).json({ error: "Please wait before requesting another password reset." });
  }
  passwordResetCooldowns.set(cooldownKey, now + 60 * 1000);

  const db = readDB();
  const account = [...db.users, ...users].find(user =>
    String(user.email || "").toLowerCase() === normalizedEmail
  );
  const challengeId = crypto.randomBytes(24).toString("hex");
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  for (const [activeId, activeChallenge] of passwordResetChallenges) {
    if (account && activeChallenge.userId === String(account.id)) {
      passwordResetChallenges.delete(activeId);
    }
  }
  passwordResetChallenges.set(challengeId, {
    userId: account ? String(account.id) : null,
    method: "email-otp",
    codeHash: passwordResetCodeHash(challengeId, code),
    resetTokenHash: null,
    expiresAt: now + PASSWORD_RESET_TTL_MS,
    attempts: 0
  });
  try {
    persistPasswordResetChallenges();
  } catch (error) {
    passwordResetChallenges.delete(challengeId);
    passwordResetCooldowns.delete(cooldownKey);
    console.error("Password reset challenge could not be saved:", error.message);
    return res.status(503).json({ error: "Password reset is temporarily unavailable. Please try again later." });
  }

  if (account) {
    try {
      await sendPasswordResetCode(normalizedEmail, code);
    } catch (error) {
      passwordResetChallenges.delete(challengeId);
      try {
        persistPasswordResetChallenges();
      } catch (persistError) {
        console.error("Failed password reset challenge could not be removed:", persistError.message);
      }
      passwordResetCooldowns.delete(cooldownKey);
      return res.status(503).json({
        error: error.message || "We could not send the password reset code. Check your delivery settings and try again."
      });
    }
  }

  res.json({
    resetId: challengeId,
    message: "If an account matches those details, a 6-digit reset code has been sent. It expires in 5 minutes."
  });
});

app.post("/api/password-reset/verify", (req, res) => {
  const resetId = String(req.body?.resetId || "");
  const code = String(req.body?.code || "").trim();
  if (!/^[a-f0-9]{48}$/.test(resetId) || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the 6-digit code from your email." });
  }

  const challenge = passwordResetChallenges.get(resetId);
  if (!challenge || challenge.method !== "email-otp" ||
      challenge.expiresAt <= Date.now() || !challenge.userId ||
      challenge.resetTokenHash) {
    return res.status(400).json({ error: "The reset code is invalid or expired. Request a new code." });
  }

  challenge.attempts += 1;
  const submittedHash = Buffer.from(passwordResetCodeHash(resetId, code), "hex");
  const storedHash = Buffer.from(String(challenge.codeHash || ""), "hex");
  const codeIsValid = storedHash.length === submittedHash.length &&
    crypto.timingSafeEqual(submittedHash, storedHash);
  if (challenge.attempts > 5 || !codeIsValid) {
    if (challenge.attempts >= 5) passwordResetChallenges.delete(resetId);
    try {
      persistPasswordResetChallenges();
    } catch (error) {
      console.error("Password reset attempts could not be saved:", error.message);
      return res.status(503).json({ error: "Password reset is temporarily unavailable. Please try again later." });
    }
    return res.status(400).json({ error: "The reset code is invalid or expired. Request a new code." });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  challenge.codeHash = null;
  challenge.resetTokenHash = passwordResetTokenHash(resetId, resetToken);
  challenge.verifiedAt = Date.now();
  try {
    persistPasswordResetChallenges();
  } catch (error) {
    console.error("Verified password reset challenge could not be saved:", error.message);
    return res.status(503).json({ error: "Password reset is temporarily unavailable. Please try again later." });
  }
  res.json({ resetToken });
});

app.post("/api/password-reset/complete", (req, res) => {
  const resetId = String(req.body?.resetId || "");
  const resetToken = String(req.body?.resetToken || "");
  const newPassword = String(req.body?.newPassword || "");
  const confirmPassword = String(req.body?.confirmPassword || "");

  if (!/^[a-f0-9]{48}$/.test(resetId) || !/^[a-f0-9]{64}$/.test(resetToken) ||
      newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ error: "Enter a valid reset code and a new password with 8 to 72 bytes." });
  }
  if (confirmPassword && newPassword !== confirmPassword) {
    return res.status(400).json({ error: "New password and confirmation do not match." });
  }
  const challenge = passwordResetChallenges.get(resetId);
  if (!challenge || challenge.method !== "email-otp" ||
      challenge.expiresAt <= Date.now() || !challenge.userId ||
      !challenge.verifiedAt) {
    passwordResetChallenges.delete(resetId);
    try {
      persistPasswordResetChallenges();
    } catch (error) {
      console.error("Expired password reset challenge could not be removed:", error.message);
      return res.status(503).json({ error: "Password reset is temporarily unavailable. Please try again later." });
    }
    return res.status(400).json({ error: "The reset code is invalid or expired. Request a new code." });
  }

  const submittedHash = Buffer.from(passwordResetTokenHash(resetId, resetToken), "hex");
  const storedHash = Buffer.from(String(challenge.resetTokenHash || ""), "hex");
  if (storedHash.length !== submittedHash.length ||
      !crypto.timingSafeEqual(submittedHash, storedHash)) {
    return res.status(400).json({ error: "The reset verification has expired. Verify your code again." });
  }

  const db = readDB();
  let user = db.users.find(entry => String(entry.id) === challenge.userId);
  if (!user) {
    user = users.find(entry => String(entry.id) === challenge.userId);
    if (user) db.users.push(user);
  }
  if (!user) {
    passwordResetChallenges.delete(resetId);
    try {
      persistPasswordResetChallenges();
    } catch (error) {
      console.error("Invalid password reset challenge could not be removed:", error.message);
      return res.status(503).json({ error: "Password reset is temporarily unavailable. Please try again later." });
    }
    return res.status(400).json({ error: "The reset code is invalid or expired. Request a new code." });
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  saveDB(db);
  for (const [challengeId, activeChallenge] of passwordResetChallenges) {
    if (activeChallenge.userId === challenge.userId) {
      passwordResetChallenges.delete(challengeId);
    }
  }
  try {
    persistPasswordResetChallenges();
  } catch (error) {
    console.error("Completed password reset challenge could not be removed:", error.message);
    return res.status(503).json({ error: "Password reset completed, but its verification could not be invalidated. Contact support." });
  }
  res.json({
    message: "Password reset successfully. Please log in with your new password.",
    loginIdentifier: user.email
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
  const state = String(req.body?.state || "").trim();
  const district = String(req.body?.district || "").trim();
  if ((state && (state.length > 80 || !district || district.length > 80)) ||
      (!state && district)) {
    return res.status(400).json({ error: "Select both a state and district, or leave both blank." });
  }
  user.state = state;
  user.district = district;
  saveDB(db);
  void checkWeatherForUser(user);
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

app.get("/api/search-history/:id", requireAuth, (req, res) => {
  const entry = readDB().searchHistory.find(item =>
    item.id === req.params.id && String(item.userId) === String(req.user.id)
  );
  if (!entry) {
    return res.status(404).json({ error: "Saved work was not found." });
  }
  res.json(entry);
});

app.post("/api/search-history", requireAuth, (req, res) => {
  const { feature, summary, query, result } = req.body || {};
  const allowedFeatures = [
    "crop-recommendations", "disease-guidance", "soil-testing",
    "weather-management", "market-prices"
  ];
  if (!allowedFeatures.includes(feature) || typeof summary !== "string" ||
      !summary.trim() || summary.length > 160 ||
      !query || typeof query !== "object" || Array.isArray(query) ||
      JSON.stringify(query).length > 4000 ||
      (result !== undefined &&
        (!result || typeof result !== "object" || Array.isArray(result) ||
          JSON.stringify(result).length > 12000))) {
    return res.status(400).json({ error: "The search details are invalid or too long to save." });
  }

  const db = readDB();
  const entry = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    feature,
    summary: summary.trim(),
    query,
    ...(result === undefined ? {} : { result }),
    createdAt: new Date().toISOString()
  };
  db.searchHistory.push(entry);
  if (result && feature === "weather-management") {
    db.weatherRecords.push({
      ...result,
      id: crypto.randomUUID(),
      userId: req.user.id,
      state: String(query.State || query.state || ""),
      district: String(query.District || query.district || ""),
      createdAt: entry.createdAt
    });
  }
  if (result && feature === "market-prices") {
    db.marketPrices.push({
      ...result,
      id: crypto.randomUUID(),
      userId: req.user.id,
      state: String(query.State || query.state || ""),
      district: String(query.District || query.district || ""),
      createdAt: entry.createdAt
    });
  }
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
app.get("/api/dashboard", requireAuth, (req, res) => {
  const db = readDB();
  const belongsToUser = item => String(item.userId) === String(req.user.id);
  const activeCrops = db.crops.filter(crop =>
    belongsToUser(crop) && (crop.status || "Active") === "Active"
  );

  res.json({
    totalCrops: activeCrops.length,
    activeCrops,
    totalExpenses: db.expenses.filter(belongsToUser).reduce(
      (sum, item) => sum + Number(item.amount || 0), 0
    ),
    totalSoilTests: db.soilTests.filter(belongsToUser).length,
    totalReadings: db.readings.filter(belongsToUser).length,
    totalHealthScans: db.healthScans.filter(belongsToUser).length,
    totalIrrigationRecords: db.irrigationRecords.filter(belongsToUser).length,
    completedCropChecks: db.searchHistory.filter(entry =>
      belongsToUser(entry) && entry.feature === "crop-recommendations" && entry.result
    ).length
  });
});

app.post("/api/dashboard/reset", requireAuth, (req, res) => {
  const db = readDB();
  const records = {};
  let totalRecords = 0;
  ARCHIVABLE_COLLECTIONS.forEach(collection => {
    records[collection] = db[collection].filter(
      entry => String(entry.userId) === String(req.user.id)
    );
    totalRecords += records[collection].length;
  });
  if (!totalRecords) {
    return res.json({ message: "Your dashboard is already empty. Nothing needed to be reset." });
  }

  const archive = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    createdAt: new Date().toISOString(),
    records
  };
  db.dashboardArchives.push(archive);
  ARCHIVABLE_COLLECTIONS.forEach(collection => {
    db[collection] = db[collection].filter(
      entry => String(entry.userId) !== String(req.user.id)
    );
  });
  saveDB(db);
  res.status(201).json({
    message: "Dashboard data was archived and the active dashboard was reset.",
    archive: { id: archive.id, createdAt: archive.createdAt, totalRecords }
  });
});

app.get("/api/dashboard-history", requireAuth, (req, res) => {
  const archives = readDB().dashboardArchives
    .filter(entry => String(entry.userId) === String(req.user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(entry => ({
      id: entry.id,
      createdAt: entry.createdAt,
      restoredAt: entry.restoredAt || null,
      recordCounts: Object.fromEntries(ARCHIVABLE_COLLECTIONS.map(collection => [
        collection,
        (entry.records?.[collection] || []).length
      ]))
    }));
  res.json(archives);
});

app.get("/api/dashboard-history/:id", requireAuth, (req, res) => {
  const archive = readDB().dashboardArchives.find(entry =>
    entry.id === req.params.id &&
    String(entry.userId) === String(req.user.id)
  );
  if (!archive) return res.status(404).json({ error: "Archived dashboard was not found." });
  res.json(archive);
});

app.post("/api/dashboard-history/:id/restore", requireAuth, (req, res) => {
  const db = readDB();
  const archive = db.dashboardArchives.find(entry =>
    entry.id === req.params.id &&
    String(entry.userId) === String(req.user.id)
  );
  if (!archive) return res.status(404).json({ error: "Archived dashboard was not found." });
  if (archive.restoredAt) {
    return res.status(409).json({ error: "This archived dashboard has already been restored." });
  }

  const cropIdMap = new Map();
  (archive.records?.crops || []).forEach(crop => {
    cropIdMap.set(String(crop.id), crypto.randomUUID());
  });
  let restoredCount = 0;
  ARCHIVABLE_COLLECTIONS.forEach(collection => {
    (archive.records?.[collection] || []).forEach(record => {
      const restored = { ...record, userId: req.user.id };
      if (restored.id !== undefined) restored.id = crypto.randomUUID();
      if (collection === "crops") restored.requestKey = crypto.randomUUID();
      if (collection === "cropHistory" && cropIdMap.has(String(restored.cropId))) {
        restored.cropId = cropIdMap.get(String(restored.cropId));
      }
      db[collection].push(restored);
      restoredCount += 1;
    });
  });
  archive.restoredAt = new Date().toISOString();
  saveDB(db);
  res.json({ message: "Archived dashboard data was restored.", restoredCount });
});

app.delete("/api/dashboard-history", requireAuth, (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 ||
      ids.some(id => typeof id !== "string" || id.length > 80)) {
    return res.status(400).json({ error: "Select one or more valid history entries." });
  }
  const selectedIds = new Set(ids);
  const db = readDB();
  const before = db.dashboardArchives.length;
  db.dashboardArchives = db.dashboardArchives.filter(entry =>
    String(entry.userId) !== String(req.user.id) || !selectedIds.has(entry.id)
  );
  const deleted = before - db.dashboardArchives.length;
  saveDB(db);
  res.json({ deleted });
});

// Get crops
app.get("/api/crops", requireAuth, (req, res) => {
  res.json(readDB().crops.filter(crop => String(crop.userId) === String(req.user.id)));
});

function validateCropDetails(body) {
  const name = String(body.name || "").trim();
  const area = Number(body.area);
  const state = String(body.state || "").trim();
  const district = String(body.district || "").trim();
  const soilType = String(body.soilType || "").trim();
  const plantingDate = String(body.plantingDate || "").trim();
  const expectedHarvestDate = String(body.expectedHarvestDate || "").trim();
  const irrigationType = String(body.irrigationType || "").trim();
  const fertilizerDetails = String(body.fertilizerDetails || "").trim();
  const status = String(body.status || "Active").trim();
  const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
  const isValidDate = value => {
    if (!value) return true;
    if (!dateOnlyPattern.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };

  if (!name || name.length > 80 || !Number.isFinite(area) || area <= 0 || area > 1000000) {
    return { error: "Enter a crop name and a valid land area greater than zero." };
  }
  if ([state, district, soilType, irrigationType, fertilizerDetails]
    .some(value => value.length > 160) ||
      !["Active", "Planned", "Harvested", "Paused"].includes(status)) {
    return { error: "Some crop details are too long or the crop status is invalid." };
  }
  if (!isValidDate(plantingDate) || !isValidDate(expectedHarvestDate) ||
      (plantingDate && expectedHarvestDate && expectedHarvestDate < plantingDate)) {
    return { error: "Enter valid planting and harvest dates; harvest cannot be before planting." };
  }

  return {
    value: {
      name,
      area,
      state,
      district,
      soilType,
      plantingDate,
      expectedHarvestDate,
      irrigationType,
      fertilizerDetails,
      status,
      type: String(body.type || "").trim().slice(0, 80),
      category: String(body.category || "").trim().slice(0, 80),
      season: String(body.season || "").trim().slice(0, 40)
    }
  };
}

// Add crop
app.post("/api/crops", requireAuth, (req, res) => {
  const validated = validateCropDetails(req.body || {});
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const db = readDB();
  const requestKey = String(req.body.requestKey || "").trim();
  if (requestKey.length > 100) {
    return res.status(400).json({ error: "The crop submission key is invalid." });
  }
  if (requestKey) {
    const existing = db.crops.find(crop =>
      String(crop.userId) === String(req.user.id) && crop.requestKey === requestKey
    );
    if (existing) return res.json(existing);
  }

  const crop = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    ...validated.value,
    requestKey: requestKey || crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };

  db.crops.push(crop);
  saveDB(db);

  res.status(201).json(crop);
});

app.put("/api/crops/:id", requireAuth, (req, res) => {
  const validated = validateCropDetails(req.body || {});
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  const db = readDB();
  const crop = db.crops.find(entry =>
    String(entry.id) === req.params.id &&
    String(entry.userId) === String(req.user.id)
  );
  if (!crop) {
    return res.status(404).json({ error: "Crop not found." });
  }

  const previous = {
    name: crop.name,
    area: Number(crop.area || 0),
    state: crop.state || "",
    district: crop.district || "",
    soilType: crop.soilType || "",
    plantingDate: crop.plantingDate || "",
    expectedHarvestDate: crop.expectedHarvestDate || "",
    irrigationType: crop.irrigationType || "",
    fertilizerDetails: crop.fertilizerDetails || "",
    status: crop.status || "Active"
  };
  const updated = { ...crop, ...validated.value, updatedAt: new Date().toISOString() };
  const changes = Object.keys(previous).filter(key => previous[key] !== updated[key]);

  if (changes.length) {
    db.cropHistory.push({
      id: crypto.randomUUID(),
      userId: req.user.id,
      cropId: crop.id,
      previousCrop: previous,
      newCrop: {
        name: updated.name,
        area: updated.area,
        state: updated.state,
        district: updated.district,
        soilType: updated.soilType,
        plantingDate: updated.plantingDate,
        expectedHarvestDate: updated.expectedHarvestDate,
        irrigationType: updated.irrigationType,
        fertilizerDetails: updated.fertilizerDetails,
        status: updated.status
      },
      changedFields: changes,
      changedAt: updated.updatedAt
    });
    Object.assign(crop, updated);
    saveDB(db);
  }

  res.json({ crop: updated, message: "Crop details updated successfully!" });
});

app.get("/api/crop-history", requireAuth, (req, res) => {
  const history = readDB().cropHistory
    .filter(entry => String(entry.userId) === String(req.user.id))
    .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
  res.json(history);
});

// Delete crop
app.delete("/api/crops/:id", requireAuth, (req, res) => {
  const db = readDB();
  const crop = db.crops.find(entry =>
    String(entry.id) === req.params.id &&
    String(entry.userId) === String(req.user.id)
  );
  if (!crop) {
    return res.status(404).json({ error: "Crop not found." });
  }

  db.crops = db.crops.filter(entry => entry !== crop);
  saveDB(db);
  res.json({ message: "Crop deleted successfully." });
});

// Get expenses
app.get("/api/expenses", requireAuth, (req, res) => {
  res.json(readDB().expenses.filter(expense => String(expense.userId) === String(req.user.id)));
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
    userId: req.user.id,
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
app.post("/api/field-readings", requireAuth, (req, res) => {
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
    userId: req.user.id,
    temperature: Number(temperature),
    humidity: Number(humidity),
    date: new Date().toISOString()
  };

  db.readings.push(reading);
  saveDB(db);

  res.status(201).json(reading);
});

app.post("/api/disease", requireAuth, upload.single("leaf"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Upload a clear leaf image for AI disease detection." });
  }
  try {
    const { result, scan } = await agricultureServices.detectDisease(
      req.file.path,
      req.user.id,
      String(req.body.crop || "").trim()
    );
    const db = readDB();
    db.healthScans.push(scan);
    saveDB(db);
    res.status(201).json({ ...result, result: result.healthy ? "Healthy leaf" : result.diseaseName });
  } catch (error) {
    if (!error.status || error.status >= 500) {
      console.error(`AI disease assessment failed: ${error.message}`);
    }
    res.status(error.status || 502).json({ error: error.message });
  } finally {
    try {
      await fs.promises.unlink(req.file.path);
    } catch (error) {
      if (error.code !== "ENOENT") console.error(`Uploaded image cleanup failed: ${error.message}`);
    }
  }
});

app.get("/api/irrigation", requireAuth, (req, res) => {
  const records = readDB().irrigationRecords
    .filter(entry => String(entry.userId) === String(req.user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(records);
});

app.post("/api/irrigation", requireAuth, (req, res) => {
  const crop = String(req.body?.crop || "").trim();
  const method = String(req.body?.method || "").trim();
  const amount = Number(req.body?.amount);
  const unit = String(req.body?.unit || "mm").trim();
  const notes = String(req.body?.notes || "").trim();
  if (!crop || crop.length > 80 || !method || method.length > 80 ||
      !Number.isFinite(amount) || amount <= 0 || amount > 100000 ||
      !["mm", "litres", "hours"].includes(unit) || notes.length > 500) {
    return res.status(400).json({ error: "Enter valid crop, irrigation method, amount, and notes." });
  }

  const db = readDB();
  const record = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    crop,
    method,
    amount,
    unit,
    notes,
    createdAt: new Date().toISOString()
  };
  db.irrigationRecords.push(record);
  saveDB(db);
  res.status(201).json(record);
});

app.delete("/api/irrigation/:id", requireAuth, (req, res) => {
  const db = readDB();
  const record = db.irrigationRecords.find(entry =>
    entry.id === req.params.id &&
    String(entry.userId) === String(req.user.id)
  );
  if (!record) return res.status(404).json({ error: "Irrigation record not found." });
  db.irrigationRecords = db.irrigationRecords.filter(entry => entry !== record);
  saveDB(db);
  res.json({ message: "Irrigation record deleted." });
});

app.post("/api/soil", requireAuth, (req, res) => {
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

  const record = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    ph: soilPH,
    nitrogen: nitrogenValue,
    phosphorus: phosphorusValue,
    potassium: potassiumValue,
    moisture: moistureValue,
    state: String(req.body.state || "").trim(),
    district: String(req.body.district || "").trim(),
    guidance,
    createdAt: new Date().toISOString()
  };
  const db = readDB();
  db.soilTests.push(record);
  saveDB(db);
  res.status(201).json({ guidance, record });
});

app.get("/api/soil", requireAuth, (req, res) => {
  const records = readDB().soilTests
    .filter(entry => String(entry.userId) === String(req.user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(records);
});

app.get("/api/weather", requireAuth, async (req, res) => {
  const user = findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "User profile not found. Please sign in again." });
  const state = String(req.query.state || user?.state || "").trim();
  const district = String(req.query.district || user?.district || "").trim();
  if (!state || !district) {
    return res.status(400).json({ error: "Save a state and district in your profile or select them to view weather." });
  }
  try {
    const weather = await agricultureServices.getWeather(state, district);
    if (state === user.state && district === user.district) {
      agricultureServices.persistWeatherAlerts(user, weather, readDB, saveDB);
    }
    res.json(weather);
  } catch (error) {
    console.error(`Weather lookup failed for ${district}, ${state}: ${error.message}`);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/weather-alerts", requireAuth, (req, res) => {
  const alerts = readDB().weatherAlerts
    .filter(alert => String(alert.userId) === String(req.user.id))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 30);
  res.json(alerts);
});

app.post("/api/weather-alerts/:id/read", requireAuth, (req, res) => {
  const db = readDB();
  const alert = db.weatherAlerts.find(entry =>
    entry.id === req.params.id && String(entry.userId) === String(req.user.id)
  );
  if (!alert) return res.status(404).json({ error: "Weather alert not found." });
  alert.readAt = alert.readAt || new Date().toISOString();
  saveDB(db);
  res.json(alert);
});

app.post("/api/crop-recommendations", requireAuth, async (req, res) => {
  const { season } = req.body || {};
  const state = String(req.body?.state || "").trim();
  const district = String(req.body?.district || "").trim();
  const soilPH = Number(req.body?.ph);
  const nitrogen = Number(req.body?.nitrogen);
  const phosphorus = Number(req.body?.phosphorus);
  const potassium = Number(req.body?.potassium);
  const soilType = String(req.body?.soilType || "").trim().toLowerCase();
  if (!["Monsoon", "Winter", "Summer"].includes(season)) {
    return res.status(400).json({ error: "Select a valid planting season." });
  }
  if (!state || !district || !Number.isFinite(soilPH) || soilPH < 0 || soilPH > 14 ||
      [nitrogen, phosphorus, potassium].some(value => !Number.isFinite(value) || value < 0) ||
      !["heavy", "medium", "light", "organic"].includes(soilType)) {
    return res.status(400).json({ error: "Enter valid NPK values, soil pH, soil texture, season, state, and district." });
  }
  try {
    const weather = await agricultureServices.getWeather(state, district);
    const annualRainfallMm = await agricultureServices.getAnnualRainfall(weather);
    const result = agricultureServices.recommendCrops({
      season, state, district, ph: soilPH, nitrogen, phosphorus, potassium, soilType
    }, weather, annualRainfallMm);
    res.json(result);
  } catch (error) {
    console.error(`Crop recommendation data lookup failed for ${district}, ${state}: ${error.message}`);
    res.status(502).json({ error: error.message });
  }
});

app.get("/api/market", async (req, res) => {
  const report = await marketPrices.getMarketPriceReport({
    crop: String(req.query.crop || ""),
    state: String(req.query.state || ""),
    district: String(req.query.district || ""),
    apiKey: process.env.DATA_GOV_IN_API_KEY,
    readDB,
    saveDB
  });
  res.json(report);
});

app.get("/api/market-sample", (req, res) => {
  res.status(410).json({
    error: "Sample market prices have been removed. Only official government observations are shown."
  });
});

let weatherCheckInProgress = false;
async function checkWeatherForUser(user) {
  if (!user.state || !user.district) return;
  try {
    const weather = await agricultureServices.getWeather(user.state, user.district);
    agricultureServices.persistWeatherAlerts(user, weather, readDB, saveDB);
  } catch (error) {
    console.error(`Weather check failed for ${user.district}, ${user.state}: ${error.message}`);
  }
}

async function checkWeatherForSavedLocations() {
  if (weatherCheckInProgress) return;
  weatherCheckInProgress = true;
  try {
    const savedUsers = readDB().users.filter(user => user.state && user.district);
    for (const user of savedUsers) {
      await checkWeatherForUser(user);
    }
  } finally {
    weatherCheckInProgress = false;
  }
}

// Handle errors
app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(400).json({
    error: err.message || "The request could not be completed."
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Smart Agriculture App running at http://localhost:${PORT}`);
  void checkWeatherForSavedLocations();
  setInterval(checkWeatherForSavedLocations, 60 * 60 * 1000).unref();
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