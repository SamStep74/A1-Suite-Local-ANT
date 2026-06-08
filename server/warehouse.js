"use strict";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const LOT_CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const SERIAL_CODE = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

function throw400(message) {
  const err = new Error(message);
  err.statusCode = 400;
  throw err;
}

function validateLotCode(value) {
  const text = String(value || "").trim();
  if (!LOT_CODE.test(text)) throw400("lotCode must match /^[A-Z0-9][A-Z0-9_-]{1,31}$/");
  return text;
}

function validateSerial(value) {
  const text = String(value || "").trim();
  if (!SERIAL_CODE.test(text)) throw400("serial must match /^[A-Z0-9][A-Z0-9_-]{1,63}$/");
  return text;
}

function validateProductId(value) {
  const text = String(value || "").trim();
  if (text.length < 3 || text.length > 80) throw400("productId must be 3-80 chars");
  return text;
}

function validateOptionalDate(field, value) {
  if (value === null || value === undefined || value === "") return null;
  if (!ISO_DATE.test(String(value))) throw400(`${field} must be YYYY-MM-DD or null`);
  return String(value);
}

function validateExpiry({ mfgDate, expiryDate }) {
  if (mfgDate && expiryDate && expiryDate < mfgDate) {
    throw400("expiryDate must be on or after mfgDate");
  }
  return { mfgDate: validateOptionalDate("mfgDate", mfgDate), expiryDate: validateOptionalDate("expiryDate", expiryDate) };
}

function fefoOrder(lots) {
  return [...lots]
    .filter(lot => lot && (lot.expiryDate || lot.expiry_date))
    .sort((a, b) => (a.expiryDate || a.expiry_date).localeCompare(b.expiryDate || b.expiry_date));
}

function classifyAbc(rows) {
  const sorted = [...rows]
    .filter(r => Number(r.revenue) > 0)
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));
  const total = sorted.reduce((sum, r) => sum + Number(r.revenue), 0);
  let running = 0;
  return sorted.map(r => {
    const revenue = Number(r.revenue);
    running += revenue;
    const share = total > 0 ? revenue / total : 0;
    const cumulative = total > 0 ? running / total : 0;
    let bucket = "C";
    if (cumulative <= 0.8) bucket = "A";
    else if (cumulative <= 0.95) bucket = "B";
    return { productId: r.productId, revenue, revenueShare: Number(share.toFixed(4)), cumulativeShare: Number(cumulative.toFixed(4)), bucket };
  });
}

function turnoverDays({ averageInventory, cogs, periodDays = 90 }) {
  const avg = Math.max(0, Number(averageInventory) || 0);
  const sold = Math.max(0, Number(cogs) || 0);
  if (sold === 0) return { turnoverDays: avg > 0 ? periodDays : 0, turns: 0 };
  const turns = avg / sold;
  const days = periodDays / turns;
  return { turnoverDays: Math.round(days * 10) / 10, turns: Math.round(turns * 100) / 100 };
}

function traceLot({ lot, lotMoves, stockMoves, vendors, customers }) {
  const upstream = (vendors || [])
    .filter(v => lot.source_vendor_id && v.id === lot.source_vendor_id)
    .map(v => ({ vendorId: v.id, vendorName: v.name, receivedAt: lot.created_at }));
  const moveIds = new Set((lotMoves || []).filter(m => m.lot_id === lot.id).map(m => m.move_id));
  const downstream = (stockMoves || [])
    .filter(m => moveIds.has(m.id))
    .filter(m => m.destination_location_type === "customer")
    .map(m => ({ moveId: m.id, customerLocationId: m.destination_location_id, quantity: m.quantity, movedAt: m.created_at }));
  return { lotId: lot.id, lotCode: lot.lot_code, upstream, downstream };
}

function forecastRestock({ productId, recentIssues, averageDailyDemand, safetyStockDays = 7, horizonDays = 14 }) {
  const product = validateProductId(productId);
  const demand = Math.max(0, Number(averageDailyDemand) || 0);
  const onHand = Math.max(0, Number(recentIssues?.onHand) || 0);
  const inTransit = Math.max(0, Number(recentIssues?.inTransit) || 0);
  const safety = demand * Math.max(0, Number(safetyStockDays) || 0);
  const target = demand * Math.max(1, Number(horizonDays) || 1) + safety;
  const suggested = Math.max(0, Math.ceil(target - onHand - inTransit));
  const reasoning = [];
  if (suggested === 0) reasoning.push("on-hand + in-transit covers horizon + safety stock");
  if (suggested > 0) reasoning.push(`reorder to cover ${horizonDays}d demand + ${safetyStockDays}d safety stock`);
  if (demand === 0) reasoning.push("no recent demand history; baseline reorder of 1 unit suggested for safety");
  return {
    productId: product,
    horizonDays,
    safetyStockDays,
    onHand,
    inTransit,
    averageDailyDemand: demand,
    suggestedQuantity: suggested,
    reasoning,
    source: "local-fallback",
    generatedAt: new Date().toISOString()
  };
}

function recordColdStorageReading({ locationId, recordedAt, tempC, humidity, sensorId }) {
  const loc = String(locationId || "").trim();
  if (loc.length < 3) throw400("locationId must be 3+ chars");
  const at = String(recordedAt || "").trim();
  if (!ISO_DATETIME.test(at)) throw400("recordedAt must be ISO-8601 with milliseconds and Z");
  const temp = Number(tempC);
  if (!Number.isFinite(temp) || temp < -80 || temp > 80) throw400("tempC must be a finite number in [-80, 80]");
  const hum = humidity === null || humidity === undefined ? null : Number(humidity);
  if (hum !== null && (!Number.isFinite(hum) || hum < 0 || hum > 100)) throw400("humidity must be 0-100 or null");
  const sensor = sensorId === null || sensorId === undefined ? null : String(sensorId).trim().slice(0, 80);
  return { locationId: loc, recordedAt: at, tempC: temp, humidity: hum, sensorId: sensor };
}

module.exports = {
  validateLotCode,
  validateSerial,
  validateProductId,
  validateOptionalDate,
  validateExpiry,
  fefoOrder,
  classifyAbc,
  turnoverDays,
  traceLot,
  forecastRestock,
  recordColdStorageReading
};
