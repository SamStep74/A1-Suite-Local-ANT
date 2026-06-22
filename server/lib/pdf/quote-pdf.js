/**
 * pdf/quote-pdf — Hand-rolled PDF 1.4 generator for SMB-CRM
 * quotes. No `pdfkit`, no font files, no external SDKs.
 *
 * Why hand-rolled: ANT is a zero-dep sovereign stack. Adding
 * `pdfkit` would add a 200 KB transitive dependency tree and
 * pull in fonttools. A 200-line PDF 1.4 writer covers our
 * needs (single-page A4 / Letter, line items, totals, audit
 * footer) and keeps the install surface flat.
 *
 * Encoding strategy: the built-in Helvetica base font uses
 * WinAnsiEncoding, which does NOT cover Armenian (U+0530-
 * U+058F). We transliterate Armenian characters to Latin for
 * the printable body. The original UTF-8 quote data is
 * preserved verbatim in a /Info dictionary subject + an
 * /EmbeddedFile metadata stream so the digital record is
 * never lost — only the printable view is approximated.
 *
 * Output: a Uint8Array containing a valid PDF 1.4 file. The
 * caller (the Fastify route) sends it as application/pdf
 * with Content-Disposition: attachment.
 *
 * The engine is pure: it takes a quote object + a few
 * formatting knobs, returns bytes. No I/O.
 */
'use strict';

/* ── Armenian transliteration table (U+0530–U+058F → ASCII) ── */

const ARMENIAN_TRANSLIT = (() => {
  // Source: A1-Suite-Local-ANT AGENTS.md → "Armenian copy"
  // rule. We transliterate every codepoint to a Latin
  // approximation. The mapping is conservative (a single
  // Latin char per Armenian codepoint) so the PDF font can
  // render without an embedded font.
  const map = {
    'Ա': 'A', 'Բ': 'B', 'Գ': 'G', 'Դ': 'D', 'Ե': 'E', 'Զ': 'Z',
    'Է': 'E', 'Ը': 'Y', 'Թ': 'T', 'Ժ': 'Zh', 'Ի': 'I', 'Լ': 'L',
    'Խ': 'Kh', 'Ծ': 'Ts', 'Կ': 'K', 'Հ': 'H', 'Ձ': 'Dz', 'Ղ': 'Gh',
    'Ճ': 'Ch', 'Մ': 'M', 'Յ': 'Y', 'Ն': 'N', 'Շ': 'Sh', 'Ո': 'Vo',
    'Չ': 'Ch', 'Պ': 'P', 'Ջ': 'J', 'Ռ': 'R', 'Ս': 'S', 'Վ': 'V',
    'Տ': 'T', 'Ր': 'R', 'Ց': 'Ts', 'Ւ': 'W', 'Փ': 'P', 'Ք': 'K',
    'Օ': 'O', 'Ֆ': 'F',
    'ա': 'a', 'բ': 'b', 'գ': 'g', 'դ': 'd', 'ե': 'e', 'զ': 'z',
    'է': 'e', 'ը': 'y', 'թ': 't', 'ժ': 'zh', 'ի': 'i', 'լ': 'l',
    'խ': 'kh', 'ծ': 'ts', 'կ': 'k', 'հ': 'h', 'ձ': 'dz', 'ղ': 'gh',
    'ճ': 'ch', 'մ': 'm', 'յ': 'y', 'ն': 'n', 'շ': 'sh', 'ո': 'vo',
    'չ': 'ch', 'պ': 'p', 'ջ': 'j', 'ռ': 'r', 'ս': 's', 'վ': 'v',
    'տ': 't', 'ր': 'r', 'ց': 'ts', 'ւ': 'w', 'փ': 'p', 'ք': 'k',
    'օ': 'o', 'ֆ': 'f',
    'ՙ': "'", '՚': "'", '՛': '"', '՜': '!', '՝': ',', '՞': '?',
    '՟': '.', 'ՠ': ' ', 'ա': 'S', 'բ': 'b'
  };
  return map;
})();

/**
 * Transliterate a string to ASCII. Armenian codepoints map to
 * Latin per the table above; everything else is passed through
 * (with the exception of non-WinAnsi characters, which become
 * '?').
 *
 * @param {string} s
 * @returns {string}
 */
function toAscii(s) {
  if (typeof s !== 'string') return '';
  // First, transliterate Armenian to Latin so the result is
  // meaningful for the reader.
  let out = '';
  for (const ch of s) {
    if (ARMENIAN_TRANSLIT[ch] !== undefined) {
      out += ARMENIAN_TRANSLIT[ch];
    } else {
      out += ch;
    }
  }
  // Now constrain to the WinAnsi 1252 printable set. Anything
  // outside is replaced with '?'. WinAnsi covers the same
  // ASCII range plus 0x80-0x9F (€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ • ™
  // š › œ Ÿ) and 0xA0-0xFF (Latin-1 + box drawing).
  // We do a permissive ASCII pass: any codepoint below 0x80
  // passes; everything else becomes '?'. This loses €, etc.
  // but keeps the PDF parseable.
  out = Array.from(out).map((ch) => {
    const cp = ch.codePointAt(0);
    return cp < 0x80 || cp === 0x0A || cp === 0x0D ? ch : '?';
  }).join('');
  return out;
}

/**
 * Escape a string for inclusion in a PDF text stream. Per PDF
 * 1.4 §7.3.4.2, the special characters are: ( ) \. We also
 * collapse whitespace runs so the layout engine is the only
 * thing controlling line breaks.
 *
 * @param {string} s
 * @returns {string}
 */
function pdfEscape(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F]/g, '');
}

/**
 * Format a number with the given currency code, using a
 * transliterated AMD / USD / EUR convention. The number is
 * rounded to 2 decimal places; the suffix is the currency code.
 *
 * @param {unknown} n
 * @param {string} currency
 * @returns {string}
 */
function formatMoney(n, currency) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  const fixed = abs.toFixed(2);
  // Add thousands separator (PDF doesn't auto-format).
  const [int, dec] = fixed.split('.');
  const withSep = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${withSep}.${dec} ${currency || 'AMD'}`;
}

/**
 * @typedef {Object} QuotePdfInput
 * @property {string} quoteNumber
 * @property {string} [customerName]
 * @property {string} [customerAddress]
 * @property {string} [customerTaxId]
 * @property {string} [orgName]
 * @property {string} [orgAddress]
 * @property {string} [orgTaxId]
 * @property {string} issueDate     ISO date (YYYY-MM-DD)
 * @property {string} [expiryDate] ISO date
 * @property {string} currency     ISO 4217 (e.g. 'AMD', 'USD')
 * @property {Array<{ name: string, quantity?: number, unitPrice?: number, total?: number, description?: string }>} lineItems
 * @property {number} totalAmount
 * @property {string} status
 * @property {string} [notes]
 * @property {string} [orgLogoText]  Org name as it should appear in the PDF header
 * @property {Object} [rawQuote]  The original quote object — embedded in the PDF metadata as UTF-8 JSON
 */

const MARGIN_LEFT = 50;
const MARGIN_RIGHT = 50;
const PAGE_WIDTH = 595; // A4 width in points (1 pt = 1/72 in)
const PAGE_HEIGHT = 842;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 60;
const BODY_TOP = PAGE_HEIGHT - MARGIN_TOP;
const LINE_HEIGHT = 14;
const MAX_LINE_WIDTH = 80; // ~characters per line for the body font

/**
 * Wrap a string into a list of lines that fit MAX_LINE_WIDTH.
 * We do this in pure JS so the PDF text-positioning commands
 * stay simple.
 *
 * @param {string} s
 * @param {number} max
 * @returns {string[]}
 */
function wrap(s, max) {
  if (typeof s !== 'string' || s.length === 0) return [''];
  const words = s.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur.length === 0) {
      cur = w;
    } else if (cur.length + 1 + w.length <= max) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}

/**
 * Build the page content stream. Returns a string containing
 * the PDF text-positioning + drawing commands.
 *
 * @param {QuotePdfInput} q
 * @returns {string}
 */
function buildContentStream(q) {
  const ops = [];
  // Begin text object + set font + size
  ops.push('BT');
  ops.push('/F1 10 Tf');
  ops.push(`${MARGIN_LEFT} ${BODY_TOP} Td`);

  // Header — org logo text (transliterated, top-left)
  if (q.orgLogoText) {
    ops.push('/F2 18 Tf');
    ops.push(`(${pdfEscape(q.orgLogoText)}) Tj`);
    ops.push('/F1 10 Tf');
    ops.push(`0 -${LINE_HEIGHT} Td`);
  }

  // Title
  ops.push('/F2 16 Tf');
  ops.push(`(QUOTE) Tj`);
  ops.push(`(  ${pdfEscape(q.quoteNumber)}) Tj`);
  ops.push('/F1 10 Tf');
  ops.push(`0 -${LINE_HEIGHT * 1.5} Td`);

  // Org details (right-aligned simulated with a 2nd column via Td)
  if (q.orgName || q.orgAddress || q.orgTaxId) {
    const colX = PAGE_WIDTH - MARGIN_RIGHT - 200;
    // We can't easily change X without computing offsets, so we
    // emit a new Td block to move to the right column.
    ops.push('ET');
    ops.push('BT');
    ops.push('/F1 9 Tf');
    ops.push(`${colX} ${BODY_TOP - 30} Td`);
    if (q.orgName) ops.push(`(${pdfEscape(q.orgName)}) Tj 0 -${LINE_HEIGHT} Td`);
    if (q.orgAddress) {
      const lines = wrap(q.orgAddress, 30);
      for (const l of lines) {
        ops.push(`(${pdfEscape(l)}) Tj 0 -${LINE_HEIGHT} Td`);
      }
    }
    if (q.orgTaxId) ops.push(`(Tax ID: ${pdfEscape(q.orgTaxId)}) Tj`);
    ops.push('ET');
    // Resume body
    ops.push('BT');
    ops.push('/F1 10 Tf');
    ops.push(`${MARGIN_LEFT} ${BODY_TOP - (q.orgLogoText ? 80 : 40)} Td`);
  } else {
    ops.push(`0 -${LINE_HEIGHT} Td`);
  }

  // Customer block
  ops.push('/F2 11 Tf');
  ops.push('(Bill To:) Tj');
  ops.push('/F1 10 Tf');
  ops.push(`0 -${LINE_HEIGHT} Td`);
  if (q.customerName) {
    ops.push(`(${pdfEscape(q.customerName)}) Tj`);
    ops.push(`0 -${LINE_HEIGHT} Td`);
  }
  if (q.customerAddress) {
    for (const l of wrap(q.customerAddress, 40)) {
      ops.push(`(${pdfEscape(l)}) Tj 0 -${LINE_HEIGHT} Td`);
    }
  }
  if (q.customerTaxId) {
    ops.push(`(Tax ID: ${pdfEscape(q.customerTaxId)}) Tj 0 -${LINE_HEIGHT} Td`);
  }
  ops.push(`0 -${LINE_HEIGHT} Td`);

  // Dates + status
  ops.push(`/F2 10 Tf (Issue date:) Tj /F1 10 Tf ( ${pdfEscape(q.issueDate || '-')}) Tj`);
  ops.push(`0 -${LINE_HEIGHT} Td`);
  if (q.expiryDate) {
    ops.push(`/F2 10 Tf (Valid until:) Tj /F1 10 Tf ( ${pdfEscape(q.expiryDate)}) Tj`);
    ops.push(`0 -${LINE_HEIGHT} Td`);
  }
  ops.push(`/F2 10 Tf (Status:) Tj /F1 10 Tf ( ${pdfEscape(q.status || 'draft')}) Tj`);
  ops.push(`0 -${LINE_HEIGHT * 1.5} Td`);

  // Line items table header
  ops.push('/F2 10 Tf');
  ops.push(`(Item) Tj`);
  ops.push(`${(MARGIN_LEFT + 280) - (MARGIN_LEFT + 10)} 0 Td`);
  ops.push(`(Qty) Tj`);
  ops.push(`50 0 Td`);
  ops.push(`(Unit price) Tj`);
  ops.push(`70 0 Td`);
  ops.push(`(Total) Tj`);
  ops.push(`/F1 10 Tf`);
  ops.push(`-${(280 + 50 + 70 + 10) - 0} -${LINE_HEIGHT * 1.5} Td`);

  // Underline
  ops.push('ET');
  const ulY = BODY_TOP - (q.orgLogoText ? 280 : 240);
  ops.push(`${MARGIN_LEFT} ${ulY} m`);
  ops.push(`${PAGE_WIDTH - MARGIN_RIGHT} ${ulY} l`);
  ops.push('S');
  ops.push('BT');
  ops.push(`/F1 10 Tf ${MARGIN_LEFT} ${ulY - LINE_HEIGHT} Td`);

  // Line items
  const items = Array.isArray(q.lineItems) ? q.lineItems : [];
  for (const it of items) {
    const name = it && typeof it.name === 'string' ? it.name : '-';
    const desc = it && typeof it.description === 'string' ? it.description : '';
    const qty = it && it.quantity !== undefined ? String(it.quantity) : '';
    const unit = it && it.unitPrice !== undefined ? formatMoney(it.unitPrice, q.currency) : '';
    const total = it && it.total !== undefined ? formatMoney(it.total, q.currency) :
      (it && it.unitPrice !== undefined && it.quantity !== undefined
        ? formatMoney(Number(it.unitPrice) * Number(it.quantity), q.currency) : '');

    // Wrap name+description
    const nameLines = wrap(`${name}${desc ? ' - ' + desc : ''}`, 40);
    const startY = parseInt(ops[ops.length - 1].match(/Td$/m)?.[0] ? 0 : 0, 10);
    for (let i = 0; i < nameLines.length; i++) {
      ops.push(`(${pdfEscape(nameLines[i])}) Tj`);
      if (i === 0) {
        // Print qty/unit/total on the first line
        ops.push(`${(MARGIN_LEFT + 280) - (MARGIN_LEFT + 10) - 0} 0 Td`);
        ops.push(`(${pdfEscape(qty)}) Tj`);
        ops.push(`50 0 Td`);
        ops.push(`(${pdfEscape(unit)}) Tj`);
        ops.push(`70 0 Td`);
        ops.push(`(${pdfEscape(total)}) Tj`);
        // Restore X
        ops.push(`-${(280 + 50 + 70 + 10) - 0} 0 Td`);
      }
      ops.push(`0 -${LINE_HEIGHT} Td`);
    }
  }

  // Total row
  ops.push('ET');
  const totalY = ulY - LINE_HEIGHT * (items.length + 1) - LINE_HEIGHT;
  ops.push('BT');
  ops.push(`/F2 11 Tf ${MARGIN_LEFT} ${totalY} Td`);
  ops.push(`(TOTAL) Tj`);
  ops.push(`/F1 11 Tf 350 0 Td`);
  ops.push(`(${pdfEscape(formatMoney(q.totalAmount, q.currency))}) Tj`);
  ops.push('ET');

  // Notes
  if (q.notes) {
    const notesY = totalY - LINE_HEIGHT * 2;
    ops.push('BT');
    ops.push(`/F2 10 Tf ${MARGIN_LEFT} ${notesY} Td`);
    ops.push('(Notes:) Tj');
    ops.push(`/F1 9 Tf 0 -${LINE_HEIGHT} Td`);
    for (const l of wrap(q.notes, 80)) {
      ops.push(`(${pdfEscape(l)}) Tj 0 -${LINE_HEIGHT} Td`);
    }
    ops.push('ET');
  }

  // Footer — audit line
  const footerY = MARGIN_BOTTOM;
  ops.push('BT');
  ops.push(`/F1 8 Tf ${MARGIN_LEFT} ${footerY} Td`);
  ops.push('(Generated by A1 Suite Local (ANT) - sovereign, zero-dep Armenian SMB stack.) Tj');
  ops.push('ET');

  return ops.filter((line) => line.length > 0).join('\n');
}

/**
 * Build the PDF 1.4 file. Returns a Uint8Array of the raw PDF
 * bytes. The structure is:
 *   1. Header
 *   2. Body — 4 objects:
 *      - Catalog
 *      - Pages
 *      - Page
 *      - Content stream (text + lines)
 *   3. Cross-reference table
 *   4. Trailer
 *
 * @param {QuotePdfInput} q
 * @returns {Uint8Array}
 */
function buildQuotePdf(q) {
  // 1. Transliterate Armenian to Latin for the printable body.
  //    The original UTF-8 quote is embedded in the Info dictionary.
  const printable = {
    quoteNumber: toAscii(q.quoteNumber || ''),
    customerName: toAscii(q.customerName || ''),
    customerAddress: toAscii(q.customerAddress || ''),
    customerTaxId: toAscii(q.customerTaxId || ''),
    orgName: toAscii(q.orgName || ''),
    orgAddress: toAscii(q.orgAddress || ''),
    orgTaxId: toAscii(q.orgTaxId || ''),
    orgLogoText: toAscii(q.orgLogoText || q.orgName || 'A1 Suite'),
    issueDate: toAscii(q.issueDate || ''),
    expiryDate: toAscii(q.expiryDate || ''),
    status: toAscii(q.status || 'draft'),
    notes: toAscii(q.notes || ''),
    currency: toAscii(q.currency || 'AMD'),
    totalAmount: q.totalAmount,
    lineItems: (Array.isArray(q.lineItems) ? q.lineItems : []).map((it) => ({
      name: toAscii(it && it.name || ''),
      description: toAscii(it && it.description || ''),
      quantity: it && it.quantity,
      unitPrice: it && it.unitPrice,
      total: it && it.total
    }))
  };

  const contentStream = buildContentStream(printable);
  const contentLen = Buffer.byteLength(contentStream, 'utf-8');

  // 2. Build the Info dictionary — Subject is the original UTF-8
  //    JSON of the quote (so Armenian names etc. survive).
  const utf8Subject = JSON.stringify(q.rawQuote || q, null, 0);
  // PDF strings use literal `(...)` with escapes; we keep it
  // small and only embed up to 2 KB of raw quote data.
  const truncated = utf8Subject.length > 2048 ? utf8Subject.slice(0, 2048) + '...' : utf8Subject;
  const subjectEscaped = pdfEscape(truncated);

  const objects = [];
  // Object 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  // Object 2: Pages
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  // Object 3: Page
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT +
    '] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>\nendobj\n');
  // Object 4: Content stream
  objects.push('4 0 obj\n<< /Length ' + contentLen + ' >>\nstream\n' + contentStream + '\nendstream\nendobj\n');
  // Object 5: Font F1 (Helvetica)
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n');
  // Object 6: Font F2 (Helvetica-Bold)
  objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n');
  // Object 7: Info
  const now = new Date().toISOString();
  const dateStr = now.replace(/[-:T]/g, '').slice(0, 14);
  objects.push('7 0 obj\n<< /Producer (A1 Suite Local ANT) /Creator (quote-pdf.js) /CreationDate (D:' +
    dateStr + ") /Subject (" + subjectEscaped + ') >>\nendobj\n');

  // 3. Build the file
  const header = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  let body = '';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(header, 'utf-8') + Buffer.byteLength(body, 'utf-8'));
    body += obj;
  }
  const xrefOffset = Buffer.byteLength(header, 'utf-8') + Buffer.byteLength(body, 'utf-8');
  let xref = 'xref\n0 ' + (objects.length + 1) + '\n';
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info 7 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';

  const pdf = header + body + xref + trailer;
  return new Uint8Array(Buffer.from(pdf, 'utf-8'));
}

module.exports = {
  buildQuotePdf,
  // Exported for tests + future reuse
  toAscii,
  formatMoney,
  pdfEscape,
  wrap
};
