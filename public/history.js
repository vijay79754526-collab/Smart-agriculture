const token = sessionStorage.getItem("agri-token");
const list = document.querySelector("#dashboardHistoryList");
const message = document.querySelector("#historyMessage");
const deleteSelectedButton = document.querySelector("#deleteSelectedHistory");
const collectionLabels = {
  crops: "Crops and farm details",
  cropHistory: "Crop changes",
  expenses: "Farm expenses",
  irrigationRecords: "Irrigation records",
  readings: "Temperature and humidity readings",
  healthScans: "Crop health scans",
  soilTests: "Soil test reports",
  weatherRecords: "Weather records",
  activities: "Farm activity",
  feedbacks: "Saved information",
  marketPrices: "Market price records",
  searchHistory: "Saved recommendations and searches"
};
const hiddenHistoryFields = new Set(["id", "userid", "cropid", "requestkey", "token", "resetid", "resettoken"]);
const specialFieldLabels = {
  ph: "Soil pH",
  createdAt: "Date",
  updatedAt: "Updated"
};

if (!token || !sessionStorage.getItem("agri-user")) {
  window.location.replace("/login");
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not complete the request.");
  return data;
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("form-message-error", isError);
}

function selectedArchiveIds() {
  return Array.from(list.querySelectorAll('input[name="archiveId"]:checked'))
    .map(input => input.value);
}

function updateDeleteButton() {
  deleteSelectedButton.disabled = selectedArchiveIds().length === 0;
}

function historyFieldLabel(key) {
  return specialFieldLabels[key] ||
    key.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^./, letter => letter.toUpperCase());
}

function formatHistoryValue(value, fieldName = "") {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value.map(item => formatHistoryValue(item, fieldName)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([key, nestedValue]) =>
        !hiddenHistoryFields.has(key.toLowerCase()) &&
        nestedValue !== null && nestedValue !== undefined && nestedValue !== ""
      )
      .map(([key, nestedValue]) => `${historyFieldLabel(key)}: ${formatHistoryValue(nestedValue, key)}`)
      .join(" · ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" &&
      /(?:date|time|at)$/i.test(fieldName) &&
      /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  return String(value);
}

function appendArchiveDetails(container, records) {
  Object.entries(collectionLabels).forEach(([key, label]) => {
    const entries = records?.[key] || [];
    if (!entries.length) return;
    const section = document.createElement("section");
    section.className = "history-record-group";
    const heading = document.createElement("h4");
    heading.textContent = `${label} (${entries.length})`;
    section.appendChild(heading);
    entries.forEach((record, index) => {
      const card = document.createElement("article");
      card.className = "history-record";
      const recordHeading = document.createElement("h5");
      recordHeading.textContent = `Record ${index + 1}`;
      card.appendChild(recordHeading);
      const fields = document.createElement("dl");
      fields.className = "history-record-fields";
      Object.entries(record)
        .filter(([field, value]) =>
          !hiddenHistoryFields.has(field.toLowerCase()) &&
          value !== null && value !== undefined && value !== ""
        )
        .forEach(([field, value]) => {
          const term = document.createElement("dt");
          term.textContent = historyFieldLabel(field);
          const detail = document.createElement("dd");
          detail.textContent = formatHistoryValue(value, field) || "—";
          fields.append(term, detail);
        });
      if (fields.childElementCount) {
        card.appendChild(fields);
      } else {
        const empty = document.createElement("p");
        empty.textContent = "No displayable details for this record.";
        card.appendChild(empty);
      }
      section.appendChild(card);
    });
    container.appendChild(section);
  });
}

function renderArchive(archive) {
  const card = document.createElement("article");
  card.className = "panel dashboard-history-card";

  const header = document.createElement("div");
  header.className = "history-card-header";
  const heading = document.createElement("h3");
  heading.textContent = `Dashboard archived ${new Date(archive.createdAt).toLocaleString()}`;
  header.appendChild(heading);
  const selectionLabel = document.createElement("label");
  selectionLabel.className = "history-select";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "archiveId";
  checkbox.value = archive.id;
  checkbox.addEventListener("change", updateDeleteButton);
  selectionLabel.append(checkbox, document.createTextNode("Select"));
  header.appendChild(selectionLabel);
  card.appendChild(header);

  const counts = Object.entries(archive.recordCounts || {})
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${collectionLabels[key] || key}: ${count}`);
  const summary = document.createElement("p");
  summary.className = "history-record-summary";
  summary.textContent = counts.length ? counts.join(" · ") : "No records in this archive.";
  card.appendChild(summary);
  if (archive.restoredAt) {
    const restored = document.createElement("p");
    restored.className = "history-restored-note";
    restored.textContent = `Restored on ${new Date(archive.restoredAt).toLocaleString()}`;
    card.appendChild(restored);
  }

  const actions = document.createElement("div");
  actions.className = "history-card-actions";
  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.className = "secondary-btn";
  viewButton.textContent = "View Previous Data";
  const details = document.createElement("div");
  details.className = "history-archive-details";
  details.hidden = true;
  viewButton.addEventListener("click", async () => {
    if (!details.hidden) {
      details.hidden = true;
      viewButton.textContent = "View Previous Data";
      return;
    }
    viewButton.disabled = true;
    try {
      const entry = await api(`/api/dashboard-history/${encodeURIComponent(archive.id)}`);
      details.replaceChildren();
      appendArchiveDetails(details, entry.records);
      details.hidden = false;
      viewButton.textContent = "Hide Previous Data";
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      viewButton.disabled = false;
    }
  });
  actions.appendChild(viewButton);

  const restoreButton = document.createElement("button");
  restoreButton.type = "button";
  restoreButton.className = "primary-history-btn";
  restoreButton.textContent = archive.restoredAt ? "Already Restored" : "Restore Previous Data";
  restoreButton.disabled = Boolean(archive.restoredAt);
  restoreButton.addEventListener("click", async () => {
    if (!window.confirm("Restore these records to your active dashboard?")) return;
    restoreButton.disabled = true;
    try {
      const result = await api(
        `/api/dashboard-history/${encodeURIComponent(archive.id)}/restore`,
        { method: "POST" }
      );
      showMessage(result.message);
      await loadHistory();
    } catch (error) {
      showMessage(error.message, true);
      restoreButton.disabled = false;
    }
  });
  actions.appendChild(restoreButton);
  card.append(actions, details);
  list.appendChild(card);
}

async function loadHistory() {
  const entries = await api("/api/dashboard-history");
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "No archived dashboard data yet. Reset your dashboard to save its current records here.";
    list.appendChild(empty);
  } else {
    entries.forEach(renderArchive);
  }
  updateDeleteButton();
}

deleteSelectedButton.addEventListener("click", async () => {
  const ids = selectedArchiveIds();
  if (!ids.length || !window.confirm(
    `Permanently delete ${ids.length} selected history ${ids.length === 1 ? "entry" : "entries"}? This cannot be undone.`
  )) return;
  deleteSelectedButton.disabled = true;
  try {
    const result = await api("/api/dashboard-history", {
      method: "DELETE",
      body: JSON.stringify({ ids })
    });
    showMessage(`${result.deleted} history ${result.deleted === 1 ? "entry" : "entries"} deleted.`);
    await loadHistory();
  } catch (error) {
    showMessage(error.message, true);
    updateDeleteButton();
  }
});

loadHistory().catch(error => {
  list.replaceChildren();
  showMessage(error.message, true);
});
