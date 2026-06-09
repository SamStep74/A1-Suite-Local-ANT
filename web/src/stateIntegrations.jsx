import React, { useEffect, useState } from "react";

/**
 * State Integrations admin panel (sub-plan 7).
 *
 * Lets Owner/Admin/Auditor dispatch calls into the 6 Armenian state-adapter
 * stubs (SRC, e-Register.am, e-Gov, ID Card, Mobile ID, e-Customs) and poll
 * the audit trail. In test mode (default) every adapter returns a
 * deterministic envelope; the panel surfaces a MODE badge so an operator
 * can tell at a glance which environment is live.
 *
 * Armenian-first inline strings — secondary English in parens where the
 * domain word has no natural Armenian equivalent (e-sign, SRC, ID).
 */

const ADAPTERS = [
  { id: "src",       label: "ՀԾ — Հարկային կոմիտե / SRC",         operations: ["submitVat"] },
  { id: "eregister", label: "e-Register.am — Իրավաբանական անձանց ռեեստր", operations: ["lookup"] },
  { id: "egov",      label: "e-Gov.am — Էլեկտրոնային կառավարություն", operations: ["sign"] },
  { id: "idcard",    label: "ID Card — Անձնագրի ստուգում",     operations: ["verify"] },
  { id: "mobileid",  label: "Mobile ID — Բջջային ստորագրություն", operations: ["challenge"] },
  { id: "customs",   label: "e-Customs — Մաքսային հայտարարություն", operations: ["declare"] }
];

const SAMPLE_PAYLOADS = {
  src:        JSON.stringify({ period: "2026-Q1", netAmount: 100000, vatRate: 20 }, null, 2),
  eregister:  JSON.stringify({ taxId: "01234567" }, null, 2),
  egov:       JSON.stringify({ documentId: "doc-001", signerClaims: { idNumber: "AN-1234567", fullName: "Test User" } }, null, 2),
  idcard:     JSON.stringify({ subjectId: "AN-1234567" }, null, 2),
  mobileid:   JSON.stringify({ phone: "+37499123456" }, null, 2),
  customs:    JSON.stringify({ declarationType: "IMPORT", hsCode: "070200000", destinationCountry: "RU" }, null, 2)
};

function isAuditorLike(role) {
  return ["Owner", "Admin", "Auditor"].includes(role);
}

export function StateIntegrationsPanel({ api, role, actionState }) {
  const [adapterId, setAdapterId] = useState("src");
  const adapter = ADAPTERS.find(a => a.id === adapterId) || ADAPTERS[0];
  const [operation, setOperation] = useState(adapter.operations[0]);
  const [payloadText, setPayloadText] = useState(SAMPLE_PAYLOADS[adapterId]);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const busy = actionState === "state-int";
  const mode = (typeof process !== "undefined" && process.env && process.env.STATE_INTEGRATION_MODE) || "test";

  useEffect(() => {
    setOperation(adapter.operations[0]);
    setPayloadText(SAMPLE_PAYLOADS[adapterId]);
    setError("");
    setLastResult(null);
  }, [adapterId]);

  async function refreshAudit() {
    if (!isAuditorLike(role)) return;
    setAuditLoading(true);
    setAuditError("");
    try {
      const response = await api("/api/state-int/audit");
      setAuditRows((response && response.audit) || []);
    } catch (err) {
      setAuditError(err && err.message ? err.message : "audit չհաջողվեց");
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => { refreshAudit(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function dispatchCall() {
    setError("");
    let parsed;
    try {
      parsed = payloadText.trim() ? JSON.parse(payloadText) : {};
    } catch (parseErr) {
      setError("JSON վերլուծության սխալ / " + parseErr.message);
      return;
    }
    const idempotencyKey = `ui-state-int-${adapterId}-${operation}-${Date.now()}`;
    try {
      const response = await api(`/api/state-int/${adapterId}/${operation}`, {
        method: "POST",
        body: Object.assign({ idempotencyKey }, parsed)
      });
      setLastResult(response && response.stateInt);
      if (isAuditorLike(role)) refreshAudit();
    } catch (err) {
      setError(err && err.message ? err.message : "Ուղարկումը ձախողվեց");
    }
  }

  return (
    <article className="panel state-int-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Կառավարության ինտեգրացիաներ</span>
          <h2>State integrations hub</h2>
          <p className="row">
            <span className="aging-badge">MODE: {mode}</span>
            <span className="section-label">Հասցեատերեր</span>
            {ADAPTERS.length} ադապտեր · test ռեժիմում ոչ մի կոչ չի դուրս գալիս դեպի պետական համակարգեր
          </p>
        </div>
      </div>

      <div className="inline-form">
        <label>Ադապտեր / Adapter
          <select value={adapterId} onChange={event => setAdapterId(event.target.value)}>
            {ADAPTERS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label>Գործողություն / Operation
          <select value={operation} onChange={event => setOperation(event.target.value)}>
            {adapter.operations.map(op => <option key={op} value={op}>{op}</option>)}
          </select>
        </label>
        <button className="mini-action" type="button" onClick={dispatchCall} disabled={busy}>
          {busy ? "Ուղարկվում է…" : "Ուղարկել / Dispatch"}
        </button>
      </div>

      <label className="block-label">JSON մուտքագրվող / Payload
        <textarea
          rows={8}
          spellCheck="false"
          value={payloadText}
          onChange={event => setPayloadText(event.target.value)}
        />
      </label>

      {error && <p className="aging-badge">⚠ {error}</p>}

      {lastResult && (
        <div className="copilot-result">
          <h3>Վերջին արդյունք / Last result</h3>
          <p className="row"><span className="section-label">requestId</span> {lastResult.requestId}</p>
          <p className="row"><span className="section-label">status</span> {lastResult.status}</p>
          {lastResult.providerRef && <p className="row"><span className="section-label">providerRef</span> {lastResult.providerRef}</p>}
          {lastResult.signatureB64 && <p className="row"><span className="section-label">signatureB64</span> <code>{lastResult.signatureB64.slice(0, 40)}…</code></p>}
          {lastResult.certificateThumbprint && <p className="row"><span className="section-label">thumbprint</span> <code>{lastResult.certificateThumbprint}</code></p>}
          {lastResult.advisoryOnly && <p className="aging-badge">advisoryOnly: true · ստուգումը պետք է հաստատվի production միացմամբ</p>}
        </div>
      )}

      {isAuditorLike(role) && (
        <div className="copilot-result">
          <div className="inline-form">
            <h3 style={{ margin: 0 }}>Audit · Վերջին 200 կանչերը</h3>
            <button className="mini-action" type="button" onClick={refreshAudit} disabled={auditLoading}>
              {auditLoading ? "Բեռնվում է…" : "Թարմացնել audit"}
            </button>
          </div>
          {auditError && <p className="aging-badge">⚠ {auditError}</p>}
          {auditRows.length === 0 && !auditLoading && <p className="row">Կանչեր դեռ չկան / No calls yet</p>}
          {auditRows.length > 0 && (
            <ul>
              {auditRows.map(row => (
                <li key={row.id}>
                  <code>{row.called_at}</code> · <strong>{row.adapter}/{row.operation}</strong> · {row.status} · {row.latency_ms}ms · <span className="section-label">{row.request_id}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}
