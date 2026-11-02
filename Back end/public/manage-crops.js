const token = sessionStorage.getItem("agri-token");
const form = document.querySelector("#cropDetailsForm");
const picker = document.querySelector("#cropPicker");
const pickerLabel = document.querySelector("#cropPickerLabel");
const message = document.querySelector("#manageMessage");
const nameSelect = form.elements.namedItem("name");
const customNameLabel = document.querySelector("#customCropLabel");
const saveButton = document.querySelector("#saveCropButton");
const changeButton = document.querySelector("#changeCropButton");
const addButton = document.querySelector("#addCropButton");
const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "edit";
const requestedId = params.get("id") || "";
const addRequestKey = crypto.randomUUID();
let crops = [];
let selectedCrop = null;

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

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("form-message-error", isError);
}

function setMode(nextMode) {
  const adding = nextMode === "add";
  document.querySelector("#pageHeading").textContent = adding ? "Add New Crop" : "Manage Crops";
  pickerLabel.hidden = adding;
  form.hidden = false;
  saveButton.hidden = adding;
  changeButton.hidden = adding;
  addButton.hidden = !adding;
  if (adding) {
    selectedCrop = null;
    form.reset();
    form.elements.namedItem("status").value = "Active";
    picker.value = "";
    setMessage("");
  } else if (!selectedCrop) {
    form.hidden = true;
  }
}

function fillForm(crop) {
  selectedCrop = crop;
  if (!crop) {
    form.hidden = true;
    return;
  }
  form.hidden = false;
  const knownOption = Array.from(nameSelect.options)
    .find(option => option.value.toLowerCase() === String(crop.name || "").toLowerCase());
  nameSelect.value = knownOption ? knownOption.value : "Other";
  form.elements.namedItem("customName").value = knownOption ? "" : crop.name || "";
  customNameLabel.hidden = nameSelect.value !== "Other";
  form.elements.namedItem("state").value = crop.state || "";
  form.elements.namedItem("district").value = crop.district || "";
  form.elements.namedItem("area").value = crop.area ?? "";
  form.elements.namedItem("soilType").value = crop.soilType || "";
  form.elements.namedItem("plantingDate").value = crop.plantingDate || "";
  form.elements.namedItem("expectedHarvestDate").value = crop.expectedHarvestDate || "";
  form.elements.namedItem("irrigationType").value = crop.irrigationType || "";
  form.elements.namedItem("fertilizerDetails").value = crop.fertilizerDetails || "";
  form.elements.namedItem("status").value = crop.status || "Active";
}

function readFormValues() {
  const data = new FormData(form);
  return {
    name: data.get("name") === "Other" ? data.get("customName").trim() : data.get("name"),
    state: data.get("state").trim(),
    district: data.get("district").trim(),
    area: Number(data.get("area")),
    soilType: data.get("soilType"),
    plantingDate: data.get("plantingDate"),
    expectedHarvestDate: data.get("expectedHarvestDate"),
    irrigationType: data.get("irrigationType"),
    fertilizerDetails: data.get("fertilizerDetails").trim(),
    status: data.get("status"),
    type: selectedCrop?.type || "",
    category: selectedCrop?.category || "",
    season: selectedCrop?.season || ""
  };
}

async function saveCrop(isChangingCrop = false) {
  if (!form.reportValidity()) return;
  const values = readFormValues();
  if (!values.name) {
    setMessage("Enter the crop name.", true);
    return;
  }
  if (values.plantingDate && values.expectedHarvestDate &&
      values.expectedHarvestDate < values.plantingDate) {
    setMessage("Expected harvest date cannot be before the planting date.", true);
    return;
  }
  if (isChangingCrop && !window.confirm(
    `Change ${selectedCrop.name} to ${values.name} and save the updated crop details?`
  )) return;

  const button = isChangingCrop ? changeButton : (mode === "add" ? addButton : saveButton);
  button.disabled = true;
  setMessage(isChangingCrop ? "Updating crop details…" : mode === "add" ? "Adding crop…" : "Saving changes…");
  try {
    if (mode === "add") {
      await api("/api/crops", {
        method: "POST",
        body: JSON.stringify({ ...values, requestKey: addRequestKey })
      });
      setMessage("Crop added successfully.");
      await loadCrops();
      setMode("add");
    } else {
      const result = await api(`/api/crops/${encodeURIComponent(selectedCrop.id)}`, {
        method: "PUT",
        body: JSON.stringify(values)
      });
      selectedCrop = result.crop;
      const cropOption = Array.from(nameSelect.options)
        .find(option => option.value.toLowerCase() === result.crop.name.toLowerCase());
      if (!cropOption) {
        const option = new Option(result.crop.name, result.crop.name);
        nameSelect.add(option, nameSelect.options.length - 1);
      }
      fillForm(result.crop);
      setMessage(result.message);
      await loadCrops(false);
    }
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function loadCrops(chooseFirst = true) {
  const previouslySelectedId = selectedCrop?.id || requestedId;
  crops = await api("/api/crops");
  picker.replaceChildren(new Option(
    crops.length ? "Select a crop" : "No crops saved yet",
    ""
  ));
  crops.forEach(crop => {
    picker.add(new Option(
      `${crop.name} · ${crop.district || crop.state || "Farm"} · ${crop.status || "Active"}`,
      crop.id
    ));
  });
  picker.disabled = crops.length === 0;
  if (mode === "add") return;
  const crop = crops.find(entry => String(entry.id) === String(previouslySelectedId)) ||
    (chooseFirst ? crops[0] : null);
  picker.value = crop ? String(crop.id) : "";
  fillForm(crop || null);
}

nameSelect.addEventListener("change", () => {
  customNameLabel.hidden = nameSelect.value !== "Other";
});
picker.addEventListener("change", () => {
  fillForm(crops.find(crop => String(crop.id) === picker.value) || null);
  setMessage("");
});
form.addEventListener("submit", event => {
  event.preventDefault();
  saveCrop(false);
});
changeButton.addEventListener("click", () => saveCrop(true));

const cancelUrl = mode === "add" ? "/dashboard" :
  requestedId ? `/manage-crops?id=${encodeURIComponent(requestedId)}` : "/dashboard";
document.querySelector("#cancelCropButton").href = cancelUrl;

loadCrops().then(() => setMode(mode === "add" ? "add" : "edit")).catch(error => {
  picker.replaceChildren(new Option("Could not load crops", ""));
  setMessage(error.message, true);
});
