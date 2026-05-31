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

export function FinanceBillForm({ onCreate, actionState }) {
  const [supplier, setSupplier] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [vat, setVat] = useState("");
  const [dueDate, setDueDate] = useState("");
  const busy = actionState === "bill:create";
  function submit() {
    const net = Math.round(Number(subtotal) || 0);
    if (net <= 0) return;
    onCreate({ supplier, subtotal: net, vat: Math.round(Number(vat) || 0), dueDate: dueDate || undefined });
    setSupplier(""); setSubtotal(""); setVat(""); setDueDate("");
  }
  return (
    <article className="panel finance-bill-form-panel">
      <div className="panel-head"><div><span className="section-label">HayHashvapah Finance</span><h2>New supplier bill</h2></div></div>
      <div className="inline-form">
        <input value={supplier} onChange={event => setSupplier(event.target.value)} placeholder="Մատակարար" />
        <input value={subtotal} onChange={event => setSubtotal(event.target.value)} inputMode="numeric" placeholder="Զուտ (AMD)" />
        <input value={vat} onChange={event => setVat(event.target.value)} inputMode="numeric" placeholder="ԱԱՀ (AMD)" />
        <input value={dueDate} onChange={event => setDueDate(event.target.value)} placeholder="Վճարման ժ. (YYYY-MM-DD)" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Posting" : "Post bill"}</button>
      </div>
    </article>
  );
}

export function FinancePayrollForm({ onRun, actionState }) {
  const [employeeName, setEmployeeName] = useState("");
  const [gross, setGross] = useState("");
  const busy = actionState === "payroll:run";
  function submit() {
    const value = Math.round(Number(gross) || 0);
    if (value <= 0) return;
    onRun({ employeeName, gross: value });
    setEmployeeName(""); setGross("");
  }
  return (
    <article className="panel finance-payroll-form-panel">
      <div className="panel-head"><div><span className="section-label">HayHashvapah Finance</span><h2>Run payroll</h2></div></div>
      <div className="inline-form">
        <input value={employeeName} onChange={event => setEmployeeName(event.target.value)} placeholder="Աշխատող" />
        <input value={gross} onChange={event => setGross(event.target.value)} inputMode="numeric" placeholder="Համախառն (AMD)" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Running" : "Run payroll"}</button>
      </div>
    </article>
  );
}

export function FinancePayablesPanel({ data }) {
  if (!data) return null;
  const aging = data.aging || {};
  const buckets = [["current", "Current"], ["days1To30", "1-30"], ["days31To60", "31-60"], ["days61To90", "61-90"], ["over90", "90+"]];
  return (
    <article className="panel finance-payables-panel">
      <div className="panel-head">
        <div><span className="section-label">HayHashvapah Finance</span><h2>Payables · AP aging</h2></div>
        <strong className="aging-badge">{(data.openBills && data.openBills.length) || 0} open</strong>
      </div>
      <div className="aging-summary">
        <div className="metric"><span>billed</span><strong>{amd(data.totalBilled)}</strong></div>
        <div className="metric"><span>outstanding</span><strong>{amd(data.totalOutstanding)}</strong></div>
        <div className="metric"><span>overdue</span><strong>{amd(data.overdueOutstanding)}</strong></div>
      </div>
      <div className="rows">
        {buckets.map(([key, label]) => (
          <div className="row" key={key}><span>{label}</span><strong>{amd(aging[key] || 0)}</strong></div>
        ))}
      </div>
    </article>
  );
}

// Balance-sheet accounts eligible for opening balances (P&L accounts reset each
// period and the 331 contra is posted automatically, so neither is offered here).
const OPENING_BALANCE_ACCOUNTS = [
  { code: "251", name: "Դրամարկղ" },
  { code: "252", name: "Հաշվարկային հաշիվ" },
  { code: "221", name: "Դեբիտորական պարտքեր" },
  { code: "526", name: "ԱԱՀ դեբետ (մուտքային)" },
  { code: "521", name: "Կրեդիտորական պարտքեր" },
  { code: "524", name: "ԱԱՀ վճարվելիք" },
  { code: "525", name: "Հաշվարկներ բյուջեի և հիմնադրամների հետ" }
];

export function FinanceOpeningBalancesPanel({ data }) {
  if (!data) return null;
  const entries = data.entries || [];
  return (
    <article className="panel finance-opening-balances-panel">
      <div className="panel-head">
        <div><span className="section-label">HayHashvapah Finance</span><h2>Opening balances · Բացման մնացորդներ</h2></div>
        <strong className="aging-badge">{amd(data.openingEquity)} equity</strong>
      </div>
      <div className="rows">
        {entries.map(entry => (
          <div className="row" key={`${entry.code}-${entry.date}`}>
            <span>{entry.code} · {entry.name}</span>
            <strong>{entry.side === "credit" ? `(${amd(entry.amount)})` : amd(entry.amount)}</strong>
          </div>
        ))}
        {entries.length === 0 && <div className="row"><span>No opening balances set</span></div>}
      </div>
    </article>
  );
}

export function FinanceOpeningBalancesForm({ onSubmit, actionState }) {
  const [asOf, setAsOf] = useState("");
  const [code, setCode] = useState(OPENING_BALANCE_ACCOUNTS[0].code);
  const [amount, setAmount] = useState("");
  const [lines, setLines] = useState([]);
  const busy = actionState === "opening-balances:set";
  const nameByCode = Object.fromEntries(OPENING_BALANCE_ACCOUNTS.map(a => [a.code, a.name]));
  function addLine() {
    const value = Math.round(Number(amount) || 0);
    if (value <= 0) return;
    setLines([...lines.filter(line => line.code !== code), { code, amount: value }]);
    setAmount("");
  }
  function submit() {
    if (lines.length === 0) return;
    onSubmit({ asOf: asOf || undefined, entries: lines });
    setLines([]);
  }
  return (
    <article className="panel finance-opening-balances-form-panel">
      <div className="panel-head"><div><span className="section-label">HayHashvapah Finance</span><h2>Set opening balances</h2></div></div>
      <div className="inline-form">
        <input type="date" value={asOf} onChange={event => setAsOf(event.target.value)} placeholder="Ամսաթիվ (YYYY-MM-DD)" />
        <select value={code} onChange={event => setCode(event.target.value)}>
          {OPENING_BALANCE_ACCOUNTS.map(account => (
            <option key={account.code} value={account.code}>{account.code} · {account.name}</option>
          ))}
        </select>
        <input value={amount} onChange={event => setAmount(event.target.value)} inputMode="numeric" placeholder="Գումար (AMD)" />
        <button className="mini-action" type="button" onClick={addLine}>Add line</button>
      </div>
      {lines.length > 0 && (
        <div className="rows">
          {lines.map(line => (
            <div className="row" key={line.code}><span>{line.code} · {nameByCode[line.code]}</span><strong>{amd(line.amount)}</strong></div>
          ))}
        </div>
      )}
      <div className="inline-form">
        <button className="mini-action" type="button" disabled={busy || lines.length === 0} onClick={submit}>{busy ? "Posting" : "Post opening balances"}</button>
      </div>
    </article>
  );
}

// Read-only history lists over the existing GET endpoints — give each posted record a visible
// row (previously only rollups/forms existed; a posted expense/bill/payroll run had no listing).
export function FinanceExpenseListPanel({ data }) {
  const expenses = (data && data.expenses) || [];
  const total = expenses.reduce((sum, e) => sum + (Number(e.total) || 0), 0);
  return (
    <article className="panel finance-expense-list-panel">
      <div className="panel-head">
        <div><span className="section-label">HayHashvapah Finance</span><h2>Expenses · Ծախսեր</h2></div>
        <strong className="aging-badge">{expenses.length}</strong>
      </div>
      <div className="rows">
        {expenses.map(item => (
          <div className="row" key={item.id}>
            <span>{(item.incurredOn || "").slice(0, 10)} · {item.description || "—"}{item.vendor ? ` · ${item.vendor}` : ""}</span>
            <strong>{amd(item.total)}</strong>
          </div>
        ))}
        {expenses.length === 0 && <div className="row"><span>No expenses recorded</span></div>}
      </div>
      {expenses.length > 0 && <div className="meta-row"><span>Total</span><span>{amd(total)}</span></div>}
    </article>
  );
}

export function FinanceBillListPanel({ data }) {
  const bills = (data && data.bills) || [];
  const total = bills.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
  return (
    <article className="panel finance-bill-list-panel">
      <div className="panel-head">
        <div><span className="section-label">HayHashvapah Finance</span><h2>Supplier bills · Մատակարարների հաշիվներ</h2></div>
        <strong className="aging-badge">{bills.length}</strong>
      </div>
      <div className="rows">
        {bills.map(item => (
          <div className="row" key={item.id}>
            <span>{(item.billDate || "").slice(0, 10)} · {item.supplier || "—"} · <strong>{item.status || "open"}</strong>{item.dueDate ? ` · due ${item.dueDate.slice(0, 10)}` : ""}</span>
            <strong>{amd(item.total)}</strong>
          </div>
        ))}
        {bills.length === 0 && <div className="row"><span>No supplier bills</span></div>}
      </div>
      {bills.length > 0 && <div className="meta-row"><span>Total</span><span>{amd(total)}</span></div>}
    </article>
  );
}

export function FinancePayrollRunsPanel({ data }) {
  const runs = (data && data.payrollRuns) || [];
  const totalNet = runs.reduce((sum, r) => sum + (Number(r.net) || 0), 0);
  return (
    <article className="panel finance-payroll-runs-panel">
      <div className="panel-head">
        <div><span className="section-label">HayHashvapah Finance</span><h2>Payroll runs · Աշխատավարձի հաշվարկներ</h2></div>
        <strong className="aging-badge">{runs.length}</strong>
      </div>
      <div className="rows">
        {runs.map(item => (
          <div className="row" key={item.id}>
            <span>{(item.runDate || "").slice(0, 10)} · {item.employeeName || "—"} · gross {amd(item.gross)} − tax/pension/stamp {amd(item.totalDeductions)}</span>
            <strong>{amd(item.net)}</strong>
          </div>
        ))}
        {runs.length === 0 && <div className="row"><span>No payroll runs</span></div>}
      </div>
      {runs.length > 0 && <div className="meta-row"><span>Total net paid</span><span>{amd(totalNet)}</span></div>}
    </article>
  );
}
