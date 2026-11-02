import React, { useEffect, useState } from "react";
import "./Dashboard.css";

const DEFAULT_VALUES = {
  farmCrops: 1,
  cropChecksCompleted: 1,
  expenses: 50000,
  readings: 0,
  healthScans: 0,
};

const CARDS = [
  { key: "farmCrops", label: "Farm Crops", color: "green" },
  { key: "cropChecksCompleted", label: "Crop Checks Completed", color: "green" },
  { key: "expenses", label: "Expenses", color: "orange" },
  { key: "readings", label: "Readings", color: "blue" },
  { key: "healthScans", label: "Health Scans", color: "red" },
];

const getStoredData = (key, fallback) => {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
};

const formatValue = (key, value) =>
  key === "expenses"
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(value)
    : new Intl.NumberFormat("en-IN").format(value);

export default function Dashboard({ userId = "default-user" }) {
  const currentKey = `farm-dashboard-${userId}`;
  const historyKey = `farm-history-${userId}`;

  const [values, setValues] = useState(() =>
    getStoredData(currentKey, DEFAULT_VALUES)
  );

  const [history, setHistory] = useState(() =>
    getStoredData(historyKey, [])
  );

  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState("");
  const [snapshotName, setSnapshotName] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    localStorage.setItem(currentKey, JSON.stringify(values));
  }, [currentKey, values]);

  useEffect(() => {
    localStorage.setItem(historyKey, JSON.stringify(history));
  }, [historyKey, history]);

  const updateValue = (event) => {
    event.preventDefault();

    const number = Number(draft);

    if (draft.trim() === "" || !Number.isFinite(number) || number < 0) {
      setMessage("Please enter a valid value.");
      return;
    }

    setValues((previous) => ({
      ...previous,
      [editing]: number,
    }));

    setEditing(null);
    setDraft("");
    setMessage("Value updated successfully.");
  };

  const resetValues = () => {
    if (
      !window.confirm(
        "Reset all current values? Previously saved history will remain."
      )
    ) {
      return;
    }

    setValues({ ...DEFAULT_VALUES });
    setMessage("Current values reset. Saved history is preserved.");
  };

  const saveValues = (event) => {
    event.preventDefault();

    const snapshot = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: snapshotName.trim() || "Farm Snapshot",
      date: new Date().toISOString(),
      values: { ...values },
    };

    setHistory((previous) => [snapshot, ...previous]);
    setSnapshotName("");
    setMessage("Dashboard values saved successfully.");
  };

  const restoreValues = (snapshot) => {
    if (
      !window.confirm(
        `Restore "${snapshot.name}"? The saved snapshot will remain in history.`
      )
    ) {
      return;
    }

    setValues({ ...DEFAULT_VALUES, ...snapshot.values });
    setMessage("Previous values restored successfully.");
  };

  const deleteSnapshot = (id) => {
    if (!window.confirm("Delete this saved snapshot permanently?")) {
      return;
    }

    setHistory((previous) =>
      previous.filter((snapshot) => snapshot.id !== id)
    );

    setMessage("Saved snapshot deleted.");
  };

  return (
    <main className="farm-dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">FARM DASHBOARD</p>
          <h1>Welcome to your farm!</h1>
          <p>Manage your farm from one place.</p>
        </div>
      </header>

      {message && (
        <div className="dashboard-message" role="status">
          {message}
          <button onClick={() => setMessage("")} aria-label="Close message">
            ×
          </button>
        </div>
      )}

      <section className="metric-grid">
        {CARDS.map((card) => (
          <article
            className={`metric-card accent-${card.color}`}
            key={card.key}
          >
            <h2>{card.label}</h2>

            <p className="metric-value">
              {formatValue(card.key, values[card.key])}
            </p>

            <button
              className="button button-outline"
              onClick={() => {
                setEditing(card.key);
                setDraft(String(values[card.key]));
                setMessage("");
              }}
            >
              Update
            </button>

            {editing === card.key && (
              <form className="edit-form" onSubmit={updateValue}>
                <label htmlFor={`input-${card.key}`}>
                  Enter new {card.label} value
                </label>

                <input
                  id={`input-${card.key}`}
                  type="number"
                  min="0"
                  step="1"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  required
                />

                <button className="button button-primary" type="submit">
                  Apply Update
                </button>

                <button
                  className="button button-light"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
              </form>
            )}
          </article>
        ))}
      </section>

      <section className="management-grid">
        <article className="management-panel">
          <h2>Save Current Values</h2>

          <p>
            Save all five current values as a separate historical record.
          </p>

          <form onSubmit={saveValues} className="save-form">
            <input
              type="text"
              placeholder="Snapshot name (optional)"
              maxLength={80}
              value={snapshotName}
              onChange={(event) => setSnapshotName(event.target.value)}
            />

            <button className="button button-primary" type="submit">
              Save Values
            </button>
          </form>
        </article>

        <article className="management-panel">
          <h2>Reset Dashboard</h2>

          <p>
            Restore default values without deleting your saved history.
          </p>

          <button
            className="button button-danger"
            onClick={resetValues}
          >
            Reset All Values
          </button>
        </article>
      </section>

      <section className="history-panel">
        <h2>Saved History ({history.length})</h2>

        {history.length === 0 ? (
          <p className="empty-history">
            No saved snapshots yet. Save your current values to get started.
          </p>
        ) : (
          <div className="history-list">
            {history.map((snapshot) => (
              <article className="history-item" key={snapshot.id}>
                <div className="history-heading">
                  <div>
                    <h3>{snapshot.name}</h3>
                    <p>{new Date(snapshot.date).toLocaleString()}</p>
                  </div>

                  <div className="history-actions">
                    <button
                      className="button button-primary"
                      onClick={() => restoreValues(snapshot)}
                    >
                      Restore
                    </button>

                    <button
                      className="button button-light"
                      onClick={() => deleteSnapshot(snapshot.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="snapshot-values">
                  {CARDS.map((card) => (
                    <div className="snapshot-value" key={card.key}>
                      <span>{card.label}</span>
                      <strong>
                        {formatValue(
                          card.key,
                          snapshot.values[card.key] ?? 0
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}