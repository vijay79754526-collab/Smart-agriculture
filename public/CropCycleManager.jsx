import React, { useEffect, useState } from "react";

const STORAGE_KEY = "smartAgricultureCropCycles";

const initialCycle = {
  id: crypto.randomUUID(),
  cropName: "Ragi",
  startDate: new Date().toISOString().slice(0, 10),
  status: "Active",
  cropChecks: 1,
  expenses: 50000,
  readings: 0,
  healthScans: 0,
  expenseRecords: [],
  readingRecords: [],
  healthRecords: [],
};

function loadCycles() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch (error) {
    console.error("Unable to load crop history:", error);
  }

  return [initialCycle];
}

export default function CropCycleManager() {
  const [cycles, setCycles] = useState(loadCycles);
  const [newCrop, setNewCrop] = useState("Rice");
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");

  const activeCycle = cycles.find(
    (cycle) => cycle.status === "Active"
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cycles));
  }, [cycles]);

  function completeCrop() {
    if (!activeCycle) {
      setMessage("There is no active crop to complete.");
      return;
    }

    const confirmed = window.confirm(
      `Mark ${activeCycle.cropName} as completed and start ${newCrop}? Previous records will be preserved.`
    );

    if (!confirmed) return;

    const updatedCycles = cycles.map((cycle) =>
      cycle.id === activeCycle.id
        ? {
            ...cycle,
            status: "Completed",
            endDate: new Date().toISOString().slice(0, 10),
          }
        : cycle
    );

    updatedCycles.unshift({
      id: crypto.randomUUID(),
      cropName: newCrop,
      startDate: new Date().toISOString().slice(0, 10),
      status: "Active",
      cropChecks: 0,
      expenses: 0,
      readings: 0,
      healthScans: 0,
      expenseRecords: [],
      readingRecords: [],
      healthRecords: [],
    });

    setCycles(updatedCycles);
    setShowForm(false);
    setMessage(
      `Previous crop saved. ${newCrop} is now the active crop.`
    );
  }

  function addRecord(type) {
    if (!activeCycle) {
      setMessage("Start a new crop first.");
      return;
    }

    const labels = {
      cropChecks: "Crop check",
      expenses: "Expense amount",
      readings: "Sensor reading",
      healthScans: "Health scan",
    };

    const input = window.prompt(
      `Enter ${labels[type]}:`
    );

    if (input === null || input.trim() === "") return;

    const value = Number(input);

    if (!Number.isFinite(value) || value < 0) {
      setMessage("Please enter a valid non-negative number.");
      return;
    }

    if (type === "cropChecks" && !Number.isInteger(value)) {
      setMessage("Crop checks must be a whole number.");
      return;
    }

    if (
      (type === "expenses" || type === "readings" ||
        type === "healthScans") &&
      value <= 0
    ) {
      setMessage("Please enter a value greater than zero.");
      return;
    }

    const record = {
      value,
      date: new Date().toLocaleString(),
    };

    setCycles((previous) =>
      previous.map((cycle) => {
        if (cycle.id !== activeCycle.id) return cycle;

        if (type === "expenses") {
          return {
            ...cycle,
            expenses: cycle.expenses + value,
            expenseRecords: [
              ...(cycle.expenseRecords || []),
              record,
            ],
          };
        }

        if (type === "cropChecks") {
          return {
            ...cycle,
            cropChecks: cycle.cropChecks + value,
          };
        }

        if (type === "readings") {
          return {
            ...cycle,
            readings: cycle.readings + 1,
            readingRecords: [
              ...(cycle.readingRecords || []),
              record,
            ],
          };
        }

        return {
          ...cycle,
          healthScans: cycle.healthScans + 1,
          healthRecords: [
            ...(cycle.healthRecords || []),
            record,
          ],
        };
      })
    );

    setMessage(`${labels[type]} saved successfully.`);
  }

  return (
    <div style={styles.page}>
      <h1>🌾 Smart Agriculture</h1>
      <h2>Farm Dashboard</h2>

      {message && <p style={styles.message}>{message}</p>}

      <div style={styles.grid}>
        <Stat title="FARM CROPS" value={activeCycle ? 1 : 0} />
        <Stat
          title="CROP CHECKS COMPLETED"
          value={activeCycle?.cropChecks ?? 0}
        />
        <Stat
          title="EXPENSES"
          value={`₹${(activeCycle?.expenses ?? 0).toLocaleString("en-IN")}`}
        />
        <Stat title="READINGS" value={activeCycle?.readings ?? 0} />
        <Stat title="HEALTH SCANS" value={activeCycle?.healthScans ?? 0} />
      </div>

      <section style={styles.card}>
        <h3>Current Crop</h3>

        {activeCycle ? (
          <>
            <p><b>Crop:</b> {activeCycle.cropName}</p>
            <p><b>Start Date:</b> {activeCycle.startDate}</p>
            <p><b>Status:</b> {activeCycle.status}</p>

            <button
              style={styles.button}
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? "Cancel" : "Update / Complete Crop"}
            </button>

            <div style={styles.actions}>
              <button onClick={() => addRecord("cropChecks")}>
                Add Crop Check
              </button>
              <button onClick={() => addRecord("expenses")}>
                Add Expense
              </button>
              <button onClick={() => addRecord("readings")}>
                Add Reading
              </button>
              <button onClick={() => addRecord("healthScans")}>
                Add Health Scan
              </button>
            </div>

            {showForm && (
              <div style={styles.form}>
                <label>Choose the next crop</label>

                <select
                  value={newCrop}
                  onChange={(event) => setNewCrop(event.target.value)}
                >
                  {[
                    "Ragi",
                    "Rice",
                    "Maize",
                    "Tomato",
                    "Onion",
                    "Wheat",
                    "Cotton",
                    "Sugarcane",
                  ]
                    .filter((crop) => crop !== activeCycle.cropName)
                    .map((crop) => (
                      <option key={crop} value={crop}>
                        {crop}
                      </option>
                    ))}
                </select>

                <p>
                  Completing this crop will preserve its expenses
                  and records in the history.
                </p>

                <button
                  style={styles.button}
                  onClick={completeCrop}
                >
                  Complete Current Crop & Start New Crop
                </button>
              </div>
            )}
          </>
        ) : (
          <p>No active crop. Add a new crop to begin.</p>
        )}
      </section>

      <section style={styles.card}>
        <h3>Crop History</h3>

        {cycles.length === 0 ? (
          <p>No crop history found.</p>
        ) : (
          cycles.map((cycle) => (
            <div key={cycle.id} style={styles.history}>
              <h4>{cycle.cropName}</h4>
              <p>Status: {cycle.status}</p>
              <p>Start Date: {cycle.startDate}</p>
              {cycle.endDate && (
                <p>Completion Date: {cycle.endDate}</p>
              )}
              <p>Crop Checks: {cycle.cropChecks}</p>
              <p>
                Expenses: ₹
                {Number(cycle.expenses).toLocaleString("en-IN")}
              </p>
              <p>Readings: {cycle.readings}</p>
              <p>Health Scans: {cycle.healthScans}</p>

              <details>
                <summary>View Saved Records</summary>
                <h5>Expense Records</h5>
                {(cycle.expenseRecords || []).map((r, i) => (
                  <p key={i}>
                    ₹{r.value} — {r.date}
                  </p>
                ))}

                <h5>Reading Records</h5>
                {(cycle.readingRecords || []).map((r, i) => (
                  <p key={i}>
                    {r.value} — {r.date}
                  </p>
                ))}

                <h5>Health Scan Records</h5>
                {(cycle.healthRecords || []).map((r, i) => (
                  <p key={i}>
                    {r.value} — {r.date}
                  </p>
                ))}
              </details>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

function Stat({ title, value }) {
  return (
    <div style={styles.stat}>
      <h4>{title}</h4>
      <h2>{value}</h2>
    </div>
  );
}

const styles = {
  page: {
    maxWidth: "1100px",
    margin: "20px auto",
    padding: "20px",
    fontFamily: "Arial, sans-serif",
    background: "#f0f7f0",
    color: "#183c25",
    minHeight: "100vh",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "15px",
    marginBottom: "25px",
  },
  stat: {
    background: "white",
    padding: "15px",
    borderRadius: "12px",
    borderTop: "4px solid #198754",
    boxShadow: "0 2px 8px #0001",
  },
  card: {
    background: "white",
    padding: "22px",
    borderRadius: "12px",
    marginBottom: "20px",
    boxShadow: "0 2px 8px #0001",
  },
  button: {
    background: "#198754",
    color: "white",
    padding: "12px 16px",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    margin: "8px 8px 8px 0",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "8px",
    marginTop: "15px",
  },
  form: {
    marginTop: "20px",
    padding: "15px",
    background: "#f5faf5",
    borderRadius: "8px",
  },
  history: {
    padding: "15px 0",
    borderBottom: "1px solid #ddd",
  },
  message: {
    background: "#d4edda",
    padding: "12px",
    borderRadius: "6px",
  },
};