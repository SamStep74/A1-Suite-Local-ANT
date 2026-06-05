// Republic of Armenia chart of accounts — RA localization kernel.
//
// The RA standard chart numbers accounts so the LEADING DIGIT encodes the account
// class, which in turn implies its accounting type and normal balance:
//   1 non-current assets · 2 current assets · 3 equity · 4 non-current liabilities
//   5 current liabilities · 6 income · 7 expenses
//
// STANDARD_ACCOUNTS is the canonical working chart used by A1/HayHashvapah, sourced
// from the HayHashvapah production backend (the authoritative accounting product).
// It is the core set, extensible toward the full RA standard chart. Pure data + lookups.
//
// NOTE (data-consistency follow-up): A1-Suite-Local's server/ledger.js currently seeds
// input VAT as 526 and opening-balance capital as 331; the RA-standard codes used here
// are 226 (recoverable VAT, a 2xx asset) and 311 (equity). Reconciling ledger.js to
// these standard codes is a separate finance task, not done here.

const ACCOUNT_CLASSES = Object.freeze([
  { digit: 1, hy: "Ոչ ընթացիկ ակտիվներ", en: "Non-current assets", type: "asset", normalBalance: "debit" },
  { digit: 2, hy: "Ընթացիկ ակտիվներ", en: "Current assets", type: "asset", normalBalance: "debit" },
  { digit: 3, hy: "Սեփական կապիտալ", en: "Equity", type: "equity", normalBalance: "credit" },
  { digit: 4, hy: "Երկարաժամկետ պարտավորություններ", en: "Non-current liabilities", type: "liability", normalBalance: "credit" },
  { digit: 5, hy: "Ընթացիկ պարտավորություններ", en: "Current liabilities", type: "liability", normalBalance: "credit" },
  { digit: 6, hy: "Եկամուտներ", en: "Income", type: "income", normalBalance: "credit" },
  { digit: 7, hy: "Ծախսեր", en: "Expenses", type: "expense", normalBalance: "debit" },
]);

const STANDARD_ACCOUNTS = Object.freeze([
  { code: "251", hy: "Դրամարկղ", en: "Cash on hand", type: "asset" },
  { code: "252", hy: "Բանկային հաշիվ", en: "Bank account", type: "asset" },
  { code: "221", hy: "Դեբիտորական պարտքեր", en: "Accounts receivable", type: "asset" },
  { code: "226", hy: "Վերականգնվող ԱԱՀ", en: "Recoverable VAT (input)", type: "asset" },
  { code: "311", hy: "Սեփական կապիտալ", en: "Equity capital", type: "equity" },
  { code: "521", hy: "Կրեդիտորական պարտքեր", en: "Accounts payable", type: "liability" },
  { code: "524", hy: "Վճարվելիք ԱԱՀ", en: "VAT payable", type: "liability" },
  { code: "611", hy: "Վաճառքից հասույթ", en: "Sales revenue", type: "income" },
  { code: "612", hy: "Ծառայությունների հասույթ", en: "Service revenue", type: "income" },
  { code: "713", hy: "Նյութեր և ապրանքներ", en: "Materials and goods", type: "expense" },
  { code: "714", hy: "Աշխատավարձի ծախս", en: "Salary expense", type: "expense" },
  { code: "715", hy: "Վարձակալության ծախս", en: "Rent expense", type: "expense" },
  { code: "716", hy: "Վարչական ծախսեր", en: "Administrative expenses", type: "expense" },
]);

const _classByDigit = new Map(ACCOUNT_CLASSES.map((c) => [c.digit, c]));
const _byCode = new Map(STANDARD_ACCOUNTS.map((a) => [a.code, a]));

function accountClass(code) {
  const s = String(code == null ? "" : code).trim();
  if (!/^[0-9]/.test(s)) return null;
  return _classByDigit.get(Number(s[0])) || null;
}

function accountByCode(code) {
  return _byCode.get(String(code == null ? "" : code).trim()) || null;
}

function accountsByType(type) {
  return STANDARD_ACCOUNTS.filter((a) => a.type === type);
}

function accountsByClass(digit) {
  const d = Number(digit);
  return STANDARD_ACCOUNTS.filter((a) => Number(a.code[0]) === d);
}

function normalBalance(code) {
  const cls = accountClass(code);
  return cls ? cls.normalBalance : null;
}

module.exports = {
  ACCOUNT_CLASSES,
  STANDARD_ACCOUNTS,
  accountClass,
  accountByCode,
  accountsByType,
  accountsByClass,
  normalBalance,
};
