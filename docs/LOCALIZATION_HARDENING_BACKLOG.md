# RA Localization Hardening Backlog

_Source: an adversarial audit of the Armenian (RA) localization engines — 5 parallel
auditors (localization kernel, chart+ledger, e-invoice, VAT return, payroll) followed
by manual source verification against the official RA rules. Dated 2026-06-06._

Each item lists **severity**, **location**, the **official rule** (or an honest
"UNVERIFIED" seam), and a **suggested fix**. Items are grouped by what is safe to do:
shipped, actionable-and-sourced, needs-primary-source, and needs-an-accountant/product
decision. **Do not implement anything in the "needs primary source" section until the
cited statute is confirmed** — fabricating a tax rule is worse than leaving a seam.

---

## ✅ Shipped this session (audit follow-ups, merged to `main`)

| PR | Engine | Change |
|----|--------|--------|
| #44 | e-invoice | `validateEInvoice` — fail-closed SRC compliance gate (transaction type, supplier/buyer ՀՎՀՀ-or-passport, line rules) |
| #45 | VAT return | `validateVatReturnForm` — cross-foot guard (lines 16/21/23 tie-out, integer/non-negative) |
| #47 | VAT return | rate-plausibility band — `FORM_7_RATE_MISMATCH` (≈20%), `FORM_9_RATE_MISMATCH` (≈16.67%), tolerant of per-line rounding drift |
| #48 | e-invoice | `LINE_VAT_MISMATCH` (explicit line VAT must match rate) + `normalizeLine` quantity guard (never emit `<Quantity>NaN</Quantity>`) |

---

## 🟢 Open — sourced & actionable (safe to implement next, in-lane pure modules)

### [HIGH] localization: `roundAmd` silently coerces un-parseable strings to 0
- **Location:** `server/localization.js` — `roundAmd` (reached via `formatAmd` too)
- **Rule:** Correctness/robustness (memory confirms only "whole AMD", which the function honors). Not a tax rule.
- **Defect:** `roundAmd("1,000") → 0`, `roundAmd("") → 0`, `formatAmd("1,000") → "0 ֏"`. A grouped/formatted amount round-trips to a silent **0**, corrupting money with no error. Uncovered by tests.
- **Fix (with care):** Fail loud on non-empty un-parseable input (throw or `{ok:false}` envelope). **Constraint:** keep the existing `roundAmd(undefined) → 0` contract — `einvoice.normalizeLine` / `vatReturn.lineVat` rely on absent fields defaulting to 0. So: coerce numbers + `null`/`undefined` → 0 as today, but reject a non-empty **string** that doesn't parse cleanly.

### [LOW] VAT return: `computeVatReturn` and `vatReturnForm` are parallel, unreconciled netting paths
- **Location:** `server/vatReturn.js` — `computeVatReturn` vs `vatReturnForm`
- **Rule:** Internal consistency (no external rule).
- **Defect:** Both compute output−input VAT independently; no test asserts they agree, so they can silently drift.
- **Fix:** Add a characterization test asserting `computeVatReturn(period).net === form.lines["16"].vat − form.lines["21"].vat` for shared fixtures. Pure test, zero risk.

### [LOW] e-invoice: builder/validator buyer-id asymmetry + unvalidated supplier `vatId`
- **Location:** `server/einvoice.js` — `buildEInvoiceXml` buyerId branch; `validateEInvoice`
- **Defect:** Builder keys `<TaxId>` off `buyer.hvhh || buyer.taxId`, so a passport-only individual carrying a stray `taxId` never renders `<PassportSeries>`. Supplier `vatId` (ԱԱՀՎՀՀ) is emitted unvalidated.
- **Fix:** Prefer `buyer.hvhh` for `<TaxId>`, fall back to passport; optionally format-check `vatId` when present.

---

## 🟡 Open — needs PRIMARY-SOURCE confirmation (do NOT implement until sourced)

### [HIGH] payroll: health-insurance encoded with an unverified stamp-duty offset (assumes offset = 0) — ⏳ UNDER VERIFICATION
- **Location:** `server/armeniaPayroll.js` — `healthInsurance()`, `computePayroll()` (`totalWithholdings = tax + pen + stamp + health`)
- **Rule:** UNVERIFIED. Memory (`ra_official_data_sources.md`) states the Dec-2025 mandatory health insurance "(4,800/10,800 headline) has an **unclear stamp-duty offset** → NOT yet encoded (needs SRC/arlis.am primary text)."
- **Defect:** PR #43 (commit `f5621f9`) removed the honest disclaimer and now withholds the **full** stamp duty (1,000/15,000) **AND** the **full** health premium (4,800/10,800) — silently asserting offset = 0. The band thresholds (200,001 / 500,000) and amounts cite `arlis.am/acts/218650` (ՀՕ-459-Ն), a source not yet confirmed. If the law nets health insurance against the stamp duty, **every payslip over-withholds**.
- **Action:** A live web-research pass (arlis.am / SRC / PwC) is verifying the amounts, bands, base, and — critically — the offset interaction. **Pending that, this MUST be flagged to a human/accountant before relying on net-pay figures; do not unilaterally change tax-withholding logic.** Outcomes: (a) loop correct → update memory, mark sourced; (b) loop wrong → TDD fix; (c) unverifiable → gate behind an explicit "offset unconfirmed" flag or revert to the seam.

### [HIGH] VAT return: per-line rounding vs whole-form-total rounding (which is canonical?)
- **Location:** `server/vatReturn.js` — `lineVat` / `vatReturnForm`
- **Rule:** UNVERIFIED. Decree N 298-Ն mandates whole-dram cells but the filing instructions' rounding convention (per-line vs per-total) is not in our sources.
- **Defect:** Per-line `roundAmd` then summing drifts from rounding the aggregated base (7×333@20% → 469 vs 466). Real but the "correct" convention is unconfirmed.
- **Fix:** Confirm the decree's filling instructions, then standardize on one convention.

### [MEDIUM] VAT return: imputed-rate detection hard-codes 16.67 and silently routes unknown rates to line 7
- **Location:** `server/vatReturn.js` — `classifySale` (`Math.abs(rate − 16.67) < 0.01`)
- **Defect:** A non-zero, non-20, non-16.67 rate falls through to the standard 20% bucket (line 7) silently.
- **Fix:** Route unrecognized positive rates to an explicit error/`other` bucket rather than defaulting to line 7. (Confirm the exact imputed fraction — 20/120 = 16.6667 — against the decree.)

### [MEDIUM] VAT return: negative aggregate cells (credit-note-heavy periods) are computed but rejected by the guard
- **Location:** `server/vatReturn.js` — `vatReturnForm` (carries negatives) vs `validateVatReturnForm` `FORM_NEGATIVE_AMOUNT`
- **Rule:** UNVERIFIED — whether the N 298-Ն return permits negative period-aggregate cells.
- **Defect:** A legitimate credit-note-dominated period produces negative line bases that the fail-closed guard then rejects, blocking the filing.
- **Fix:** Confirm whether the form allows negative cells. If yes, relax non-negativity to derived totals only; if no, reject earlier in `vatReturnForm` with a clear message.

### [MEDIUM] payroll: health-insurance band thresholds (200,001 / 500,000) not traceable to a cited source
- **Location:** `server/armeniaPayroll.js` — `HEALTH_INSURANCE_*` constants
- **Rule:** UNVERIFIED — memory records only the "4,800/10,800 headline"; the 200,001 floor and 500,000 split appear in no audited source.
- **Fix:** Cite the verbatim ՀՕ-459-Ն article for the amounts + cutoffs (and confirm the base is gross), or mark the constants UNVERIFIED. (Folded into the verification pass above.)

### [MEDIUM] ledger: output VAT and other tax liabilities both post to the umbrella account 524
- **Location:** `server/ledger.js` — invoice VAT → `creditCode: "524"`; `vatReport` sums `credit_code='524'`
- **Rule:** UNVERIFIED — whether a dedicated VAT-payable sub-account of 524 is mandated (arlis.am/acts/75961).
- **Defect:** 524 is "taxes **and other mandatory payments**"; coupling VAT reporting to a shared account is fragile (accurate today only because nothing else credits 524).
- **Fix:** Post output VAT to a dedicated 524 sub-account once the official sub-code is confirmed.

### [LOW] localization: `Math.round` half-way is asymmetric on negatives
- **Location:** `server/localization.js` — `roundAmd` (`Math.round`)
- **Rule:** UNVERIFIED — no RA half-way tie-break rule in our sources.
- **Defect:** `roundAmd(2.5)=3` but `roundAmd(-2.5)=-2`; reversing pairs may not be equal-and-opposite at exact halves.
- **Fix:** If symmetric rounding is required, `Math.sign(n)*Math.round(Math.abs(n))` — but confirm the RA tie-break first.

---

## 🔵 Open — needs an accountant / product decision (touches operational posting code)

> These change ledger postings. They affect existing data and are in files the
> operational/loop track also edits — coordinate before touching, and migrate data.

### [HIGH] ledger: opening-balance equity posts to 331 (Profit/Loss) not 311 (Share capital)
- **Location:** `server/ledger.js` — `OPENING_BALANCE_EQUITY_CODE = "331"`
- **Rule:** Memory documents 311 as the standard; chart confirms `311 = Կանոնադրական կապիտալ`, `331 = Շահույթ կամ վնաս`.
- **Nuance (why this needs a human):** Booking opening net assets into **311 Share capital** is itself questionable accounting — opening balances typically offset to retained earnings / an opening-balance-equity account, which is closer to **331**. The memory's "reconcile to 311" may conflict with sound practice. **Decision required**, not a mechanical swap. Whatever is chosen needs a migration of existing `source_type='opening_balance'` rows.

### [MEDIUM] ledger: legacy input-VAT code 526 is not in the official chart
- **Location:** `server/ledger.js` — `LEGACY_INPUT_VAT_ACCOUNT_CODE = "526"` (read-time shim in `vatReport`)
- **Defect:** New postings correctly use **226**; 526 is a back-compat read shim for legacy data and 526 is absent from the chart (orphaned rows).
- **Fix:** One-time migrate `debit_code='526'` → `226`, then drop the shim.

### [LOW] ledger: payroll gross expensed to 714 (other operating expenses) not a labor-cost account
- **Location:** `server/ledger.js` — `postPayrollRun` debits 714
- **Rule:** Chart has dedicated labor accounts `7121`/`7131`.
- **Fix:** Debit the labor-expense account per the org's costing model (confirm exact code with an accountant). Double-entry is already balanced.

### [LOW] ledger: `vatReport` has no rate dimension (cannot split 20% vs 16.67% imputed output VAT)
- **Location:** `server/ledger.js` — `vatReport` (already self-flagged "indicative")
- **Fix:** Carry the VAT rate / form-line on the journal entry so `vatReport` can map to form lines 7 vs 9. (Pairs with the `vatReturn.js` form mapping.)

---

## ⚪ Noted, won't-fix (extreme edge)

### [LOW] localization: `formatAmd` thousands-grouping breaks for magnitudes ≥ 1e21
- `String(Number)` switches to exponential notation; the grouping regex can't group it. Below 1e21 (incl. past `MAX_SAFE_INTEGER`) it is correct. Not a realistic AMD ledger value.

---

## Areas the audit found SOLID (no defects)

- **Chart of accounts:** exactly 623 accounts across 9 classes, zero duplicate codes, per-record class/type 100% consistent with the leading digit; `accountByCode`/`accountClass`/`normalBalance` correct.
- **ՀՎՀՀ kernel:** exactly-8-numeric-digits validation, strips separators, rejects degenerate sequences and scientific/hex strings, treats blank as required-error, exposes `checkDigitVerifier` as an explicit seam.
- **Immutability:** no engine mutates its inputs; `AMD` is frozen.
- **e-invoice:** `xmlEscape` covers all 5 entities and is applied to every free-text/attribute interpolation; SRC mandatory field set complete in `validateEInvoice`; arithmetic (`total = net+vat+excise+envFee`, whole-dram) correct.
- **VAT return:** exempt-vs-zero precedence correct (art. 64 exempt wins over rate); import/domestic split; `recoverable===false` exclusion; `Math.max(0, ±net)` carry-credit (no auto-refund).
- **payroll:** income tax flat 20%; pension tiers + cap + boundaries (continuous at 500,000 and 1,125,000); stamp-duty 2-bracket; all withholdings off gross. _(Only the health-insurance addition is in question — see above.)_
- **Double-entry:** every ledger posting helper is balanced per leg; `trialBalance` asserts debits == credits.
