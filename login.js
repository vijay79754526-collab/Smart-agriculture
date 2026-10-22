const $ = selector => document.querySelector(selector);

const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const passwordResetRequestForm = $("#passwordResetRequestForm");
const passwordResetCompleteForm = $("#passwordResetCompleteForm");
const authMessage = $("#authMessage");
const themeToggle = $("#themeToggle");
const resetParams = new URLSearchParams(window.location.search);
const resetIdFromLink = resetParams.get("resetId") || "";
const resetTokenFromLink = resetParams.get("token") || "";
const hasPasswordResetLink = /^[a-f0-9]{48}$/.test(resetIdFromLink) &&
  /^[a-f0-9]{64}$/.test(resetTokenFromLink);
let passwordResetIdentifier = "";

if (!hasPasswordResetLink && sessionStorage.getItem("agri-token") && sessionStorage.getItem("agri-user")) {
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

themeToggle.addEventListener("click", () => {
  setTheme(document.body.classList.contains("dark-theme") ? "light" : "dark");
});

$("#showLogin").addEventListener("click", () => {
  loginForm.hidden = false;
  registerForm.hidden = true;
  passwordResetRequestForm.hidden = true;
  passwordResetCompleteForm.hidden = true;
  $("#forgotPasswordBtn").hidden = false;
  $("#showLogin").classList.add("active");
  $("#showRegister").classList.remove("active");
  showMessage("");
});

$("#showRegister").addEventListener("click", () => {
  loginForm.hidden = true;
  registerForm.hidden = false;
  passwordResetRequestForm.hidden = true;
  passwordResetCompleteForm.hidden = true;
  $("#forgotPasswordBtn").hidden = true;
  $("#showRegister").classList.add("active");
  $("#showLogin").classList.remove("active");
  showMessage("");
});

$("#forgotPasswordBtn").addEventListener("click", () => {
  const resetEmailInput = $("#passwordResetRequestForm [name=identifier]");
  resetEmailInput.value = $("#loginForm [name=identifier]").value.trim();
  if (!resetEmailInput.checkValidity()) resetEmailInput.value = "";
  passwordResetIdentifier = resetEmailInput.value;
  loginForm.hidden = true;
  registerForm.hidden = true;
  passwordResetRequestForm.hidden = false;
  passwordResetCompleteForm.hidden = true;
  $("#forgotPasswordBtn").hidden = true;
  $("#showLogin").classList.add("active");
  $("#showRegister").classList.remove("active");
  showMessage("");
  resetEmailInput.focus();
});

$("#resetRequestBackBtn").addEventListener("click", () => {
  passwordResetRequestForm.hidden = true;
  passwordResetCompleteForm.hidden = true;
  loginForm.hidden = false;
  $("#forgotPasswordBtn").hidden = false;
  showMessage("");
});

$("#resetCompleteBackBtn").addEventListener("click", () => {
  passwordResetCompleteForm.reset();
  passwordResetCompleteForm.hidden = true;
  passwordResetRequestForm.hidden = false;
  showMessage("");
  passwordResetRequestForm.querySelector('[name="identifier"]').focus();
});

async function submitAuth(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
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
    loginForm.hidden = false;
    registerForm.hidden = true;
    $("#showLogin").classList.add("active");
    $("#showRegister").classList.remove("active");
    showMessage(result.message);
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
    window.location.assign("/dashboard");
  } catch (error) {
    showMessage(error.message);
  }
});

passwordResetRequestForm.addEventListener("submit", async event => {
  event.preventDefault();
  const button = passwordResetRequestForm.querySelector('button[type="submit"]');
  button.disabled = true;
  passwordResetIdentifier = new FormData(passwordResetRequestForm).get("identifier").trim();
  try {
    const result = await submitAuth("/api/password-reset/request", {
      identifier: passwordResetIdentifier
    });
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
  }
});

passwordResetCompleteForm.addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(passwordResetCompleteForm);
  if (form.get("newPassword") !== form.get("confirmPassword")) {
    showMessage("New password and confirmation do not match.");
    return;
  }

  const button = passwordResetCompleteForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = await submitAuth("/api/password-reset/complete", {
      resetId: form.get("resetId"),
      token: form.get("token"),
      newPassword: form.get("newPassword")
    });
    passwordResetCompleteForm.reset();
    passwordResetCompleteForm.hidden = true;
    loginForm.hidden = false;
    $("#forgotPasswordBtn").hidden = false;
    $("#loginForm [name=identifier]").value = result.loginIdentifier || passwordResetIdentifier;
    $("#loginForm [name=password]").value = "";
    if (result.loginIdentifier) {
      $("#loginForm [name=password]").focus();
    } else {
      $("#loginForm [name=identifier]").focus();
    }
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message);
  } finally {
    button.disabled = false;
  }
});

if (hasPasswordResetLink) {
  loginForm.hidden = true;
  registerForm.hidden = true;
  passwordResetRequestForm.hidden = true;
  passwordResetCompleteForm.hidden = false;
  passwordResetCompleteForm.querySelector('[name="resetId"]').value = resetIdFromLink;
  passwordResetCompleteForm.querySelector('[name="token"]').value = resetTokenFromLink;
  $("#passwordResetCompleteInstructions").textContent =
    window.agriI18n.translate("Choose a new password to finish resetting your account. This link expires in 10 minutes.");
  showMessage("");
  passwordResetCompleteForm.querySelector('[name="newPassword"]').focus();
  window.history.replaceState({}, "", "/reset-password");
} else if (resetParams.has("resetId") || resetParams.has("token")) {
  showMessage("The password reset link is invalid or expired. Request another reset.");
  window.history.replaceState({}, "", "/login");
}
