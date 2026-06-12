"use strict";

/**
 * SMB CRM — Blueprint generator.
 *
 * Pure engine: no OpenAI/AI imports, no env reads, no DB access.
 * Takes an `aiProvider` (the interface from server/smbCrmAiProvider.js)
 * and a `questionnaire` (the multi-step onboarding form); returns
 * a structured `blueprint` object matching the contract §2.5 shape.
 *
 * Mirrors the legacy `lib/crmGenerator.js` in the parts that matter:
 *   - INDUSTRY_TEMPLATES (11 sectors) + a "services" default
 *   - The blueprint JSON shape (modules, pipeline, fields, opportunities,
 *     tasks, kpis, automations, leadFormFields, starterMessages, subdomain)
 *   - Industry alias normalization (retail/shop/store → retail, etc.)
 *
 * The legacy's prompts were crafted for OpenAI's `/v1/responses`
 * endpoint with json_schema. The rebuild uses `response_format: json_object`
 * (OpenRouter's universal equivalent) — the schema is conveyed via the
 * system prompt instead of a json_schema field, since not every
 * OpenRouter model honors json_schema.
 *
 * V1 stores the blueprint in smb_crm_blueprints.doc as JSON.
 * The "apply" materialization (contract test 5) lives in this same
 * module — see `applyBlueprint(db, orgId, blueprint)` below.
 */

const crypto = require("node:crypto");

const SECTOR_KEYS = Object.freeze([
  "retail", "horeca", "clinic", "realEstate", "services",
  "tourism", "logistics", "construction", "education", "auto", "beauty"
]);

const SECTOR_ALIASES = Object.freeze({
  retail: "retail", shop: "retail", store: "retail",
  horeca: "horeca", restaurant: "horeca", cafe: "horeca",
  clinic: "clinic", healthcare: "clinic", medical: "clinic",
  realestate: "realEstate", property: "realEstate", realestateam: "realEstate",
  services: "services", service: "services",
  tourism: "tourism", travel: "tourism",
  logistics: "logistics", delivery: "logistics",
  construction: "construction",
  education: "education", school: "education",
  auto: "auto", autoservice: "auto", carservice: "auto",
  beauty: "beauty", salon: "beauty"
});

const SECTOR_LABELS = Object.freeze({
  retail: "Retail CRM",
  horeca: "HoReCa CRM",
  clinic: "Clinic CRM",
  realEstate: "Real Estate CRM",
  services: "Service CRM",
  tourism: "Tourism CRM",
  logistics: "Logistics CRM",
  construction: "Construction CRM",
  education: "Education CRM",
  auto: "Auto Service CRM",
  beauty: "Beauty Salon CRM"
});

// Industry template seeds — 11 sectors. Mirrors the legacy
// `INDUSTRY_TEMPLATES` shape; the AI prompt injects the matching
// template so it doesn't have to invent one from scratch.
const INDUSTRY_TEMPLATES = Object.freeze({
  retail: {
    modules: [
      { id: "loyalty", name: "Loyalty & Repeat Sales", description: "Customer tiers, repeat purchase windows, and WhatsApp reactivation lists.", priority: "high" },
      { id: "inventory-lite", name: "Retail Stock Signals", description: "Fast SKU, stock risk, and reorder reminders connected to sales activity.", priority: "high" },
      { id: "returns", name: "Returns & Exchanges", description: "Track return reasons, exchange status, and owner follow-up tasks.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New retail inquiry", probability: 10, color: "#2d6cdf" },
      { id: "need", name: "Need confirmed", probability: 30, color: "#00897b" },
      { id: "cart", name: "Cart or quote prepared", probability: 55, color: "#c06c2b" },
      { id: "payment", name: "Payment pending", probability: 80, color: "#8e3d6b" },
      { id: "won", name: "Purchase completed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Loyalty tier", type: "select", required: false },
      { entity: "customer", name: "Preferred store or pickup point", type: "text", required: false },
      { entity: "deal", name: "Product category", type: "select", required: true },
      { entity: "deal", name: "Delivery or pickup preference", type: "select", required: false },
      { entity: "task", name: "Reorder follow-up date", type: "date", required: false }
    ],
    kpis: [
      { name: "Repeat purchase rate", target: "32", frequency: "monthly" },
      { name: "Average basket", target: "Use average deal", frequency: "monthly" },
      { name: "Low-stock items", target: "4", frequency: "weekly" }
    ]
  },
  horeca: {
    modules: [
      { id: "reservations", name: "Reservations", description: "Table, event, and booking requests with confirmation status.", priority: "high" },
      { id: "events-catering", name: "Events & Catering", description: "Group orders, deposits, menus, and delivery or venue details.", priority: "high" },
      { id: "guest-feedback", name: "Guest Feedback", description: "Post-visit ratings, complaint follow-up, and repeat visit campaigns.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New booking inquiry", probability: 10, color: "#2d6cdf" },
      { id: "menu", name: "Menu or table confirmed", probability: 35, color: "#00897b" },
      { id: "deposit", name: "Deposit requested", probability: 60, color: "#c06c2b" },
      { id: "scheduled", name: "Event scheduled", probability: 85, color: "#8e3d6b" },
      { id: "won", name: "Visit completed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "deal", name: "Guest count", type: "number", required: true },
      { entity: "deal", name: "Reservation date", type: "date", required: true },
      { entity: "deal", name: "Menu package", type: "select", required: false },
      { entity: "deal", name: "Deposit status", type: "select", required: false },
      { entity: "customer", name: "Dietary notes", type: "textarea", required: false }
    ],
    kpis: [
      { name: "Booking conversion", target: "38", frequency: "monthly" },
      { name: "Upcoming reservations", target: "18", frequency: "weekly" },
      { name: "Average group size", target: "6", frequency: "monthly" }
    ]
  },
  clinic: {
    modules: [
      { id: "patient-intake", name: "Patient Intake", description: "Patient profile, visit reason, consent, and first-response task flow.", priority: "high" },
      { id: "appointments-care", name: "Appointments & Care Plans", description: "Appointment booking, treatment plans, doctor ownership, and visit follow-up.", priority: "high" },
      { id: "clinic-reminders", name: "Clinic Reminders", description: "No-show prevention, post-visit checks, and recurring care reminders.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New patient inquiry", probability: 10, color: "#2d6cdf" },
      { id: "triage", name: "Triage completed", probability: 30, color: "#00897b" },
      { id: "booked", name: "Appointment booked", probability: 55, color: "#c06c2b" },
      { id: "plan", name: "Treatment plan offered", probability: 75, color: "#8e3d6b" },
      { id: "won", name: "Visit completed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Patient ID", type: "text", required: false },
      { entity: "customer", name: "Consent status", type: "select", required: true },
      { entity: "deal", name: "Doctor or specialist", type: "user", required: true },
      { entity: "deal", name: "Appointment date", type: "date", required: true },
      { entity: "deal", name: "Treatment category", type: "select", required: true }
    ],
    kpis: [
      { name: "Appointment show rate", target: "86", frequency: "monthly" },
      { name: "Patient follow-up coverage", target: "90", frequency: "monthly" },
      { name: "Treatment plan conversion", target: "42", frequency: "monthly" }
    ]
  },
  beauty: {
    modules: [
      { id: "stylist-schedule", name: "Stylist Schedule", description: "Stylist ownership, visit times, and rebooking reminders.", priority: "high" },
      { id: "beauty-packages", name: "Packages & Memberships", description: "Track package balance, preferred services, and renewal reminders.", priority: "high" },
      { id: "client-preferences", name: "Client Preferences", description: "Color formulas, allergies, preferred stylist, and visit notes.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New beauty request", probability: 10, color: "#2d6cdf" },
      { id: "consultation", name: "Consultation done", probability: 30, color: "#00897b" },
      { id: "booked", name: "Visit booked", probability: 55, color: "#c06c2b" },
      { id: "served", name: "Service completed", probability: 85, color: "#8e3d6b" },
      { id: "won", name: "Rebooked or paid", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Preferred stylist", type: "user", required: false },
      { entity: "customer", name: "Beauty notes", type: "textarea", required: false },
      { entity: "deal", name: "Service package", type: "select", required: true },
      { entity: "deal", name: "Visit date", type: "date", required: true },
      { entity: "deal", name: "Package balance", type: "number", required: false }
    ],
    kpis: [
      { name: "Rebooking rate", target: "48", frequency: "monthly" },
      { name: "Package renewals", target: "12", frequency: "monthly" },
      { name: "Stylist utilization", target: "76", frequency: "monthly" }
    ]
  },
  auto: {
    modules: [
      { id: "vehicles", name: "Vehicle Profiles", description: "Car plate, VIN, mileage, service history, and owner linkage.", priority: "high" },
      { id: "service-jobs", name: "Service Jobs", description: "Diagnosis, repair estimate, job status, parts, and delivery readiness.", priority: "high" },
      { id: "maintenance-reminders", name: "Maintenance Reminders", description: "Oil, tire, inspection, and seasonal service reminders.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "Service request", probability: 10, color: "#2d6cdf" },
      { id: "diagnosis", name: "Diagnosis scheduled", probability: 30, color: "#00897b" },
      { id: "estimate", name: "Estimate sent", probability: 55, color: "#c06c2b" },
      { id: "repair", name: "In service", probability: 80, color: "#8e3d6b" },
      { id: "won", name: "Delivered", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Vehicle plate", type: "text", required: true },
      { entity: "customer", name: "Vehicle model", type: "text", required: false },
      { entity: "deal", name: "Mileage", type: "number", required: false },
      { entity: "deal", name: "Service type", type: "select", required: true },
      { entity: "deal", name: "Parts required", type: "textarea", required: false }
    ],
    kpis: [
      { name: "Estimate approval rate", target: "52", frequency: "monthly" },
      { name: "Average service cycle", target: "2.5", frequency: "monthly" },
      { name: "Repeat service customers", target: "34", frequency: "monthly" }
    ]
  },
  realEstate: {
    modules: [
      { id: "properties", name: "Property Inventory", description: "Listings, regions, price, owner, availability, and media status.", priority: "high" },
      { id: "viewings", name: "Viewings", description: "Buyer/renter requirements, viewing schedule, and follow-up tasks.", priority: "high" },
      { id: "matching", name: "Buyer Matching", description: "Saved requirements and property match lists by budget and location.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New property inquiry", probability: 10, color: "#2d6cdf" },
      { id: "matched", name: "Requirements matched", probability: 30, color: "#00897b" },
      { id: "viewing", name: "Viewing booked", probability: 55, color: "#c06c2b" },
      { id: "offer", name: "Offer or contract", probability: 80, color: "#8e3d6b" },
      { id: "won", name: "Closed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Buyer or renter type", type: "select", required: true },
      { entity: "deal", name: "Property type", type: "select", required: true },
      { entity: "deal", name: "Budget range", type: "money", required: true },
      { entity: "deal", name: "Preferred location", type: "text", required: true },
      { entity: "deal", name: "Viewing date", type: "date", required: false }
    ],
    kpis: [
      { name: "Viewing to offer rate", target: "28", frequency: "monthly" },
      { name: "Active listings", target: "45", frequency: "monthly" },
      { name: "Average days to close", target: "34", frequency: "monthly" }
    ]
  },
  services: {
    modules: [
      { id: "service-catalog", name: "Service Catalog", description: "Frequently sold services, packages, prices, and SLA notes.", priority: "high" },
      { id: "service-tickets", name: "Service Tickets", description: "Service requests, owner assignment, status, and follow-up tasks.", priority: "high" },
      { id: "client-feedback", name: "Client Feedback", description: "Post-service ratings, complaint follow-up, and repeat business campaigns.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New service request", probability: 10, color: "#2d6cdf" },
      { id: "scoped", name: "Scope confirmed", probability: 35, color: "#00897b" },
      { id: "scheduled", name: "Visit scheduled", probability: 60, color: "#c06c2b" },
      { id: "delivered", name: "Service delivered", probability: 85, color: "#8e3d6b" },
      { id: "won", name: "Closed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Service address", type: "text", required: true },
      { entity: "deal", name: "Service type", type: "select", required: true },
      { entity: "deal", name: "Preferred service date", type: "date", required: true },
      { entity: "task", name: "Follow-up date", type: "date", required: false }
    ],
    kpis: [
      { name: "Service conversion", target: "35", frequency: "monthly" },
      { name: "Average response time", target: "4h", frequency: "weekly" },
      { name: "Repeat service customers", target: "30", frequency: "monthly" }
    ]
  },
  tourism: {
    modules: [
      { id: "tour-catalog", name: "Tour Catalog", description: "Tour packages, destinations, dates, prices, and capacity.", priority: "high" },
      { id: "bookings", name: "Bookings", description: "Group bookings, deposits, traveler count, and special requests.", priority: "high" },
      { id: "travel-feedback", name: "Travel Feedback", description: "Post-trip ratings, photo reviews, and referral campaigns.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New inquiry", probability: 10, color: "#2d6cdf" },
      { id: "quoted", name: "Quote sent", probability: 35, color: "#00897b" },
      { id: "deposit", name: "Deposit received", probability: 60, color: "#c06c2b" },
      { id: "confirmed", name: "Trip confirmed", probability: 85, color: "#8e3d6b" },
      { id: "won", name: "Trip completed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Traveler count", type: "number", required: true },
      { entity: "deal", name: "Destination", type: "text", required: true },
      { entity: "deal", name: "Travel date", type: "date", required: true },
      { entity: "deal", name: "Package", type: "select", required: false }
    ],
    kpis: [
      { name: "Inquiry to booking rate", target: "32", frequency: "monthly" },
      { name: "Average package value", target: "Use average deal", frequency: "monthly" },
      { name: "Repeat travelers", target: "20", frequency: "monthly" }
    ]
  },
  logistics: {
    modules: [
      { id: "shipments", name: "Shipments", description: "Origin, destination, pickup date, driver assignment, and delivery status.", priority: "high" },
      { id: "fleet", name: "Fleet", description: "Vehicles, capacity, current location, and maintenance status.", priority: "high" },
      { id: "tracking", name: "Customer Tracking", description: "Status page, ETA notifications, and proof-of-delivery.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New shipment request", probability: 10, color: "#2d6cdf" },
      { id: "scheduled", name: "Pickup scheduled", probability: 35, color: "#00897b" },
      { id: "picked-up", name: "Picked up", probability: 60, color: "#c06c2b" },
      { id: "transit", name: "In transit", probability: 80, color: "#8e3d6b" },
      { id: "won", name: "Delivered", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Origin", type: "text", required: true },
      { entity: "customer", name: "Destination", type: "text", required: true },
      { entity: "deal", name: "Pickup date", type: "date", required: true },
      { entity: "deal", name: "Driver", type: "user", required: false }
    ],
    kpis: [
      { name: "On-time delivery rate", target: "92", frequency: "monthly" },
      { name: "Average transit days", target: "2.1", frequency: "monthly" },
      { name: "Repeat shippers", target: "40", frequency: "monthly" }
    ]
  },
  construction: {
    modules: [
      { id: "projects", name: "Projects", description: "Project type, site address, estimated area, status, and owner.", priority: "high" },
      { id: "estimates", name: "Estimates", description: "Material, labor, and timeline estimates with approval workflow.", priority: "high" },
      { id: "site-visits", name: "Site Visits", description: "Scheduled site visits, photos, and follow-up tasks.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New project inquiry", probability: 10, color: "#2d6cdf" },
      { id: "estimate", name: "Estimate sent", probability: 30, color: "#00897b" },
      { id: "contract", name: "Contract signed", probability: 60, color: "#c06c2b" },
      { id: "active", name: "Active site", probability: 80, color: "#8e3d6b" },
      { id: "won", name: "Completed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Site address", type: "text", required: true },
      { entity: "deal", name: "Project type", type: "select", required: true },
      { entity: "deal", name: "Estimated area", type: "number", required: false },
      { entity: "deal", name: "Start date", type: "date", required: true }
    ],
    kpis: [
      { name: "Estimate to contract rate", target: "40", frequency: "monthly" },
      { name: "Active projects", target: "6", frequency: "monthly" },
      { name: "On-time completion", target: "85", frequency: "monthly" }
    ]
  },
  education: {
    modules: [
      { id: "courses", name: "Courses", description: "Course catalog, schedules, prices, and instructor assignment.", priority: "high" },
      { id: "enrollments", name: "Enrollments", description: "Student registration, attendance tracking, and progress notes.", priority: "high" },
      { id: "parent-comms", name: "Parent Communications", description: "Progress reports, parent meetings, and consent records.", priority: "medium" }
    ],
    pipeline: [
      { id: "new", name: "New inquiry", probability: 10, color: "#2d6cdf" },
      { id: "trial", name: "Trial class", probability: 30, color: "#00897b" },
      { id: "enrolled", name: "Enrolled", probability: 70, color: "#c06c2b" },
      { id: "active", name: "Active student", probability: 85, color: "#8e3d6b" },
      { id: "won", name: "Course completed", probability: 100, color: "#2f8f46" }
    ],
    fields: [
      { entity: "customer", name: "Student age", type: "number", required: false },
      { entity: "deal", name: "Course interest", type: "text", required: true },
      { entity: "deal", name: "Preferred schedule", type: "text", required: false },
      { entity: "task", name: "Trial class date", type: "date", required: false }
    ],
    kpis: [
      { name: "Inquiry to enrollment", target: "45", frequency: "monthly" },
      { name: "Active students", target: "60", frequency: "monthly" },
      { name: "Course completion", target: "88", frequency: "monthly" }
    ]
  }
});

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() { return new Date().toISOString(); }

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeSector(value) {
  const v = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return SECTOR_ALIASES[v] || "services";
}

function getIndustryTemplate(industryKey) {
  const key = normalizeSector(industryKey);
  return { key, label: SECTOR_LABELS[key] || "Service CRM", ...(INDUSTRY_TEMPLATES[key] || INDUSTRY_TEMPLATES.services) };
}

function listIndustryTemplates() {
  return SECTOR_KEYS.map(key => ({ key, label: SECTOR_LABELS[key], ...INDUSTRY_TEMPLATES[key] }));
}

/**
 * Build the (system, user) prompt pair for the AI provider. The
 * system prompt carries the JSON schema (because we use
 * `response_format: json_object`, not `json_schema`). The user
 * prompt carries the questionnaire + the industry template.
 */
function buildBlueprintPrompt(questionnaire, industryTemplate) {
  const q = questionnaire || {};
  const t = industryTemplate || getIndustryTemplate(q.industry || q.sector);
  const businessName = String(q.businessName || q.companyName || t.key).trim();

  const systemPrompt = [
    "You are a CRM blueprint architect for Armenian SMBs.",
    "Given an onboarding questionnaire and an industry template, return a JSON object with the EXACT shape:",
    JSON.stringify({
      industry: "<industryKey>",
      companyName: "<string>",
      language: "hy|en|ru",
      modules: [{ id: "string", name: "string", description: "string", priority: "high|medium|low" }],
      pipeline: [{ id: "string", name: "string", probability: 0, color: "#rrggbb" }],
      fields: [{ entity: "customer|deal|task|quote", name: "string", type: "text|select|date|number|money|user|textarea", required: false }],
      opportunities: [{ title: "string", stageId: "string", value: 0, owner: "string" }],
      tasks: [{ title: "string", due: "today|tomorrow|this week", owner: "string" }],
      kpis: [{ name: "string", target: "string", frequency: "weekly|monthly" }],
      automations: [{ trigger: "string", action: "string", when: "string" }],
      leadFormFields: [{ name: "string", type: "text|select|date|number", required: false }],
      starterMessages: [{ channel: "whatsapp|email|sms", language: "hy|en|ru", body: "string" }],
      subdomain: "<kebab-case>"
    }),
    "All field ids in `pipeline[].id` MUST be referenced by `opportunities[].stageId`.",
    "All `fields[].type` MUST be one of the listed types.",
    "Return ONLY the JSON object. No commentary."
  ].join("\n");

  const userPrompt = JSON.stringify({
    businessName,
    industry: t.key,
    industryLabel: t.label,
    template: t,
    questionnaire: q
  }, null, 2);

  return { systemPrompt, userPrompt, industryKey: t.key, industryLabel: t.label };
}

/**
 * Validate + lightly normalize the AI's JSON response into the
 * blueprint shape the SPA + apply step expect. Fills missing
 * subdomains from the company name, normalizes sector aliases,
 * coerces probabilities to integers, etc.
 */
function parseBlueprintResponse(rawJson, fallback) {
  const fb = fallback || {};
  const obj = (rawJson && typeof rawJson === "object") ? rawJson : {};
  const sector = normalizeSector(obj.industry || fb.industry || "services");
  const companyName = String(obj.companyName || fb.businessName || fb.companyName || "Armenian SMB").trim();

  const modules = Array.isArray(obj.modules) && obj.modules.length
    ? obj.modules.map(m => ({
        id: String(m.id || "").trim() || slugify(m.name || "module"),
        name: String(m.name || m.id || "Module"),
        description: String(m.description || ""),
        priority: ["high", "medium", "low"].includes(m.priority) ? m.priority : "medium"
      }))
    : (fallback.modules || INDUSTRY_TEMPLATES[sector].modules);

  const pipeline = Array.isArray(obj.pipeline) && obj.pipeline.length
    ? obj.pipeline.map(s => ({
        id: String(s.id || "").trim() || slugify(s.name || "stage"),
        name: String(s.name || s.id || "Stage"),
        probability: Math.max(0, Math.min(100, Number(s.probability) || 0)),
        color: typeof s.color === "string" ? s.color : "#2d6cdf"
      }))
    : (fallback.pipeline || INDUSTRY_TEMPLATES[sector].pipeline);

  const fields = Array.isArray(obj.fields) ? obj.fields.map(f => ({
    entity: ["customer", "deal", "task", "quote"].includes(f.entity) ? f.entity : "customer",
    name: String(f.name || "").trim(),
    type: ["text", "select", "date", "number", "money", "user", "textarea"].includes(f.type) ? f.type : "text",
    required: !!f.required
  })).filter(f => f.name) : [];

  const opportunities = Array.isArray(obj.opportunities) ? obj.opportunities.map(o => ({
    title: String(o.title || "Opportunity"),
    stageId: String(o.stageId || "").trim(),
    value: Math.max(0, Number(o.value) || 0),
    owner: String(o.owner || "Owner")
  })) : [];

  const tasks = Array.isArray(obj.tasks) ? obj.tasks.map(t => ({
    title: String(t.title || "Task"),
    due: String(t.due || "this week"),
    owner: String(t.owner || "Operator")
  })) : [];

  const kpis = Array.isArray(obj.kpis) ? obj.kpis.map(k => ({
    name: String(k.name || "KPI"),
    target: String(k.target || ""),
    frequency: ["weekly", "monthly", "daily"].includes(k.frequency) ? k.frequency : "monthly"
  })) : [];

  const automations = Array.isArray(obj.automations) ? obj.automations.map(a => ({
    trigger: String(a.trigger || ""),
    action: String(a.action || ""),
    when: String(a.when || "")
  })) : [];

  const leadFormFields = Array.isArray(obj.leadFormFields) ? obj.leadFormFields.map(f => ({
    name: String(f.name || "").trim(),
    type: ["text", "select", "date", "number"].includes(f.type) ? f.type : "text",
    required: !!f.required
  })).filter(f => f.name) : [];

  const starterMessages = Array.isArray(obj.starterMessages) ? obj.starterMessages.map(m => ({
    channel: ["whatsapp", "email", "sms"].includes(m.channel) ? m.channel : "whatsapp",
    language: ["hy", "en", "ru"].includes(m.language) ? m.language : "en",
    body: String(m.body || "")
  })) : [];

  const subdomain = slugify(obj.subdomain || companyName);

  return {
    industry: sector,
    industryLabel: SECTOR_LABELS[sector],
    companyName,
    language: ["hy", "en", "ru"].includes(obj.language) ? obj.language : "en",
    modules,
    pipeline,
    fields,
    opportunities,
    tasks,
    kpis,
    automations,
    leadFormFields,
    starterMessages,
    subdomain
  };
}

/**
 * Generate a blueprint. Calls `provider.generateStructured` and
 * parses the result. Returns the canonical blueprint shape + the
 * evidence envelope from the AI call (so the route can audit it).
 *
 *   generateBlueprint(questionnaire, provider, opts)
 *
 * `opts.templateOverride` skips the AI call and uses the supplied
 * template directly — handy for the "deterministic" test path and
 * for offline demos.
 */
async function generateBlueprint(questionnaire, provider, opts) {
  if (!provider) throw new Error("provider is required");
  const o = opts || {};
  const template = getIndustryTemplate((questionnaire || {}).industry || (questionnaire || {}).sector);

  if (o.templateOverride) {
    return {
      ok: true,
      blueprint: parseBlueprintResponse({}, { industry: template.key, businessName: (questionnaire || {}).businessName }),
      evidence: { url: "about:blank", method: "OVERRIDE", requestHash: "", responseHash: "", at: nowIso() },
      warnings: ["templateOverride: skipped AI call"]
    };
  }

  const { systemPrompt, userPrompt, industryKey, industryLabel } = buildBlueprintPrompt(questionnaire, template);
  const res = await provider.generateStructured({ systemPrompt, userPrompt });
  if (!res || !res.ok) {
    return {
      ok: false,
      blueprint: null,
      evidence: (res && res.evidence) || null,
      warnings: ["AI call failed; falling back to template"],
      error: (res && res.error) || "unknown"
    };
  }
  const blueprint = parseBlueprintResponse(res.data, { industry: industryKey, businessName: (questionnaire || {}).businessName });
  return {
    ok: true,
    blueprint,
    evidence: res.evidence || null,
    warnings: (res.warnings || []).concat(blueprint.industry !== normalizeSector(industryKey) ? ["industry was normalized"] : [])
  };
}

/**
 * Persist a blueprint + return the stored row. The caller is the
 * route layer; this function does NOT write to audit_events (the
 * route does that, mirroring crmTube.js).
 */
function saveBlueprint(db, orgId, blueprint, sourceMeta) {
  const id = randomId("blueprint");
  const now = nowIso();
  const doc = JSON.stringify(blueprint || {});
  db.prepare(`
    INSERT INTO smb_crm_blueprints (
      id, org_id, industry, company_name, language, subdomain,
      doc, source_provider, source_evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, orgId,
    String(blueprint.industry || "services"),
    String(blueprint.companyName || ""),
    String(blueprint.language || "en"),
    String(blueprint.subdomain || ""),
    doc,
    String((sourceMeta && sourceMeta.provider) || "openrouter"),
    sourceMeta && sourceMeta.evidence ? JSON.stringify(sourceMeta.evidence) : null,
    now, now
  );
  return getBlueprint(db, orgId, id);
}

function getBlueprint(db, orgId, blueprintId) {
  const row = db
    .prepare("SELECT * FROM smb_crm_blueprints WHERE org_id = ? AND id = ?")
    .get(orgId, blueprintId);
  if (!row) return null;
  let doc = {};
  try { doc = JSON.parse(row.doc || "{}"); } catch { doc = {}; }
  let evidence = null;
  if (row.source_evidence_json) {
    try { evidence = JSON.parse(row.source_evidence_json); } catch { evidence = null; }
  }
  return {
    id: row.id,
    orgId: row.org_id,
    industry: row.industry,
    companyName: row.company_name,
    language: row.language,
    subdomain: row.subdomain,
    doc,
    sourceProvider: row.source_provider,
    sourceEvidence: evidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Materialize a blueprint into the live schema. Creates one row
 * per module, pipeline stage, field, opportunity, and task. Returns
 * a summary the route can echo back.
 *
 * The function is idempotent on (orgId, blueprintId) via the
 * smb_crm_blueprint_applied table — re-applying is a no-op.
 */
function applyBlueprint(db, orgId, blueprint) {
  if (!blueprint || typeof blueprint !== "object") {
    const err = new Error("blueprint is required");
    err.statusCode = 400;
    throw err;
  }
  const blueprintId = String(blueprint.id || "").trim();
  if (!blueprintId) {
    const err = new Error("blueprint.id is required");
    err.statusCode = 400;
    throw err;
  }

  // Cross-tenant check: caller passed `orgId`; the blueprint row
  // must belong to the same org. RLS is the route layer's job;
  // this engine function does a belt-and-suspenders check.
  const stored = db
    .prepare("SELECT org_id FROM smb_crm_blueprints WHERE id = ?")
    .get(blueprintId);
  if (!stored) {
    const err = new Error("Blueprint not found");
    err.statusCode = 404;
    throw err;
  }
  if (stored.org_id !== orgId) {
    const err = new Error("Blueprint belongs to a different org");
    err.statusCode = 403;
    err.code = "ORG_MISMATCH";
    throw err;
  }

  // Idempotency: re-apply is a no-op.
  const existing = db
    .prepare("SELECT id, applied_at FROM smb_crm_blueprint_applied WHERE org_id = ? AND blueprint_id = ?")
    .get(orgId, blueprintId);
  if (existing) {
    return {
      ok: true,
      alreadyApplied: true,
      appliedAt: existing.applied_at,
      summary: existing
    };
  }

  const doc = blueprint.doc || blueprint;
  const now = nowIso();

  const counts = { modules: 0, pipelineStages: 0, fields: 0, opportunities: 0, tasks: 0 };

  db.exec("BEGIN");
  try {
    if (Array.isArray(doc.modules)) {
      const stmt = db.prepare(`
        INSERT INTO smb_crm_modules (id, org_id, blueprint_id, slug, name, description, priority, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const m of doc.modules) {
        stmt.run(
          randomId("module"), orgId, blueprintId,
          String(m.id || "").trim() || slugify(m.name || "module"),
          String(m.name || m.id || "Module"),
          String(m.description || ""),
          ["high", "medium", "low"].includes(m.priority) ? m.priority : "medium",
          now, now
        );
        counts.modules += 1;
      }
    }
    if (Array.isArray(doc.pipeline)) {
      const stmt = db.prepare(`
        INSERT INTO smb_crm_pipeline_stages (id, org_id, blueprint_id, slug, name, probability, color, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      doc.pipeline.forEach((s, idx) => {
        stmt.run(
          randomId("stage"), orgId, blueprintId,
          String(s.id || "").trim() || slugify(s.name || "stage"),
          String(s.name || s.id || "Stage"),
          Math.max(0, Math.min(100, Number(s.probability) || 0)),
          typeof s.color === "string" ? s.color : "#2d6cdf",
          idx, now, now
        );
        counts.pipelineStages += 1;
      });
    }
    if (Array.isArray(doc.fields)) {
      const stmt = db.prepare(`
        INSERT INTO smb_crm_fields (id, org_id, blueprint_id, entity, name, type, required, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const f of doc.fields) {
        if (!f.name) continue;
        stmt.run(
          randomId("field"), orgId, blueprintId,
          ["customer", "deal", "task", "quote"].includes(f.entity) ? f.entity : "customer",
          String(f.name),
          ["text", "select", "date", "number", "money", "user", "textarea"].includes(f.type) ? f.type : "text",
          f.required ? 1 : 0,
          now, now
        );
        counts.fields += 1;
      }
    }
    if (Array.isArray(doc.opportunities)) {
      const stmt = db.prepare(`
        INSERT INTO smb_crm_oportunidades (id, org_id, blueprint_id, title, stage_id, value, owner, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const o of doc.opportunities) {
        stmt.run(
          randomId("opp"), orgId, blueprintId,
          String(o.title || "Opportunity"),
          String(o.stageId || "").trim(),
          Math.max(0, Number(o.value) || 0),
          String(o.owner || "Owner"),
          now, now
        );
        counts.opportunities += 1;
      }
    }
    if (Array.isArray(doc.tasks)) {
      const stmt = db.prepare(`
        INSERT INTO smb_crm_tasks (id, org_id, blueprint_id, title, due_label, owner, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `);
      for (const t of doc.tasks) {
        stmt.run(
          randomId("bp-task"), orgId, blueprintId,
          String(t.title || "Task"),
          String(t.due || "this week"),
          String(t.owner || "Operator"),
          now, now
        );
        counts.tasks += 1;
      }
    }
    db.prepare(`
      INSERT INTO smb_crm_blueprint_applied (id, org_id, blueprint_id, applied_at, counts_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      randomId("applied"), orgId, blueprintId, now, JSON.stringify(counts)
    );
    db.exec("COMMIT");
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* swallow */ }
    throw err;
  }

  return { ok: true, alreadyApplied: false, appliedAt: now, summary: counts };
}

module.exports = {
  SECTOR_KEYS,
  SECTOR_LABELS,
  INDUSTRY_TEMPLATES,
  normalizeSector,
  getIndustryTemplate,
  listIndustryTemplates,
  buildBlueprintPrompt,
  parseBlueprintResponse,
  generateBlueprint,
  saveBlueprint,
  getBlueprint,
  applyBlueprint,
  slugify
};
