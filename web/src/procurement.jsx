import React, { useState } from "react";

const num = value => Number(value || 0).toLocaleString("hy-AM");

/**
 * Procurement extension panel — 5 tabs that surface the new sub-feature set
 * shipped on top of the existing Purchase spine:
 *   - Requisitions: Հայտեր
 *   - RFQ: Հարցումներ (conversion + quote capture + award)
 *   - Blanket orders: Ծածկագրեր
 *   - Landed costs: Լոգիստիկական ծախսեր
 *   - Credit notes: Վերադարձի հաշիվներ
 *
 * Reuses `.panel`, `.panel-head`, `.inline-form`, `.copilot-result`, and
 * `.aging-badge` from `styles.css`; no new CSS.
 */
function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`mini-action ${active ? "" : "secondary"}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RequisitionForm({ onSubmit, busy, buttonLabel }) {
  const [neededBy, setNeededBy] = useState("2026-06-30");
  const [justification, setJustification] = useState("");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({ neededBy, justification, idempotencyKey: `pr-ui-${Date.now()}` });
      }}
    >
      <label>
        Պահանջվող ժամկետ
        <input type="date" value={neededBy} onChange={e => setNeededBy(e.target.value)} disabled={busy} required />
      </label>
      <label>
        Հիմնավորում
        <input value={justification} onChange={e => setJustification(e.target.value)} placeholder="Հիմնավորում" disabled={busy} />
      </label>
      <button className="mini-action" type="submit" disabled={busy}>
        {busy ? "..." : buttonLabel}
      </button>
    </form>
  );
}

function RfqResult({ result }) {
  if (!result) return null;
  return (
    <div className="copilot-result">
      <p>RFQ ID: <strong>{result.id}</strong></p>
      <p>Կարճ ցուցակ՝ {num(result.shortlistedVendors?.length || 0)} մատակարար</p>
      <ul>
        {(result.shortlistedVendors || []).map(v => (
          <li key={v.vendorId}>
            {v.name} — score {v.score}, avg {v.avgPrice}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LandedForm({ onSubmit, busy, defaultPoId = "" }) {
  const [poId, setPoId] = useState(defaultPoId);
  const [kind, setKind] = useState("freight");
  const [amount, setAmount] = useState("50000");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({
          poId,
          kind,
          amount: Number(amount),
          currency: "AMD",
          allocationMethod: "value",
          idempotencyKey: `lc-ui-${Date.now()}`
        });
      }}
    >
      <label>
        PO ID
        <input value={poId} onChange={e => setPoId(e.target.value)} disabled={busy} required />
      </label>
      <label>
        Տեսակ
        <select value={kind} onChange={e => setKind(e.target.value)} disabled={busy}>
          <option value="freight">Freight</option>
          <option value="duty">Duty</option>
          <option value="insurance">Insurance</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        Գումար (դրամ)
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} required />
      </label>
      <button className="mini-action" type="submit" disabled={busy}>
        {busy ? "..." : "Բաշխել լոգիստիկական ծախսը"}
      </button>
    </form>
  );
}

function CreditForm({ onSubmit, busy, defaultPoId = "" }) {
  const [poId, setPoId] = useState(defaultPoId);
  const [amount, setAmount] = useState("30000");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({
          poId,
          amount: Number(amount),
          currency: "AMD",
          idempotencyKey: `cn-ui-${Date.now()}`
        });
      }}
    >
      <label>
        PO ID
        <input value={poId} onChange={e => setPoId(e.target.value)} disabled={busy} required />
      </label>
      <label>
        Գումար (դրամ)
        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} required />
      </label>
      <button className="mini-action" type="submit" disabled={busy}>
        {busy ? "..." : "Տրամադրել վերադարձի հաշիվ"}
      </button>
    </form>
  );
}

function BlanketForm({ onSubmit, busy }) {
  const [vendorId, setVendorId] = useState("");
  const [catalogItemId, setCatalogItemId] = useState("");
  const [committedQty, setCommittedQty] = useState("100");
  const [unitPrice, setUnitPrice] = useState("80000");
  return (
    <form
      className="inline-form"
      onSubmit={event => {
        event.preventDefault();
        onSubmit({
          vendorId,
          catalogItemId,
          startDate: "2026-06-01",
          endDate: "2026-12-31",
          committedQty: Number(committedQty),
          unitPrice: Number(unitPrice),
          currency: "AMD",
          idempotencyKey: `bo-ui-${Date.now()}`
        });
      }}
    >
      <label>
        Մատակարար
        <input value={vendorId} onChange={e => setVendorId(e.target.value)} disabled={busy} required />
      </label>
      <label>
        Catalog Item
        <input value={catalogItemId} onChange={e => setCatalogItemId(e.target.value)} disabled={busy} required />
      </label>
      <label>
        Պարտավորված քանակ
        <input type="number" value={committedQty} onChange={e => setCommittedQty(e.target.value)} disabled={busy} required />
      </label>
      <label>
        Միավոր գին (դրամ)
        <input type="number" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} disabled={busy} required />
      </label>
      <button className="mini-action" type="submit" disabled={busy}>
        {busy ? "..." : "Ստեղծել Blanket պատվեր"}
      </button>
    </form>
  );
}

export function ProcurementExtensionPanel({
  requisitions,
  rfqs,
  coverage,
  actionState,
  onCreateRequisition,
  onConvertToRfq,
  onAllocateLanded,
  onIssueCredit,
  onCreateBlanket
}) {
  const [tab, setTab] = useState("requisitions");
  const busyRequisition = actionState === "procurement:requisition";
  const busyConvert = actionState === "procurement:convert";
  const busyLanded = actionState === "procurement:landed";
  const busyCredit = actionState === "procurement:credit";
  const busyBlanket = actionState === "procurement:blanket";
  return (
    <article className="panel procurement-extension-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Ձեռքբերումների ընդլայնում</span>
          <h2>Procurement extension</h2>
        </div>
        <div className="row">
          <TabButton active={tab === "requisitions"} onClick={() => setTab("requisitions")}>Հայտեր</TabButton>
          <TabButton active={tab === "rfq"} onClick={() => setTab("rfq")}>RFQ / Հարցումներ</TabButton>
          <TabButton active={tab === "blanket"} onClick={() => setTab("blanket")}>Ծածկագրեր (Blanket)</TabButton>
          <TabButton active={tab === "landed"} onClick={() => setTab("landed")}>Լոգիստիկական ծախսեր</TabButton>
          <TabButton active={tab === "credit"} onClick={() => setTab("credit")}>Վերադարձի հաշիվներ</TabButton>
        </div>
      </div>

      {tab === "requisitions" && (
        <div className="section">
          <RequisitionForm
            onSubmit={onCreateRequisition}
            busy={busyRequisition}
            buttonLabel="Ստեղծել հայտ"
          />
          {requisitions && requisitions.length > 0 && (
            <ul className="row">
              {requisitions.map(r => (
                <li key={r.id}>
                  <span className="section-label">{r.id}</span> — {r.neededBy} — {num(r.lines?.length || 0)} տող
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "rfq" && (
        <div className="section">
          <RequisitionForm
            onSubmit={onConvertToRfq}
            busy={busyConvert}
            buttonLabel="Փոխարկել RFQ-ի"
          />
          <RfqResult result={rfqs} />
        </div>
      )}

      {tab === "blanket" && (
        <div className="section">
          <BlanketForm onSubmit={onCreateBlanket} busy={busyBlanket} />
          {coverage && (
            <div className="copilot-result">
              <p>Պարտավորված քանակ՝ <strong>{num(coverage.committedQty)}</strong></p>
              <p>Բաց PO քանակ՝ <strong>{num(coverage.openPoQty)}</strong></p>
              <span className="aging-badge">{num(coverage.blanketOrders)} Blanket</span>
            </div>
          )}
        </div>
      )}

      {tab === "landed" && (
        <div className="section">
          <LandedForm onSubmit={onAllocateLanded} busy={busyLanded} />
        </div>
      )}

      {tab === "credit" && (
        <div className="section">
          <CreditForm onSubmit={onIssueCredit} busy={busyCredit} />
        </div>
      )}
    </article>
  );
}
