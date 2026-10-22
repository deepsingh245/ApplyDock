// Settings view and theme: integrations, profile, Codex status, preferences. Uses core.js.

function renderSettings() {
  $("notion-form").elements.data_source_id.value = state.notion_data_source_id || "";
  $("notion-form").elements.token.value = "";
  $("notion-form").elements.token.placeholder = state.notion_connected ? "Saved securely · leave blank to keep" : "Paste integration token";
  $("notion-state").textContent = state.notion_sync_error ? "Needs attention" : state.notion_connected ? "Connected" : "Not connected";
  $("notion-sync-detail").textContent = state.notion_sync_error ? "Notion check: " + state.notion_sync_error : state.notion_sync_checked_at ? "Notion changes checked recently." : "Notion changes are checked while the local helper is open.";
  for (const name of ["host", "port", "username", "from"])
    $("smtp-form").elements[name].value = state.smtp?.[name] || (name === "port" ? "465" : "");
  $("smtp-form").elements.password.value = "";
  $("smtp-form").elements.password.placeholder = state.smtp_connected ? "Saved securely · leave blank to keep" : "Enter app password";
  $("smtp-state").textContent = state.smtp_connected ? "Configured" : "Not configured";
  $("gmail-state").textContent = state.gmail_connected ? "Connected" : state.gmail_client_ready ? "Configured" : "Setup needed";
  $("gmail-account").textContent = state.gmail_connected ? "Connected account: " + state.gmail_address : "Create drafts with attachments in your connected Gmail account.";
  $("gmail-client-info").textContent = state.gmail_client_ready ? "OAuth client saved: " + state.gmail_client_id : "No OAuth client saved yet.";
  $("gmail-connect-button").disabled = !state.gmail_client_ready;
  $("profile-form").elements.profile.value = state.candidate_profile || "";
  $("profile-state").textContent = state.profile_saved ? "Saved" : "Not saved";
  const codex = state.codex || {};
  $("codex-state").textContent = codex.connected ? "Connected" : !codex.checked && codex.installed ? "Not checked" : codex.installed ? "Sign in needed" : "Not installed";
  $("codex-state").classList.toggle("success", !!codex.connected);
  $("codex-detail").textContent = codex.connected
    ? "Connected to ChatGPT Plus through Codex. Uses your included Codex allowance; no API key is configured."
    : (codex.message || "Install Codex CLI and sign in with ChatGPT Plus.");
  $("codex-calls").textContent = state.ats_usage?.uncached_calls || 0;
  $("codex-cache").textContent = state.ats_usage?.cache_hits || 0;
  $("appearance-select").value = document.documentElement.dataset.theme || "light";
  $("default-resume-select").innerHTML = resumeOptions((state.resumes || []).find(resume => resume.is_default)?.id || "");
  $("notifications-toggle").checked = localStorage.getItem("applydock-notifications") !== "off";
  // Status chips: green when working, amber when the user needs to act, neutral otherwise.
  const tone = (id, value) => { $(id).classList.toggle("success", value === "success"); $(id).classList.toggle("warn", value === "warn"); };
  tone("codex-state", codex.connected ? "success" : "warn");
  tone("notion-state", state.notion_sync_error ? "warn" : state.notion_connected ? "success" : "warn");
  tone("smtp-state", state.smtp_connected ? "success" : "");
  tone("gmail-state", state.gmail_connected ? "success" : state.gmail_client_ready ? "warn" : "");
  tone("profile-state", state.profile_saved ? "success" : "");
}

function setTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem("applydock-theme", theme);
  if ($("appearance-select")) $("appearance-select").value = theme;
  $("theme-button").setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  $("theme-button").title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

function initializeSettingsDisclosures() {
  for (const card of document.querySelectorAll(".settings-grid > .view-card")) {
    card.classList.add("settings-config-card");
    const heading = card.querySelector(":scope > .card-heading");
    if (!heading || heading.querySelector(".settings-card-toggle")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-card-toggle";
    button.textContent = "Configure";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", () => {
      const expanded = card.classList.toggle("expanded");
      button.textContent = expanded ? "Close" : "Configure";
      button.setAttribute("aria-expanded", String(expanded));
    });
    heading.append(button);
  }
}

async function saveSettings(event, path, message) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("[type=submit]");
  button.disabled = true;
  try { await api(path, "POST", Object.fromEntries(new FormData(event.currentTarget).entries())); await load(); notify(message); }
  catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}
