import React, { useMemo, useState } from "react";

const DIRECTIONS = ["incoming", "outgoing", "internal"];
const STATUSES = ["active", "archived"];

/**
 * Document Cabinet panel — list (filterable) + viewer (versions) + AI sidebar.
 * Reuses the existing `.panel`, `.panel-head`, `.inline-form`, and
 * `.copilot-result` classes from `styles.css`; no new CSS.
 */
export function CabinetPanel({ data, canWrite, onCreate, onPatch, onAddVersion, onOcr, onAi, onPrepareEsign, onSearch, actionState }) {
  const documents = (data && data.documents) || [];
  const [directionFilter, setDirectionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [versionSelection, setVersionSelection] = useState("");

  // New document form state
  const [newTitle, setNewTitle] = useState("");
  const [newDirection, setNewDirection] = useState("incoming");
  const [newDocType, setNewDocType] = useState("agreement");
  const [newLinkedId, setNewLinkedId] = useState("");
  const [newBody, setNewBody] = useState("");

  // AI result + reply draft state
  const [aiResult, setAiResult] = useState(null);
  const [aiKind, setAiKind] = useState("");
  const [aiError, setAiError] = useState("");
  const [esignResult, setEsignResult] = useState(null);
  const [esignError, setEsignError] = useState("");
  const [searchHits, setSearchHits] = useState(null);
  const [searchError, setSearchError] = useState("");

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter(doc => {
      if (directionFilter && doc.direction !== directionFilter) return false;
      if (statusFilter && doc.status !== statusFilter) return false;
      if (q && !(doc.title || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [documents, directionFilter, statusFilter, searchQuery]);

  const selected = useMemo(
    () => documents.find(d => d.id === selectedId) || filtered[0] || null,
    [documents, filtered, selectedId]
  );

  const busy = (key) => actionState === key;

  function submitNew() {
    if (newTitle.trim().length < 3) return;
    onCreate({
      title: newTitle.trim(),
      direction: newDirection,
      docType: newDocType,
      linkedType: newLinkedId ? "customer" : undefined,
      linkedId: newLinkedId || undefined,
      body: newBody.trim(),
      idempotencyKey: `cab-ui-${Date.now()}`
    });
    setNewTitle(""); setNewBody(""); setNewLinkedId("");
  }

  function toggleArchive() {
    if (!selected || !onPatch) return;
    const nextStatus = selected.status === "archived" ? "active" : "archived";
    onPatch(selected.id, { status: nextStatus });
  }

  function runOcr() {
    if (!selected || !onOcr) return;
    onOcr(selected.id, { idempotencyKey: `cab-ocr-${Date.now()}` });
  }

  function runAi(kind, extras = {}) {
    if (!selected || !onAi) return;
    setAiError("");
    setAiResult(null);
    onAi(selected.id, kind, { ...extras, idempotencyKey: `cab-ai-${kind}-${Date.now()}` })
      .then(response => {
        setAiKind(kind);
        setAiResult(response);
      })
      .catch(err => {
        setAiError(err && err.message ? err.message : `${kind} failed`);
      });
  }

  function runEsign() {
    if (!selected || !onPrepareEsign) return;
    setEsignError("");
    setEsignResult(null);
    onPrepareEsign({
      cabinetId: selected.id,
      signer: { name: "Ստորագրող (signer)", email: "signer@armosphera.local" },
      idempotencyKey: `cab-esign-${Date.now()}`
    })
      .then(response => setEsignResult(response))
      .catch(err => setEsignError(err && err.message ? err.message : "esign prepare failed"));
  }

  function runSearch() {
    if (!onSearch) return;
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits(null);
      setSearchError("");
      return;
    }
    setSearchError("");
    onSearch(q)
      .then(response => setSearchHits((response && response.hits) || []))
      .catch(err => setSearchError(err && err.message ? err.message : "search failed"));
  }

  function renderAiPayload(payload) {
    if (!payload) return null;
    if (aiKind === "classify" && payload.suggestedType) {
      return (
        <div>
          <div><strong>Type:</strong> {payload.suggestedType}</div>
          <div><strong>Confidence:</strong> {payload.confidence}</div>
          {payload.reason ? <div className="muted">{payload.reason}</div> : null}
        </div>
      );
    }
    if (aiKind === "extract" && payload.attributes) {
      return (
        <div>
          <strong>Attributes:</strong>
          <ul style={{ margin: "4px 0", paddingLeft: "16px" }}>
            {Object.entries(payload.attributes).map(([k, v]) => v ? <li key={k}>{k}: {String(v)}</li> : null)}
          </ul>
          <div className="muted">confidence {payload.confidence}</div>
        </div>
      );
    }
    if (aiKind === "risk" && Array.isArray(payload.risks)) {
      return (
        <div>
          {payload.risks.length === 0
            ? <div className="muted">No risks detected.</div>
            : payload.risks.map(r => (
                <div key={r.id} style={{ marginBottom: "4px" }}>
                  <strong>[{r.severity}]</strong> {r.label}
                  {r.excerpt ? <div className="muted" style={{ fontSize: "0.85em" }}>{r.excerpt}</div> : null}
                </div>
              ))}
        </div>
      );
    }
    if (aiKind === "compare" && Array.isArray(payload.diffs)) {
      return (
        <div>
          {payload.diffs.length === 0
            ? <div className="muted">No differences.</div>
            : payload.diffs.map((d, i) => (
                <div key={i} style={{ marginBottom: "4px" }}>
                  <strong>{d.kind}:</strong> {d.text}
                </div>
              ))}
        </div>
      );
    }
    if (aiKind === "reply" && payload.body) {
      return <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{payload.body}</pre>;
    }
    return <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(payload, null, 2)}</pre>;
  }

  return (
    <article className="panel cabinet-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">A1 Docs &amp; Sign · Փաստաթղթաշրջանառություն</span>
          <h2>Document Cabinet</h2>
        </div>
        <strong className="aging-badge">{filtered.length} of {documents.length}</strong>
      </div>
      <div className="inline-form">
        <select value={directionFilter} onChange={event => setDirectionFilter(event.target.value)}>
          <option value="">— Ուղղություն (all) —</option>
          {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="">— Կարգավիճակ (all) —</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder="Փնտրել (search title)"
        />
        {onSearch ? (
          <button className="mini-action" type="button" disabled={busy("cabinet:search")} onClick={runSearch}>
            {busy("cabinet:search") ? "Searching" : "FTS search"}
          </button>
        ) : null}
      </div>
      {searchHits ? (
        <div className="copilot-result">
          <strong>FTS hits ({searchHits.length}):</strong>
          {searchHits.length === 0
            ? <div className="muted">no matches</div>
            : searchHits.map(h => (
                <div key={h.cabinetId}>
                  <a href="#" onClick={event => { event.preventDefault(); setSelectedId(h.cabinetId); }}>{h.title}</a>
                </div>
              ))}
        </div>
      ) : null}
      {searchError ? <p className="action-status" role="alert">error: {searchError}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr", gap: "10px", marginTop: "10px" }}>
        {/* Column 1: list */}
        <div className="rows">
          {filtered.length === 0 ? <div className="row"><span>No documents match the filter.</span></div> : null}
          {filtered.map(doc => {
            const isSelected = selected && selected.id === doc.id;
            return (
              <div className="row" key={doc.id} style={{ flexDirection: "column", alignItems: "stretch", gap: "4px", borderLeft: isSelected ? "3px solid var(--accent, #0a7)" : "3px solid transparent", paddingLeft: "8px" }}>
                <a href="#" onClick={event => { event.preventDefault(); setSelectedId(doc.id); setVersionSelection(""); setAiResult(null); }}>{doc.title}</a>
                <div className="muted" style={{ fontSize: "0.85em" }}>
                  {doc.direction} · {doc.status} · v{doc.currentVersion}{doc.linkedId ? ` · ${doc.linkedType}:${doc.linkedId}` : ""}
                </div>
              </div>
            );
          })}
        </div>

        {/* Column 2: viewer */}
        <div>
          {!selected ? (
            <div className="row"><span>Select a document from the list.</span></div>
          ) : (
            <div>
              <div style={{ marginBottom: "6px" }}>
                <strong>{selected.title}</strong>
                <div className="muted" style={{ fontSize: "0.85em" }}>
                  {selected.direction} · {selected.status} · v{selected.currentVersion}
                  {selected.docType ? ` · ${selected.docType}` : ""}
                </div>
              </div>
              {onPatch && canWrite ? (
                <div className="inline-form" style={{ gap: "6px" }}>
                  <button className="mini-action" type="button" disabled={busy(`cabinet:patch:${selected.id}`)} onClick={toggleArchive}>
                    {busy(`cabinet:patch:${selected.id}`)
                      ? "Updating"
                      : selected.status === "archived" ? "Restore" : "Archive"}
                  </button>
                  <button className="mini-action" type="button" disabled={busy(`cabinet:ocr:${selected.id}`)} onClick={runOcr}>
                    {busy(`cabinet:ocr:${selected.id}`) ? "Queuing OCR" : "Queue OCR"}
                  </button>
                  <button className="mini-action" type="button" disabled={busy("cabinet:esign")} onClick={runEsign}>
                    {busy("cabinet:esign") ? "Preparing" : "Prepare e-sign"}
                  </button>
                </div>
              ) : null}
              {selected.ocrStatus ? (
                <div className="muted" style={{ fontSize: "0.85em", marginTop: "4px" }}>OCR status: {selected.ocrStatus}</div>
              ) : null}
              <div style={{ marginTop: "8px" }}>
                <strong>Version</strong>
                <select value={versionSelection} onChange={event => setVersionSelection(event.target.value)}>
                  <option value="">— current (v{selected.currentVersion}) —</option>
                  {/* Versions are loaded on read; surface from data prop when present. */}
                  {((data && data.versionsById && data.versionsById[selected.id]) || []).map(v => (
                    <option key={v.id} value={v.version}>v{v.version}{v.parentVersion ? ` (from v${v.parentVersion})` : ""}</option>
                  ))}
                </select>
              </div>
              {esignResult ? (
                <div className="copilot-result" style={{ marginTop: "6px" }}>
                  <strong>E-sign envelope</strong>
                  <div>id: {esignResult.envelopeId}</div>
                  <div>provider: {esignResult.provider}</div>
                  <div>status: {esignResult.status}</div>
                </div>
              ) : null}
              {esignError ? <p className="action-status" role="alert">error: {esignError}</p> : null}
            </div>
          )}
        </div>

        {/* Column 3: AI sidebar */}
        <div>
          <strong>AI assist</strong>
          <div className="inline-form" style={{ gap: "4px", flexWrap: "wrap" }}>
            {onAi ? (
              <>
                <button className="mini-action" type="button" disabled={!selected || busy("cabinet:ai:classify")} onClick={() => runAi("classify")}>Classify</button>
                <button className="mini-action" type="button" disabled={!selected || busy("cabinet:ai:extract")} onClick={() => runAi("extract")}>Extract</button>
                <button className="mini-action" type="button" disabled={!selected || busy("cabinet:ai:risk-scan")} onClick={() => runAi("risk-scan")}>Risk scan</button>
                <button className="mini-action" type="button" disabled={!selected || busy("cabinet:ai:compare")} onClick={() => runAi("compare", { leftText: selected ? selected.title : "", rightText: selected ? selected.title : "" })}>Compare</button>
                <button className="mini-action" type="button" disabled={!selected || busy("cabinet:ai:reply-draft")} onClick={() => runAi("reply-draft", { tone: "formal", language: "hy-AM" })}>Reply draft</button>
              </>
            ) : (
              <span className="muted">AI not wired in this build.</span>
            )}
          </div>
          {aiResult ? (
            <div className="copilot-result" style={{ marginTop: "6px" }}>
              <strong>{aiKind}</strong>
              {renderAiPayload(aiResult.result || aiResult)}
            </div>
          ) : null}
          {aiError ? <p className="action-status" role="alert">error: {aiError}</p> : null}
        </div>
      </div>

      {canWrite ? (
        <div className="inline-form" style={{ marginTop: "10px" }}>
          <input
            value={newTitle}
            onChange={event => setNewTitle(event.target.value)}
            placeholder="Վերնագիր (title)"
          />
          <select value={newDirection} onChange={event => setNewDirection(event.target.value)}>
            {DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={newDocType} onChange={event => setNewDocType(event.target.value)}>
            {["agreement", "nda", "contract", "offer", "policy", "other"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            value={newLinkedId}
            onChange={event => setNewLinkedId(event.target.value)}
            placeholder="customer id (optional)"
          />
          <input
            value={newBody}
            onChange={event => setNewBody(event.target.value)}
            placeholder="Բովանդակություն (body)"
          />
          <button className="mini-action" type="button" disabled={busy("cabinet:create") || newTitle.trim().length < 3} onClick={submitNew}>
            {busy("cabinet:create") ? "Creating" : "Create cabinet doc"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
