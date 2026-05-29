import React, { useState } from "react";

const amd = value => `${Number(value || 0).toLocaleString("hy-AM")} AMD`;

export function FinanceTrialBalancePanel({ data }) {
  if (!data) return null;
  const rows = data.rows || [];
  return (
    <article className="panel finance-trial-balance-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">HayHashvapah Finance</span>
          <h2>Trial balance</h2>
        </div>
        <strong className="aging-badge">{data.balanced ? "Balanced" : "Out of balance"}</strong>
      </div>
      <div className="rows">
        {rows.map(row => (
          <div className="row" key={row.code}>
            <span>{row.code} · {row.name}</span>
            <strong>{amd(row.balance)}</strong>
          </div>
        ))}
        {rows.length === 0 && <div className="row"><span>No ledger entries yet</span></div>}
      </div>
      <div className="meta-row">
        <span>Debits {amd(data.totalDebit)}</span>
        <span>Credits {amd(data.totalCredit)}</span>
      </div>
    </article>
  );
}

export function FinanceStatementsPanel({ data }) {
  if (!data) return null;
  const income = data.incomeStatement || {};
  const sheet = data.balanceSheet || {};
  return (
    <article className="panel finance-statements-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">HayHashvapah Finance</span>
          <h2>Financial statements</h2>
        </div>
        <strong className="aging-badge">{sheet.balanced ? "Balanced" : "Check"}</strong>
      </div>
      <div className="aging-summary">
        <div className="metric"><span>income</span><strong>{amd(income.totalIncome)}</strong></div>
        <div className="metric"><span>expense</span><strong>{amd(income.totalExpense)}</strong></div>
        <div className="metric"><span>net profit</span><strong>{amd(income.netProfit)}</strong></div>
      </div>
      <div className="aging-summary">
        <div className="metric"><span>assets</span><strong>{amd(sheet.totalAssets)}</strong></div>
        <div className="metric"><span>liabilities</span><strong>{amd(sheet.totalLiabilities)}</strong></div>
        <div className="metric"><span>equity</span><strong>{amd(sheet.totalEquity)}</strong></div>
      </div>
    </article>
  );
}

export function FinanceVatPanel({ data }) {
  if (!data) return null;
  return (
    <article className="panel finance-vat-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">HayHashvapah Finance</span>
          <h2>VAT report · ԱԱՀ</h2>
        </div>
        <strong className="aging-badge">{data.periodKey}</strong>
      </div>
      <div className="aging-summary">
        <div className="metric"><span>output VAT</span><strong>{amd(data.outputVat)}</strong></div>
        <div className="metric"><span>input VAT</span><strong>{amd(data.inputVat)}</strong></div>
        <div className="metric"><span>net payable</span><strong>{amd(data.netVatPayable)}</strong></div>
      </div>
      {data.note && <p className="action-status">{data.note}</p>}
    </article>
  );
}

export function FinanceExpenseForm({ onCreate, actionState }) {
  const [description, setDescription] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [vat, setVat] = useState("");
  const busy = actionState === "expense:create";
  function submit() {
    const net = Math.round(Number(subtotal) || 0);
    if (net <= 0) return;
    onCreate({ description, subtotal: net, vat: Math.round(Number(vat) || 0) });
    setDescription("");
    setSubtotal("");
    setVat("");
  }
  return (
    <article className="panel finance-expense-form-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">HayHashvapah Finance</span>
          <h2>Quick expense</h2>
        </div>
      </div>
      <div className="inline-form">
        <input value={description} onChange={event => setDescription(event.target.value)} placeholder="Նկարագրություն" />
        <input value={subtotal} onChange={event => setSubtotal(event.target.value)} inputMode="numeric" placeholder="Զուտ (AMD)" />
        <input value={vat} onChange={event => setVat(event.target.value)} inputMode="numeric" placeholder="ԱԱՀ (AMD)" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Posting" : "Post expense"}</button>
      </div>
    </article>
  );
}

export function LegalSearchPanel({ onSearch }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await onSearch(query.trim()));
    } catch {
      setResults({ ready: true, results: [] });
    } finally {
      setBusy(false);
    }
  }
  const rows = (results && results.results) || [];
  return (
    <article className="panel legal-search-panel">
      <div className="panel-head">
        <div>
          <span className="section-label">Armenian law · RAG</span>
          <h2>Law search</h2>
        </div>
      </div>
      <div className="inline-form">
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") run(); }}
          placeholder="Հարցում (օր. ԱԱՀ դրույքաչափ)"
        />
        <button className="mini-action" type="button" disabled={busy} onClick={run}>{busy ? "Searching" : "Search"}</button>
      </div>
      {results && (
        <div className="rows">
          {rows.map((row, index) => (
            <div className="row" key={index}>
              <span>{row.lawTitle} · {row.article}</span>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="row"><span>{results.ready === false ? "Legal KB not installed" : "No matches"}</span></div>
          )}
        </div>
      )}
    </article>
  );
}
