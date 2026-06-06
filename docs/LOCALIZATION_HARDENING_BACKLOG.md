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

### [✅ RESOLVED — PR #56] payroll: stamp-duty over-withholding fixed; health insurance was already correct
- **Location:** `server/armeniaPayroll.js` — `stampDuty()` (fixed), `healthInsurance()` (unchanged)
- **Status:** **FIXED 2026-06-06 (PR #56, user-authorized).** Reading the actual code showed the root cause was NOT health insurance but the **stamp duty**: PR #43 charged a baseless **15,000** above 1M gross. Corrected to a **flat 1,000/mo** for all employees (the 2026 revision). Health insurance was left as-is — it is correct as deduction lines (see below). **Residual (low risk, not modeled):** social-package staff get no reimbursement → net higher; confirm vs `arlis.am ՀՕ-459-Ն` with an accountant.
- **What PR #43 did wrong:** `stampDuty` returned 15,000 above 1,000,000 gross — no source supports this; it over-withheld ~14,000/mo from high earners. Health (4,800/10,800) was already right.
- **Actual 2026 RA structure (effective monthly EMPLOYEE cost by gross):**

  | Gross salary band (AMD) | Effective employee cost (AMD/mo) |
  |---|---|
  | ≤ 200,000 | 0 — obligation begins **2027** |
  | 200,001 – 500,000 | **300** |
  | 500,001 – 1,000,000 | **3,300** |
  | > 1,000,000 | **10,800** (full premium) |

  The full MHI **premium** is 10,800/mo (129,600/yr). The low bands are **net of two offsets**: the military **stamp duty was revised to a flat 1,000/mo** (replacing the old 1,500/3,000/5,500/8,500 tiers), **plus a ~6,000 state reimbursement** for employees who are **not** social-package beneficiaries (education/culture/social-protection state staff get no reimbursement → higher net).
- **Impact:** for a 300,000 AMD salary, PR #43 withholds ~4,800 + full stamp instead of the correct ~300 net — a large over-withholding on most payslips.
- **Sources:** profin.am "universal mandatory insurance" explainer; usemultiplier.com; jam-news.net; easytaxes.am (premium = 10,800). Primary law: `arlis.am` **ՀՕ-459-Ն** (not yet read in full — needed for the social-package edge and the exact 2026 stamp-duty value, which conflicts: memory had 1,000/15,000 two-bracket vs profin's flat 1,000).
- **Recommended action (needs owner sign-off — affects every payslip):**
  1. **Immediate (low-risk):** revert/disable the PR #43 health-insurance line back to the honest seam to stop the over-withholding, OR
  2. **Correct fix (TDD):** model the table above — stamp duty flat 1,000 (2026), health insurance effective 300/3,300/10,800 by band, 0 below 200,001 until 2027 — after confirming the social-package edge + exact stamp value against ՀՕ-459-Ն with an accountant.

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

### [RESOLVED→CRITICAL] payroll: health-insurance band thresholds
- Merged into the CRITICAL finding above: research confirmed the real structure is a **three-band effective cost (300 / 3,300 / 10,800** at 200,001 / 500,000 / 1,000,000), not the code's two-band 4,800/10,800. The exact `HEALTH_INSURANCE_*` constants are wrong; see the corrected table above.

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
- **payroll:** income tax flat 20%; pension tiers + cap + boundaries (continuous at 500,000 and 1,125,000); all withholdings off gross. _(Health insurance AND the 2026 stamp-duty value are CONFIRMED WRONG in PR #43 — see the CRITICAL finding above.)_
- **Double-entry:** every ledger posting helper is balanced per leg; `trialBalance` asserts debits == credits.
