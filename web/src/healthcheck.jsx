import React, { useState } from "react";

/**
 * Pattern A skeleton example panel.
 *
 * Lives inside the copilot app anchor (the ping route is gated by copilot
 * app access for the Pattern A skeleton, so a separate launcher entry is
 * not required). Demonstrates the four Pattern A contracts in the UI:
 *   1. Pure engine call via onPing prop
 *   2. Idempotency-key per click (timestamp-suffixed)
 *   3. Echo of the message + respondedAt timestamp
 *   4. actionState-driven busy indicator
 */
export function HealthcheckPanel({ onPing, actionState }) {
  const [message, setMessage] = useState("skeleton");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const busy = actionState === "healthcheck:ping";
  async function ping() {
    setError("");
    try {
      const response = await onPing({ message, idempotencyKey: `ui-${Date.now()}` });
      setResult(response.healthcheck || response);
    } catch (err) {
      setError(err && err.message ? err.message : "Ping failed");
    }
  }
  return (
    <article className="panel healthcheck-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Pattern A skeleton</span>
          <h2>Healthcheck ping</h2>
        </div>
      </div>
      <div className="inline-form">
        <input
          aria-label="Healthcheck message"
          value={message}
          onChange={event => setMessage(event.target.value)}
          maxLength={200}
        />
        <button
          className="mini-action"
          type="button"
          disabled={busy}
          onClick={ping}
        >
          {busy ? "Pinging" : "Ping"}
        </button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>echo: <strong>{result.message}</strong></p>
          <p className="action-status">at {result.respondedAt}</p>
        </div>
      )}
      {error && (
        <p className="action-status" role="alert">error: {error}</p>
      )}
    </article>
  );
}
