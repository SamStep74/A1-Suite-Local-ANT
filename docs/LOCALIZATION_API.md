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
  "form": {            // official SRC form lines (decree N 298-Ն), { base, vat }
    "7": {…},  "9": {…},  "12": {base},  "13": {base},  "16": {…total credit},
    "17": {…imports}, "18": {…domestic}, "21": {vat: total debit},
    "23": { "payable", "recoverable" } } }
```

### `POST /api/finance/payroll/compute`
```jsonc
{ "gross": 800000 }
// → { "gross", "incomeTax", "pension", "stampDuty", "totalWithholdings", "net" }
// income tax 20% · pension tiered (5%/10%−25k/87,500 cap) · stamp duty 1,000/15,000.
// Health insurance (Dec-2025) intentionally omitted — offset unconfirmed.
```

### `POST /api/finance/einvoice/build` → e-invoice XML (`application/xml`)
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

## Engines (`server/`)
`localization.js` (ՀՎՀՀ + AMD money), `armeniaRegions.js`, `armeniaPhone.js`,
`armeniaChartOfAccounts.js` (+ `.data.js`, the 623-account official chart),
`vatReturn.js`, `einvoice.js`, `armeniaPayroll.js`. Each is pure, offline, unit-tested.

## Sources
Chart of accounts: RA MoF order [arlis.am/acts/75961](https://www.arlis.am/hy/acts/75961) + accountant.am PDF.
VAT form: SRC decree N 298-Ն [arlis.am/acts/136996](https://www.arlis.am/hy/acts/136996).
E-invoice fields: [SRC e-Invoicing User Guide](https://e-invoice.taxservice.am/help/eInvoicingUserGuide.pdf).
Payroll: PwC Armenia + b24.am. (Full notes in the team memory `ra_official_data_sources`.)
