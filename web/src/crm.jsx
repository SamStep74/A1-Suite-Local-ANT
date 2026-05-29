import React from "react";

const amd = value => `${Number(value || 0).toLocaleString("hy-AM")} AMD`;

export function CrmQuotesPanel({ data, actionState, onRequestApproval }) {
  const quotes = (data && data.quotes) || [];
  return (
    <article className="panel crm-quotes-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Armosphera CRM</span>
          <h2>Quotes pipeline</h2>
        </div>
        <strong className="aging-badge">{quotes.length} quotes</strong>
      </div>
      <div className="rows">
        {quotes.map(quote => (
          <div className="row" key={quote.id}>
            <span>{quote.customerName} · {quote.number || quote.title || quote.id} · {quote.status}</span>
            <strong>{amd(quote.total)}</strong>
            {quote.status === "draft" && onRequestApproval && (
              <button
                className="mini-action"
                type="button"
                disabled={actionState === `quote:approve:${quote.id}`}
                onClick={() => onRequestApproval(quote.id)}
              >
                {actionState === `quote:approve:${quote.id}` ? "Requesting" : "Request release"}
              </button>
            )}
          </div>
        ))}
        {quotes.length === 0 && <div className="row"><span>No quotes yet</span></div>}
      </div>
    </article>
  );
}
