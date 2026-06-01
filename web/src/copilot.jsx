import React, { useMemo, useState } from "react";

const INTENTS = [
  ["vat", "VAT / SRC"],
  ["payroll", "Payroll"],
  ["personal-data", "Personal data"],
  ["esign", "E-sign"],
  ["month-close", "Month close"]
];

const money = value => `${Number(value || 0).toLocaleString("hy-AM")} AMD`;

export function CopilotPanel({ customers, docs, people, onAsk, actionState }) {
  const [intent, setIntent] = useState("vat");
  const [question, setQuestion] = useState("Can we prepare May VAT/SRC guidance for this customer?");
  const [customerId, setCustomerId] = useState("cust-nare");
  const [periodKey, setPeriodKey] = useState("2026-05");
  const [employeeId, setEmployeeId] = useState("");
  const [gross, setGross] = useState("600000");
  const [documentId, setDocumentId] = useState("doc-anahit-nda");
  const [result, setResult] = useState(null);
  const [localError, setLocalError] = useState("");
  const busy = actionState === "copilot:ask";
  const employees = (people && people.employees) || [];
  const documents = (docs && docs.documents) || [];
  const customerOptions = useMemo(() => customers || [], [customers]);

  async function ask() {
    if (question.trim().length < 8 || !onAsk) return;
    setLocalError("");
    const payload = {
      intent,
      question: question.trim(),
      customerId: customerId || undefined,
      periodKey: periodKey || undefined,
      employeeId: employeeId || undefined,
      gross: gross ? Number(gross) : undefined,
      documentId: documentId || undefined
    };
    try {
      setResult(await onAsk(payload));
    } catch (err) {
      setLocalError((err && err.message) || "Copilot request failed");
    }
  }

  return (
    <article className="panel copilot-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">A1 Copilot</span>
          <h2>Legal &amp; accounting copilot</h2>
        </div>
        <strong className="aging-badge">local draft</strong>
      </div>

      <div className="copilot-controls">
        <div className="segmented">
          {INTENTS.map(([key, label]) => (
            <button key={key} type="button" className={intent === key ? "active" : ""} onClick={() => setIntent(key)}>{label}</button>
          ))}
        </div>
        <textarea value={question} onChange={event => setQuestion(event.target.value)} rows={3} />
        <div className="inline-form">
          <select value={customerId} onChange={event => setCustomerId(event.target.value)}>
            <option value="">No customer</option>
            {customerOptions.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
          </select>
          {(intent === "vat" || intent === "month-close") && (
            <input value={periodKey} onChange={event => setPeriodKey(event.target.value)} placeholder="YYYY-MM" />
          )}
          {intent === "payroll" && (
            <>
              <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
                <option value="">Manual gross</option>
                {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.fullName}</option>)}
              </select>
              <input value={gross} onChange={event => setGross(event.target.value)} inputMode="numeric" placeholder="Gross AMD" />
            </>
          )}
          {intent === "esign" && (
            <select value={documentId} onChange={event => setDocumentId(event.target.value)}>
              <option value="">Select document</option>
              {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
            </select>
          )}
          <button className="mini-action" type="button" disabled={busy} onClick={ask}>{busy ? "Asking" : "Ask"}</button>
        </div>
      </div>

      {localError && <p className="action-status">{localError}</p>}
      {result && <CopilotResult result={result} />}
    </article>
  );
}

function CopilotResult({ result }) {
  const citations = result.citations || [];
  const calculations = result.calculations || [];
  const actions = result.proposedActions || [];
  return (
    <div className="copilot-result">
      <p>{result.answer}</p>
      <div className="meta-row">
        <span>{result.intent}</span>
        <span>{result.riskLevel}</span>
        <span>{result.confidence}% confidence</span>
        <span>{result.reviewRequired ? "review required" : "review optional"}</span>
      </div>
      {calculations.length > 0 && (
        <div className="copilot-block">
          <h3>Calculations</h3>
          {calculations.map(calc => (
            <div className="row" key={calc.kind}>
              <span>{calc.label}</span>
              <strong>{formatCalculation(calc)}</strong>
            </div>
          ))}
        </div>
      )}
      {citations.length > 0 && (
        <div className="copilot-block">
          <h3>Citations</h3>
          {citations.map(source => (
            <div className="row" key={source.id}>
              <span>{source.title} · {source.status}</span>
              <strong>{source.effectiveDate || "no date"}</strong>
            </div>
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="copilot-block">
          <h3>Proposed actions</h3>
          {actions.map(action => (
            <div className="row" key={action.key}>
              <span>{action.label}{action.disabledReason ? ` · ${action.disabledReason}` : ""}</span>
              <strong>{action.method} {action.path || "blocked"}</strong>
            </div>
          ))}
        </div>
      )}
      {(result.guardrails || []).map(item => <p className="action-status" key={item}>{item}</p>)}
    </div>
  );
}

function formatCalculation(calc) {
  const outputs = calc.outputs || {};
  if (calc.kind === "vat-report") return money(outputs.netVatPayable);
  if (calc.kind === "payroll-preview") return money(outputs.net);
  if (calc.kind === "trial-balance") return outputs.balanced ? "balanced" : "check";
  return Object.keys(outputs).length ? JSON.stringify(outputs) : "-";
}
