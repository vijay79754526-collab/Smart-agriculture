const token = sessionStorage.getItem("agri-token");
const list = document.querySelector("#cropHistoryList");
const message = document.querySelector("#historyMessage");

if (!token || !sessionStorage.getItem("agri-user")) {
  window.location.replace("/login");
}

async function loadHistory() {
  const response = await fetch("/api/crop-history", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const history = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(history.error || "Could not load crop history.");
  }

  list.replaceChildren();
  if (!history.length) {
    const empty = document.createElement("article");
    empty.className = "panel";
    empty.textContent = "No crop history found";
    list.appendChild(empty);
    return;
  }

  history.forEach(entry => {
    const card = document.createElement("article");
    card.className = "panel crop-history-card";
    const heading = document.createElement("h3");
    heading.textContent = `${entry.previousCrop.name} → ${entry.newCrop.name}`;
    card.appendChild(heading);

    const changedAt = document.createElement("p");
    changedAt.className = "crop-history-date";
    changedAt.textContent = new Date(entry.changedAt).toLocaleString();
    card.appendChild(changedAt);

    const detailGrid = document.createElement("div");
    detailGrid.className = "crop-history-details";
    [
      ["Previous crop details", entry.previousCrop],
      ["Updated crop details", entry.newCrop]
    ].forEach(([title, crop]) => {
      const section = document.createElement("section");
      const subheading = document.createElement("h4");
      subheading.textContent = title;
      section.appendChild(subheading);
      [
        ["Soil type", crop.soilType],
        ["Land area", crop.area ? `${crop.area} acres` : ""],
        ["Location", [crop.district, crop.state].filter(Boolean).join(", ")],
        ["Planting date", crop.plantingDate],
        ["Expected harvest", crop.expectedHarvestDate],
        ["Irrigation", crop.irrigationType],
        ["Fertilizer", crop.fertilizerDetails],
        ["Status", crop.status]
      ].forEach(([label, value]) => {
        if (!value) return;
        const detail = document.createElement("p");
        detail.textContent = `${label}: ${value}`;
        section.appendChild(detail);
      });
      detailGrid.appendChild(section);
    });
    card.appendChild(detailGrid);
    list.appendChild(card);
  });
}

loadHistory().catch(error => {
  list.replaceChildren();
  message.textContent = error.message;
});
