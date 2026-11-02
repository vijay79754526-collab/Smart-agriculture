const token = sessionStorage.getItem("agri-token");
const results = document.querySelector("#recommendationResults");
const message = document.querySelector("#resultsMessage");

if (!token || !sessionStorage.getItem("agri-user")) {
  window.location.replace("/login");
}

async function loadSavedRecommendation() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) throw new Error("Choose a saved recommendation from your history or start a new crop check.");

  const response = await fetch(`/api/search-history/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const entry = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(entry.error || "Could not load these saved results.");
  if (entry.feature !== "crop-recommendations" || !entry.result) {
    throw new Error("Saved work does not contain crop recommendation results.");
  }

  const heading = document.createElement("h3");
  heading.textContent = `Results for ${entry.summary}`;
  results.replaceChildren(heading);

  const inputSummary = document.createElement("p");
  inputSummary.className = "recommendation-input-summary";
  inputSummary.textContent = Object.entries(entry.query || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
  results.appendChild(inputSummary);

  const recommendationList = document.createElement("div");
  recommendationList.className = "recommendation-cards";
  entry.result.recommendations.forEach((recommendation, index) => {
    const card = document.createElement("article");
    card.className = "panel crop-recommendation-card";
    const title = document.createElement("h4");
    title.textContent = `${index + 1}. ${recommendation.crop} — ${recommendation.score}% match`;
    card.appendChild(title);
    const seasons = document.createElement("p");
    seasons.textContent = `Suitable seasons: ${(recommendation.suitableSeasons || []).join(", ")}`;
    card.appendChild(seasons);
    const water = document.createElement("p");
    water.textContent = `Water requirement: ${recommendation.waterRequirement}`;
    card.appendChild(water);
    const factors = document.createElement("ul");
    (recommendation.factors || []).forEach(factor => {
      const item = document.createElement("li");
      item.textContent = `${factor.key}: ${factor.value} — ${factor.suitable ? "Suitable" : "Outside guide range"}`;
      factors.appendChild(item);
    });
    card.appendChild(factors);
    recommendationList.appendChild(card);
  });
  results.appendChild(recommendationList);

  const advisory = document.createElement("p");
  advisory.className = "recommendation-advisory";
  advisory.textContent = entry.result.advisory;
  results.appendChild(advisory);
}

loadSavedRecommendation().catch(error => {
  message.textContent = error.message;
});
