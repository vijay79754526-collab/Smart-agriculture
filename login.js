const $ = selector => document.querySelector(selector);

const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const authMessage = $("#authMessage");
const themeToggle = $("#themeToggle");

// Check existing login session
if (
  sessionStorage.getItem("agri-token") &&
  sessionStorage.getItem("agri-user")
) {
  window.location.replace("/dashboard");
}

function showMessage(message) {
  authMessage.dataset.translationSource = message;
  authMessage.textContent = window.agriI18n.translate(message);
}

// Show and hide password
function updatePasswordToggle(button, visible) {
  const label = visible ? "Hide password" : "Show password";

  button.setAttribute(
    "aria-label",
    window.agriI18n.translate(label)
  );

  button.setAttribute("aria-pressed", String(visible));
  button.classList.toggle("is-visible", visible);
}

document.querySelectorAll(".password-toggle").forEach(button => {
  const password = button.parentElement.querySelector(
    'input[type="password"], input[type="text"]'
  );

  button.addEventListener("click", () => {
    const visible = password.type === "password";

    password.type = visible ? "text" : "password";

    updatePasswordToggle(button, visible);
    password.focus();
  });

  updatePasswordToggle(button, false);
});

// Language translation
document.addEventListener("agri-language-change", () => {
  if (authMessage.dataset.translationSource) {
    showMessage(authMessage.dataset.translationSource);
  }

  document.querySelectorAll(".password-toggle").forEach(button => {
    updatePasswordToggle(
      button,
      button.getAttribute("aria-pressed") === "true"
    );
  });
});

// Theme settings
function setTheme(theme) {
  const isDark = theme === "dark";

  document.body.classList.toggle("dark-theme", isDark);

  themeToggle.textContent = isDark ? "☀️" : "🌙";

  localStorage.setItem("agri-theme", theme);
}

setTheme(localStorage.getItem("agri-theme") || "light");

window.agriI18n.applyLanguage();

themeToggle.addEventListener("click", () => {
  setTheme(
    document.body.classList.contains("dark-theme")
      ? "light"
      : "dark"
  );
});

// Switch to Login
$("#showLogin").addEventListener("click", () => {
  loginForm.hidden = false;
  registerForm.hidden = true;

  $("#showLogin").classList.add("active");
  $("#showRegister").classList.remove("active");

  showMessage("");
});

// Switch to Registration
$("#showRegister").addEventListener("click", () => {
  loginForm.hidden = true;
  registerForm.hidden = false;

  $("#showRegister").classList.add("active");
  $("#showLogin").classList.remove("active");

  showMessage("");
});

// API request function
async function submitAuth(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || "Unable to complete your request."
    );
  }

  return data;
}

// Registration
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

    loginForm.hidden = false;
    registerForm.hidden = true;

    $("#showLogin").classList.add("active");
    $("#showRegister").classList.remove("active");

    showMessage(result.message);

  } catch (error) {
    showMessage(error.message);
  }
});

// Login
loginForm.addEventListener("submit", async event => {
  event.preventDefault();

  const form = new FormData(loginForm);

  try {
    const result = await submitAuth("/api/login", {
      identifier: form.get("identifier"),
      password: form.get("password")
    });

    sessionStorage.setItem("agri-token", result.token);

    sessionStorage.setItem(
      "agri-user",
      JSON.stringify(result.user)
    );

    window.location.assign("/dashboard");

  } catch (error) {
    showMessage(error.message);
  }
});