"use strict";

/**
 * SMB CRM — Translate engine.
 *
 * Pure functions, no Fastify imports. Dictionary-first translator
 * with an AI fallback. Caches every translation in the
 * `smb_crm_translations` table, keyed by sha256(text + locale).
 *
 * Pattern A: this engine returns data; the route layer owns
 * the HTTP envelope, the audit row, and the idempotency check.
 *
 * Trilingual display order:
 *   - Armenian-locale (hy) callers: hy, en, ru
 *   - Russian-locale (ru) callers: ru, en, hy
 *   - Anything else: en, hy, ru
 *
 * The legacy `lib/translation.js` (375 lines) baked the dictionaries
 * into the source. The rebuild keeps a small seed for offline
 * cold-starts and offline tests; the table is the durable store.
 *
 * "Dictionary" is intentionally tiny — a hand-curated set of common
 * SMB-CRM UI terms. AI is the general case. If `provider` is null
 * and the key isn't in the dictionary, the engine returns the
 * English source (so the UI renders something rather than crashing).
 */

const crypto = require("node:crypto");

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function nowIso() { return new Date().toISOString(); }

/**
 * Display order for trilingual results. The SPA picks the first
 * entry whose locale matches the user's preference. Keys are
 * English (the source of truth).
 */
function displayOrderFor(userLocale) {
  const lc = String(userLocale || "en").toLowerCase();
  if (lc === "hy" || lc.startsWith("hy-")) return ["hy", "en", "ru"];
  if (lc === "ru" || lc.startsWith("ru-")) return ["ru", "en", "hy"];
  return ["en", "hy", "ru"];
}

/**
 * Seed dictionary. Mirrors the legacy `lib/translation.js` first
 * ~100 entries, but compressed. Each key is the English source
 * string; each value is a { hy, ru } map.
 */
const SEED_DICT = Object.freeze({
  // Common CRM UI
  "Customers": { hy: "Հաճախորդներ", ru: "Клиенты" },
  "Customer": { hy: "Հաճախորդ", ru: "Клиент" },
  "Deals": { hy: "Գործարքներ", ru: "Сделки" },
  "Deal": { hy: "Գործարք", ru: "Сделка" },
  "Pipeline": { hy: "Խողովաշար", ru: "Воронка" },
  "Tasks": { hy: "Առաջադրանքներ", ru: "Задачи" },
  "Task": { hy: "Առաջադրանք", ru: "Задача" },
  "New lead": { hy: "Նոր հաճախորդ", ru: "Новый лид" },
  "Lead form": { hy: "Հաճախորդի ձև", ru: "Форма лида" },
  "Appointment": { hy: "Հանդիպում", ru: "Встреча" },
  "Quote": { hy: "Առաջարկ", ru: "Предложение" },
  "Invoice": { hy: "Հաշիվ-ապրանքագիր", ru: "Счёт" },
  "Estimate": { hy: "Գնահատում", ru: "Оценка" },
  // Module names (Phase 10)
  "Loyalty & Repeat Sales": { hy: "Նվիրողականություն և կրկնակի վաճառքներ", ru: "Лояльность и повторные продажи" },
  "Reservations": { hy: "Ամրագրումներ", ru: "Бронирования" },
  "Patient Intake": { hy: "Հիվանդի ընդունում", ru: "Приём пациента" },
  "Vehicle Profiles": { hy: "Տրանսպորտային միջոցների քարտեր", ru: "Карточки автомобилей" },
  "Property Inventory": { hy: "Գույքի գույնտեն", ru: "Каталог объектов" },
  "Service Catalog": { hy: "Ծառայությունների կատալոգ", ru: "Каталог услуг" },
  "Tour Catalog": { hy: "Տուրերի կատալոգ", ru: "Каталог туров" },
  "Shipments": { hy: "Առաքումներ", ru: "Доставки" },
  "Projects": { hy: "Նախագծեր", ru: "Проекты" },
  "Courses": { hy: "Դասընթացներ", ru: "Курсы" },
  // Pipeline stages
  "New inquiry": { hy: "Նոր հարցում", ru: "Новый запрос" },
  "Need confirmed": { hy: "Պահանջը հաստատվել է", ru: "Потребность подтверждена" },
  "Visit scheduled": { hy: "Այցը նշանակված է", ru: "Визит назначен" },
  "Quote sent": { hy: "Առաջարկն ուղարկվել է", ru: "Предложение отправлено" },
  "Closed": { hy: "Փակված է", ru: "Закрыто" },
  // Status / actions
  "Save": { hy: "Պահպանել", ru: "Сохранить" },
  "Cancel": { hy: "Չեղարկել", ru: "Отмена" },
  "Create": { hy: "Ստեղծել", ru: "Создать" },
  "Delete": { hy: "Ջնջել", ru: "Удалить" },
  "Edit": { hy: "Խմբագրել", ru: "Редактировать" },
  "Apply": { hy: "Կիրառել", ru: "Применить" },
  "Settings": { hy: "Կարգավորումներ", ru: "Настройки" },
  "Translate": { hy: "Թարգմանել", ru: "Перевести" },
  "Generate blueprint": { hy: "Ստեղծել կառուցվածքը", ru: "Создать шаблон" },
  "Blueprint": { hy: "Կառուցվածք", ru: "Шаблон" }
});

/**
 * Normalize an array of text inputs to a deduplicated list of
 * non-empty strings. Used by both the dictionary lookup and the
 * AI fallback (one AI call handles a batch).
 */
function uniqueNormalizedTexts(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const s = String(raw == null ? "" : raw).trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function localeOf(value) {
  const lc = String(value || "en").trim().toLowerCase();
  return ["hy", "en", "ru"].includes(lc) ? lc : "en";
}

function cacheKey(text, locale) {
  return sha256Hex(`${locale}::${text}`);
}

/**
 * Look up dictionary translations. Returns a map of
 *   text → { hy?, en?, ru?, source: "dict"|"ai"|"passthru" }
 * The "en" entry is the source text; "hy" and "ru" are filled
 * from the dictionary, the AI fallback, or left undefined.
 *
 * Missing keys go into `missing` so the route can audit "5
 * strings needed the AI fallback this call".
 */
function lookupDictionary(texts) {
  const result = {};
  const missing = [];
  for (const text of texts) {
    const dict = SEED_DICT[text];
    const entry = { en: text };
    if (dict && dict.hy) entry.hy = dict.hy;
    if (dict && dict.ru) entry.ru = dict.ru;
    if (!dict) {
      // No dictionary match: leave hy/ru undefined, mark as missing
      // for the AI fallback path. Do NOT mark English as missing —
      // it's the source.
      entry.source = "passthru";
      missing.push(text);
    } else {
      entry.source = "dict";
    }
    result[text] = entry;
  }
  return { result, missing };
}

/**
 * Look up translations in the smb_crm_translations table. Returns
 * the same map shape as lookupDictionary. Used to prime the
 * in-memory map before deciding which strings need an AI call.
 *
 * The table is keyed by sha256(locale::text). Locale "en" is
 * special — it just stores the source text, so a row exists for
 * every text the system has ever translated.
 */
function lookupCached(db, texts) {
  if (!db || !texts.length) return {};
  const map = {};
  const stmt = db.prepare(`
    SELECT cache_key, locale, text
      FROM smb_crm_translations
     WHERE cache_key IN (${texts.map(_ => "?").join(",")})
  `);
  // Build a text→cacheKey index for lookup
  const textByKey = {};
  const keys = texts.map(t => {
    const k = cacheKey(t, "en");
    textByKey[k] = t;
    return k;
  });
  const rows = stmt.all(...keys);
  for (const r of rows) {
    const text = textByKey[r.cache_key];
    if (!text) continue;
    if (!map[text]) map[text] = { en: text };
    if (r.locale === "hy" || r.locale === "ru" || r.locale === "en") {
      map[text][r.locale] = r.text;
    }
  }
  return map;
}

/**
 * Persist a batch of translation rows. Idempotent via PRIMARY KEY
 * (cache_key, locale). Use INSERT OR REPLACE so retries are safe.
 */
function persistTranslations(db, entries) {
  if (!db || !entries.length) return 0;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO smb_crm_translations (cache_key, locale, text, source, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = nowIso();
  let n = 0;
  db.exec("BEGIN");
  try {
    for (const e of entries) {
      const k = cacheKey(e.text, e.locale);
      stmt.run(k, e.locale, e.translated, e.source || "ai", now);
      n += 1;
      // Always store the "en" row too, so the cache is symmetric.
      if (e.locale !== "en") {
        stmt.run(cacheKey(e.text, "en"), "en", e.text, "source", now);
        n += 1;
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  }
  return n;
}

/**
 * Run a batch of AI translations for the missing texts. The
 * provider's `translate` is called once per text; for a small
 * batch (≤ 8) we could batch in a single prompt, but Phase 10 V1
 * calls once per text for predictable evidence envelopes.
 *
 * Returns the same map shape as lookupDictionary, ready to merge
 * with the dictionary output.
 */
async function aiTranslateBatch(provider, texts, targetLocale) {
  const map = {};
  if (!provider || !texts.length) return map;
  const target = localeOf(targetLocale);
  if (target === "en") {
    // Translating into English is the identity for English sources.
    for (const t of texts) map[t] = { en: t, source: "identity" };
    return map;
  }
  for (const text of texts) {
    const res = await provider.translate({ text, targetLocale: target });
    if (res && res.ok && res.data && res.data.translated) {
      map[text] = {
        en: text,
        [target]: String(res.data.translated),
        source: "ai"
      };
    } else {
      // No AI result: fall back to the source text so the UI renders.
      map[text] = { en: text, source: "passthru" };
    }
  }
  return map;
}

/**
 * Top-level translate. Returns an array (parallel to `texts`)
 * of `TrilingualEntry` objects:
 *
 *   {
 *     text: "<source>",
 *     translations: { en: "<src>", hy?: "<hy>", ru?: "<ru>" },
 *     display: [ "hy" | "en" | "ru", ... ],   // locale order
 *     pick: "<hy|en|ru>",                       // best match
 *     pickValue: "<chosen translation>",
 *     source: "dict" | "ai" | "passthru" | "identity"
 *   }
 *
 * `opts.provider` may be null — in that case the engine returns
 * English-only entries.
 *
 * `opts.userLocale` (default "en") drives the display order +
 * the `pick` field. If a translation is missing in the user's
 * preferred locale, the engine falls back to the next locale in
 * the display order.
 */
async function translateTexts(db, texts, opts) {
  const o = opts || {};
  const clean = uniqueNormalizedTexts(texts);
  if (!clean.length) return [];

  // 1. Dictionary lookup (in-memory, O(1))
  const { result: dictResult, missing: dictMissing } = lookupDictionary(clean);

  // 2. DB cache lookup for the dictionary misses
  const cached = lookupCached(db, dictMissing);

  // 3. Identify which (text, locale) pairs still need an AI call.
  //    A pair is "still missing" if it has no hy/ru value in either
  //    the dictionary OR the cache.
  const aiMissing = [];
  for (const text of dictMissing) {
    const entry = cached[text] || {};
    if (!entry.hy && !entry.ru) {
      aiMissing.push(text);
    } else {
      // Merge cached translations into the result
      if (entry.hy && !dictResult[text].hy) dictResult[text].hy = entry.hy;
      if (entry.ru && !dictResult[text].ru) dictResult[text].ru = entry.ru;
      dictResult[text].source = "cache";
    }
  }

  // 4. AI fallback for the remaining missing strings
  if (o.provider && aiMissing.length) {
    const aiHy = await aiTranslateBatch(o.provider, aiMissing, "hy");
    const aiRu = await aiTranslateBatch(o.provider, aiMissing, "ru");
    const persistable = [];
    for (const text of aiMissing) {
      const h = aiHy[text] || {};
      const r = aiRu[text] || {};
      if (h.hy) {
        dictResult[text].hy = h.hy;
        persistable.push({ text, locale: "hy", translated: h.hy, source: "ai" });
      }
      if (r.ru) {
        dictResult[text].ru = r.ru;
        persistable.push({ text, locale: "ru", translated: r.ru, source: "ai" });
      }
      if (h.hy || r.ru) dictResult[text].source = "ai";
    }
    if (db && persistable.length) {
      try { persistTranslations(db, persistable); } catch (_e) { /* non-fatal */ }
    }
  }

  // 5. Shape the final per-text result with display order + pick.
  const userLocale = localeOf(o.userLocale || "en");
  const display = displayOrderFor(userLocale);
  const out = [];
  for (const text of clean) {
    const entry = dictResult[text] || { en: text, source: "passthru" };
    const translations = {
      en: entry.en,
      hy: entry.hy || null,
      ru: entry.ru || null
    };
    let pick = null;
    let pickValue = null;
    for (const lc of display) {
      if (translations[lc]) { pick = lc; pickValue = translations[lc]; break; }
    }
    if (!pick) { pick = "en"; pickValue = translations.en; }
    out.push({
      text,
      translations,
      display,
      pick,
      pickValue,
      source: entry.source || "passthru"
    });
  }
  return out;
}

/**
 * Single-text convenience wrapper. Returns just the `pickValue`
 * for the given userLocale, or null if the input was empty.
 */
async function translateText(db, text, opts) {
  if (text == null) return null;
  const arr = await translateTexts(db, [String(text)], opts);
  return arr[0] || null;
}

module.exports = {
  displayOrderFor,
  lookupDictionary,
  lookupCached,
  persistTranslations,
  aiTranslateBatch,
  translateTexts,
  translateText,
  uniqueNormalizedTexts,
  cacheKey,
  localeOf,
  SEED_DICT
};
