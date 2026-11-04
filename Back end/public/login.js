const $ = selector => document.querySelector(selector);

const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const authMessage = $("#authMessage");
const themeToggle = $("#themeToggle");
const registerPrompt = $("#registerPrompt");
const resetParams = new URLSearchParams(window.location.search);
const registrationCompleted = resetParams.get("registered") === "1";
const registrationRequested = window.location.pathname === "/register" || resetParams.get("register") === "1";

if (sessionStorage.getItem("agri-token") && sessionStorage.getItem("agri-user")) {
  window.location.replace("/dashboard");
} else {
  sessionStorage.removeItem("agri-token");
  sessionStorage.removeItem("agri-user");
}

function showMessage(message) {
  authMessage.dataset.translationSource = message;
  authMessage.textContent = window.agriI18n.translate(message);
}

function updatePasswordToggle(button, visible) {
  const label = visible ? "Hide password" : "Show password";
  button.setAttribute("aria-label", window.agriI18n.translate(label));
  button.setAttribute("aria-pressed", String(visible));
  button.classList.toggle("is-visible", visible);
}

document.querySelectorAll(".password-toggle").forEach(button => {
  const password = button.parentElement.querySelector('input[type="password"], input[type="text"]');
  button.addEventListener("click", () => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    updatePasswordToggle(button, visible);
    password.focus();
  });
  updatePasswordToggle(button, false);
});

document.addEventListener("agri-language-change", () => {
  if (authMessage.dataset.translationSource) {
    showMessage(authMessage.dataset.translationSource);
  }
  document.querySelectorAll(".password-toggle").forEach(button => {
    updatePasswordToggle(button, button.getAttribute("aria-pressed") === "true");
  });
});

function setTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-theme", isDark);
  themeToggle.textContent = isDark ? "☀️" : "🌙";
  localStorage.setItem("agri-theme", theme);
}

setTheme(localStorage.getItem("agri-theme") || "light");
window.agriI18n.applyLanguage();

if (registrationCompleted) {
  loginForm.hidden = false;
  registerForm.hidden = true;
  registerPrompt.hidden = false;
  $("#showLogin").classList.add("active");
  $("#showRegister").classList.remove("active");
  showMessage("Registration Successful!");
} else if (registrationRequested) {
  loginForm.hidden = true;
  registerForm.hidden = false;
  registerPrompt.hidden = true;
  $("#showRegister").classList.add("active");
  $("#showLogin").classList.remove("active");
}

themeToggle.addEventListener("click", () => {
  setTheme(document.body.classList.contains("dark-theme") ? "light" : "dark");
});

$("#showLogin").addEventListener("click", () => {
  loginForm.hidden = false;
  registerForm.hidden = true;
  registerPrompt.hidden = false;
  $("#showLogin").classList.add("active");
  $("#showRegister").classList.remove("active");
  showMessage("");
});

$("#showRegister").addEventListener("click", () => {
  loginForm.hidden = true;
  registerForm.hidden = false;
  registerPrompt.hidden = true;
  $("#showRegister").classList.add("active");
  $("#showLogin").classList.remove("active");
  showMessage("");
});

$("#registerPrompt").addEventListener("click", () => {
  $("#showRegister").click();
});

async function submitAuth(url, body) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Cannot connect to the server. Check your internet connection and try again.");
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Unable to complete your request.");
  }

  return data;
}

registerForm.addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(registerForm);

  try {
    const result = await submitAuth("/api/register", {
      name: form.get("name"),
      email: form.get("email"),
      mobileNumber: form.get("mobileNumber"),
      password: form.get("password")
    });

    registerForm.reset();
    window.location.assign("/login?registered=1");
  } catch (error) {
    showMessage(error.message);
  }
});

loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(loginForm);

  try {
    const result = await submitAuth("/api/login", {
      identifier: form.get("identifier"),
      password: form.get("password")
    });

    sessionStorage.setItem("agri-token", result.token);
    sessionStorage.setItem("agri-user", JSON.stringify(result.user));
    const dashboardParams = new URLSearchParams({ login: "success" });
    if (result.isFirstLogin) dashboardParams.set("welcome", "1");
    window.location.assign(`/dashboard?${dashboardParams}`);
  } catch (error) {
    showMessage(error.message);
  }
});
