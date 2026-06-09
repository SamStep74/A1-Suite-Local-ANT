import React, { useState } from "react";

const TEMPLATE_LABELS = {
  invoice: "Արտահանման հաշիվ / Export invoice",
  packing: "Փաթեթավորման կետագիր / Packing list",
  cmr: "Տրանսպորտային փաստաթուղթ / CMR",
  tir: "TIR կարնե",
  coo: "Ծագման վկայական / Certificate of origin",
  phyto: "Ֆիտոսանիտարական վկայական / Phytosanitary",
  vet: "Անասնաբուժական վկայական / Veterinary",
  declaration: "Արտահանման հայտարարություն / Export declaration"
};

export function ExportDocsPanel({ api, actionState }) {
  const [step, setStep] = useState(1);
  const [template, setTemplate] = useState(null);
  const [country, setCountry] = useState("RU");
  const [draft, setDraft] = useState(null);
  const [validation, setValidation] = useState(null);
  const [error, setError] = useState("");
  const busy = actionState === "export-docs";

  async function autoFill() {
    setError("");
    const response = await api("/api/export-docs/ai/auto-fill", {
      method: "POST",
      body: {
        destinationCountry: country,
        salesOrder: {
          destinationCountry: country,
          incoterm: "CIF",
          currency: "USD",
          lines: [
            { productId: "demo-tomato", description: "Tomatoes", quantity: 1000, unitPrice: 1.2, uom: "kg" }
          ]
        },
        productMaster: [
          { id: "demo-tomato", name: "Tomatoes (Cherry)", hsCode: "0702", uom: "kg" }
        ]
      }
    });
    setDraft(response.draft);
    setStep(2);
  }

  async function validate() {
    setError("");
    const response = await api("/api/export-docs/ai/country-check?country=" + encodeURIComponent(country) + "&productId=demo-tomato");
    setValidation(response);
    setStep(3);
  }

  async function finalize() {
    setError("");
    const created = await api("/api/export-docs", {
      method: "POST",
      body: {
        kind: template,
        destinationCountry: country,
        incoterm: draft && draft.incoterm,
        currency: draft && draft.currency,
        lines: (draft && draft.lines) || [],
        idempotencyKey: `ui-create-${Date.now()}`
      }
    });
    await api(`/api/export-docs/${created.exportDoc.id}/finalize`, { method: "POST", body: { idempotencyKey: `ui-fin-${Date.now()}` } });
    setStep(4);
  }

  return (
    <article className="panel export-docs-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Արտահանման փաստաթղթեր</span>
          <h2>Export documentation wizard</h2>
        </div>
      </div>

      {step === 1 && (
        <div className="inline-form">
          <label>Տիպ
            <select value={template || ""} onChange={event => setTemplate(event.target.value)}>
              <option value="">— Ընտրել / Select —</option>
              {Object.keys(TEMPLATE_LABELS).map(k => <option key={k} value={k}>{TEMPLATE_LABELS[k]}</option>)}
            </select>
          </label>
          <label>Երկիր
            <select value={country} onChange={event => setCountry(event.target.value)}>
              {["RU","EAEU","EU","AE","HK","PH"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <button className="mini-action" type="button" disabled={!template || busy} onClick={autoFill}>
            {busy ? "Կատարվում է…" : "Հաջորդ"}
          </button>
        </div>
      )}

      {step === 2 && draft && (
        <div className="copilot-result">
          <h3>Նախնական լրացում / Auto-fill preview</h3>
          <p className="row"><span className="section-label">Երկիր</span> {draft.destinationCountry}</p>
          <p className="row"><span className="section-label">Incoterm</span> {draft.incoterm} · {draft.currency}</p>
          <ul>
            {draft.lines.map((l, i) => <li key={i}>{l.description} — HS {l.hsCode} — {l.quantity} {l.uom}</li>)}
          </ul>
          <div className="inline-form">
            <button className="mini-action" type="button" onClick={validate}>Ստուգել / Validate</button>
            <button className="mini-action" type="button" onClick={() => setStep(1)}>Վերադառնալ</button>
          </div>
        </div>
      )}

      {step === 3 && validation && (
        <div className="copilot-result">
          <h3>Ստուգման արդյունքներ / Validation</h3>
          <p className="row"><span className="section-label">Երկիր</span> {validation.destinationCountry}</p>
          <p className="row"><span className="section-label">Պարտադիր վկայականներ</span> {(validation.pack && validation.pack.requiredCertificates || []).join(", ")}</p>
          {validation.hsNote && <p className="row"><span className="section-label">HS ծանություն</span> {validation.hsNote}</p>}
          {error && <p className="aging-badge">{error}</p>}
          <div className="inline-form">
            <button className="mini-action" type="button" onClick={finalize} disabled={busy}>Ավարտել / Finalize</button>
            <button className="mini-action" type="button" onClick={() => setStep(2)}>Վերադառնալ</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="copilot-result">
          <h3>Փաստաթուղթն ավարտված է / Document finalized</h3>
          <p className="row"><span className="section-label">Կարգավիճակ</span> finalized</p>
          <button className="mini-action" type="button" onClick={() => { setStep(1); setDraft(null); setValidation(null); }}>Սկսել նորը</button>
        </div>
      )}
    </article>
  );
}
