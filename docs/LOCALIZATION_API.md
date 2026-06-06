# A1 — RA Localization & Finance API

The Armenian fiscal-localization moat, exposed over HTTP. These routes are mounted by
`registerLocalizationRoutes(app)` in `buildApp` (see `server/localizationRoutes.js`) and
back the pure engines in `server/`. **All routes require an authenticated session**
(`app.auth`) — send the session cookie. All amounts are whole **dram (AMD)**.

This doc is the contract for building the UI (chart browser, VAT/payroll calculators,
e-invoice button, inline ՀՎՀՀ/phone validators) against these routes.

## Reference / lookups (GET)

| Route | Query | Returns |
|---|---|---|
| `GET /api/localization/chart-of-accounts` | — | `{ classes: [{digit,hy,en,type,normalBalance}] (×9), accounts: [{code,hy,en,class,type}] (×623) }` |
| `GET /api/localization/chart-of-accounts` | `?code=251` | `{ code, hy, en, class, type, normalBalance }` or `{ error }` |
| `GET /api/localization/hvhh` | `?value=00123456` | `{ ok, normalized, error }` |
| `GET /api/localization/regions` | — | `{ regions: [{code,hy,en,center,cities}] (×11, ISO 3166-2:AM) }` |
| `GET /api/localization/phone` | `?value=091234567` | `{ valid, e164, formatted }` |

## Compute (POST, JSON body)

### `POST /api/finance/vat-return/compute`
```jsonc
// body
{ "sales":     [{ "netAmount": 1000000, "vatRate": 20, "category": "exempt"? }],
  "purchases": [{ "netAmount": 400000, "vatRate": 20, "source": "import"|"domestic", "recoverable": true }] }
// →
{ "summary": { "outputVat", "inputVat", "taxableSales", "taxablePurchases", "net", "payable", "creditCarried" },
  "form": {            // official SRC form line values (decree N 298-Ն), { base, vat }
    "7": {…},  "9": {…},  "12": {base},  "13": {base},  "16": {…total credit},
    "17": {…imports}, "18": {…domestic}, "21": {vat: total debit},
    "23": { "payable", "recoverable" } },
  "formSource": {
    "titleHy": "Ավելացված արժեքի հարկի և ակցիզային հարկի միասնական հաշվարկ",
    "orderNumber": "N 298-Ն",
    "sourceUrl": "https://www.arlis.am/hy/acts/136996",
    "effectiveDate": "2018-01-01" },
  "formLineDefinitions": {
    "7": { "section": "output", "labelHy": "ԱԱՀ-ի 20% դրույքաչափով հարկվող գործարքներ", "fields": ["base", "vat"] },
    "23": { "section": "period-net", "labelHy": "Հաշվետու ժամանակաշրջանի համար հաշվարկված ԱԱՀ", "fields": ["payable", "recoverable"] } } }
```

### `POST /api/finance/payroll/compute`
```jsonc
{ "gross": 800000 }
// → { "gross", "incomeTax", "pension", "stampDuty", "healthInsurance", "totalWithholdings", "net" }
// income tax 20% · pension tiered (5%/10%−25k/87,500 cap) · stamp duty 1,000/15,000.
// health insurance: 0 below 200,001 AMD; 4,800 AMD through 500,000; 10,800 AMD from 500,001.
```

### `POST /api/finance/einvoice/build` → e-invoice XML (`application/xml`)
The response body is XML text, not JSON. SPA callers should read it with a text-response helper.

```jsonc
{ "number", "issueDate", "creationDate"?, "transactionType",  // Գործարքի տեսակ (mandatory 2025-03)
  "supplier": { "name", "hvhh", "vatId"?, "address"? },
  "buyer":    { "name", "hvhh"|"passport", "address"? },
  "lines": [{ "description", "quantity", "unitPrice"?, "netAmount", "vatRate",
              "exciseAmount"?, "envFee"? }] }
```

## Offline CLI (no server)
```
node scripts/ra-localization.js hvhh 00123456
node scripts/ra-localization.js account 226
node scripts/ra-localization.js payroll 800000
node scripts/ra-localization.js vat-return period.json   # { sales:[…], purchases:[…] }
node scripts/ra-localization.js einvoice invoice.json
```

## Engines — canonical source: `a1-localization-am`

The engines now live in the standalone repo **[a1-localization-am](https://github.com/SamStep74/A1-Localization-AM)** —
the single source of truth, shared with HayHashvapah and future A1 products
(sibling to `a1-ai`). Suite **vendors** a verbatim copy under
`server/vendor/a1-localization-am/` (pinned commit in its `VENDOR.md`); the
`server/<engine>.js` files are thin re-export shims, so existing
`require("./localization")` etc. keep working unchanged:

| `server/<engine>.js` shim | package namespace |
|---|---|
| `localization.js` (ՀՎՀՀ + AMD money) | `.localization` |
| `armeniaRegions.js` | `.regions` |
| `armeniaPhone.js` | `.phone` |
| `armeniaChartOfAccounts.js` (623-account official chart) | `.chartOfAccounts` |
| `vatReturn.js` | `.vatReturn` |
| `einvoice.js` | `.einvoice` |
| `armeniaPayroll.js` | `.payroll` |

Each engine is pure, offline, and unit-tested **in the package**. The chart's
`armeniaChartOfAccounts.data.js` is now an internal detail of the package's chart
engine (no longer a standalone `server/` file).

> ⚠️ Fixes go **upstream first** (in `a1-localization-am`), then re-vendor into Suite.
> Do not edit `server/vendor/**` or hand-patch the shims. See
> `server/vendor/a1-localization-am/VENDOR.md` for the re-vendor procedure.

## Sources
> Canonical, maintained citation list: **[a1-localization-am README → Official sources](https://github.com/SamStep74/A1-Localization-AM#official-sources)**. Reproduced here for convenience:

Chart of accounts: RA MoF order [arlis.am/acts/75961](https://www.arlis.am/hy/acts/75961) + accountant.am PDF.
VAT form: SRC decree N 298-Ն [arlis.am/acts/136996](https://www.arlis.am/hy/acts/136996).
E-invoice fields: [SRC e-Invoicing User Guide](https://e-invoice.taxservice.am/help/eInvoicingUserGuide.pdf).
Payroll: RA universal health-insurance law ՀՕ-459-Ն [arlis.am/acts/218650](https://www.arlis.am/hy/acts/218650) and military stamp-duty law as amended by ՀՕ-477-Ն [arlis.am/acts/218669](https://www.arlis.am/hy/acts/218669/print/act), cross-checked against SRC public guidance.
