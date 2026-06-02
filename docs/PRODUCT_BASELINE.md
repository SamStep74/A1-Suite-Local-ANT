# Armosphera One Product Baseline

This project starts from the research documents in `../HAy Hashvapah Web Claude/docs/`:

- `ARMOSPHERA_ONE_RESEARCH.md`
- `ZOHO_ONE_FEATURE_MAP.md`

The active execution plan is now revised by:

- `docs/ZOHO_SALESFORCE_REWORKED_PLAN.md`
- `docs/DEEP_RESEARCH_RECONCILIATION.md`

This revision processes the attached `deep-research-report.md`. Zoho One remains the suite breadth and ergonomics benchmark, Salesforce sets the platform-depth benchmark, and Armosphera One is now scoped as a focused Armenian operating layer rather than a full clone of either product.

Commodity capabilities such as email hosting, calendaring, office documents, generic chat, full HRIS, generic website builder, RPA, and broad marketplace features are integration targets or later modules. HayHashvapah remains first-class because Armenian accounting, tax, payroll, legal RAG, e-invoice/export, and period-lock behavior are a differentiated local product advantage.

Phase 1 acceptance boundary:

- Suite login/session.
- Organization profile.
- Users, roles, and app entitlements.
- App launcher with CRM, Finance, Desk, Campaigns, Projects, People, Docs, Analytics, Flow.
- Audit events.
- Customer 360 spanning CRM, finance, service, automation, and legal/accounting context.
- Armenian-first demo data and localization anchors.

## Implemented Slice 1: Customer 360 And Event Bus

Status: shipped in the local prototype on 2026-05-26.

- Added canonical customer profile records over seeded customers.
- Added customer profile source lineage for CRM, HayHashvapah Finance, Desk, and Campaign consent.
- Added append-only suite event log.
- Added `/api/events` list and create endpoints.
- Extended `/api/customer-360/:id` with `profile`, `profileSources`, and `timeline`.
- Extended analytics with event counts.
- Updated the workspace UI with canonical profile quality, source confidence, operating timeline, and platform event-bus panels.
- Added API tests for source lineage, event statistics, event creation, customer timeline updates, and audit capture.

## Implemented Slice 2: Service Hub And Governed Approvals

Status: shipped in the local prototype on 2026-05-26.

- Added service case records over seeded tickets.
- Added case messages with inbound and assistant-draft states.
- Added workflow approvals with financial/legal risk levels, pending/approved/rejected lifecycle, and owner-only decision endpoint.
- Added `/api/service/console`, `/api/service/cases`, `/api/service/cases/:id/replies`, `/api/workflow/approvals`, and `/api/workflow/approvals/:id/decision`.
- Connected service cases and workflow approvals back into Customer 360.
- Added suite events and audit records for service case creation, service replies, and approval decisions.
- Updated the workspace UI with Service Hub operator console, SLA queue metrics, knowledge suggestions, and Workflow Studio approval queue.
- Added API tests for service queue/SLA context, case creation/timeline propagation, owner approval decisions, and approval audit records.

## Implemented Slice 3: Executed Workflow To CRM Task

Status: shipped in the local prototype on 2026-05-26.

- Added CRM task records as the CRM-side operational output of approved workflow actions.
- Added workflow run records with approval idempotency, result type, result id, payload, and completion timestamps.
- Added `/api/workflow/approvals/:id/execute` and `/api/workflow/runs`.
- Enforced that pending approvals cannot execute, rejected approvals cannot execute, and already-executed approvals return the existing run/task instead of creating duplicates.
- Implemented the first executable workflow action: approved overdue HayHashvapah invoice -> CRM collection task.
- Connected created CRM tasks and workflow runs back into Customer 360.
- Added suite events and audit records for `crm.task.created` and `workflow.action.executed`.
- Updated the workspace UI with an approval execution control, CRM task rows, workflow run rows, and run history.
- Added API tests for pre-approval blocking, execution, idempotency, Customer 360 propagation, run listing, and audit capture.

## Implemented Slice 4: Deal Approval To HayHashvapah Draft Invoice

Status: shipped in the local prototype on 2026-05-26.

- Added Armenian finance period records with open/closed status, close/reopen owner controls, and audit/suite events.
- Added HayHashvapah draft invoice records with VAT-inclusive 20% AMD breakdown, period key, due date, deal lineage, and idempotent workflow source key.
- Added the governed `finance.invoice.propose` action for the existing `deal won -> draft HayHashvapah invoice` workflow rule.
- Enforced period lock blocking before any draft finance record is created.
- Added `/api/finance/periods`, `/api/finance/periods/:periodKey/close`, `/api/finance/periods/:periodKey/reopen`, and `/api/finance/draft-invoices`.
- Connected draft invoices and the current finance period back into Customer 360.
- Updated Workflow Studio so owner-approved finance workflow actions create draft HayHashvapah invoices.
- Added API tests for finance period visibility, draft invoice execution/idempotency, Customer 360 propagation, run listing, audit capture, and closed-period blocking.

## Implemented Slice 5: Draft Invoice Posting And Payment Receipt

Status: shipped in the local prototype on 2026-05-26.

- Added draft-to-official invoice posting with an immutable link between the HayHashvapah draft invoice and the posted receivable.
- Enforced the same Armenian finance period lock before posting a draft invoice.
- Added payment receipt records with method, reference, paid date, period key, source idempotency, and customer/invoice lineage.
- Updated invoice status to `partial` or `paid` based on recorded payments.
- Added `/api/finance/draft-invoices/:id/post`, `/api/finance/payments`, and `/api/finance/invoices/:id/payments`.
- Connected invoice links and payment receipts back into Customer 360.
- Updated the workspace UI with posted invoice, payment, and draft-link finance ledger visibility.
- Added API tests for posting idempotency, payment idempotency, Customer 360 propagation, audit capture, and closed-period blocking for both posting and payments.

## Implemented Slice 6: Public Quote Acceptance To Deal Won

Status: shipped in the local prototype on 2026-05-26.

- Added CRM quote records, quote line items, public quote tokens, and immutable quote acceptance records.
- Added unauthenticated public quote viewing and acceptance endpoints for Armenian customer quote links.
- Public quote acceptance now marks the linked CRM deal as `Won` with 100% probability.
- Accepted quotes automatically create a governed `finance.invoice.propose` approval so the HayHashvapah draft invoice path remains owner-controlled.
- Added suite events for `crm.quote.accepted`, `crm.deal.won`, and the generated workflow approval.
- Connected quotes and quote acceptances back into Customer 360.
- Updated the workspace UI with CRM quote and quote acceptance rows.
- Added API tests for public quote viewing, idempotent acceptance, deal-won transition, approval generation, Customer 360 propagation, and audit capture.

## Implemented Slice 7: Outbound Connector Webhooks

Status: shipped in the local prototype on 2026-05-26.

- Added owner-managed outbound webhook endpoints with enabled event list, target URL, and masked signing secret.
- Added webhook delivery records with event key, subject, customer, status, attempt count, response status/body, retry timestamp, and delivered timestamp.
- Added HMAC SHA-256 request signing with `x-armosphera-signature`.
- Added synchronous delivery for `quote_accepted`, `deal_won`, and first-time `invoice_paid` connector events.
- Added manual retry endpoint for failed webhook deliveries.
- Added `/api/integrations/webhooks`, `/api/integrations/webhook-deliveries`, and `/api/integrations/webhook-deliveries/:id/retry`.
- Updated the workspace UI with an Integration Webhooks delivery-log panel.
- Added API tests for signed quote/deal delivery, first-time-only invoice-paid delivery, failed delivery capture, and manual retry.

## Implemented Slice 8: Cited Armenian Legal Guidance

Status: shipped in the local prototype on 2026-05-26.

- Added legal question, legal answer, and legal answer source records for Armenian localization workflows.
- Added deterministic source selection for VAT/tax, personal-data consent/export/delete, and e-signature/document questions.
- Added `/api/legal/questions` for creating and listing cited guidance by customer.
- Cited legal/tax answers now create governed `legal.answer.approve` workflow approvals when review is required.
- Added suite events and audit records for `legal.question.asked`, `legal.answer.generated`, and generated approval requests.
- Connected legal questions, answers, sources, and review approvals back into Customer 360.
- Updated the workspace UI with a Customer 360 Legal Guidance control and cited-source display.
- Added API tests for VAT answer citation, personal-data source selection, approval queue propagation, Customer 360 propagation, and approval audit capture.

## Implemented Slice 9: Approved Legal Answer Publication

Status: shipped in the local prototype on 2026-05-26.

- Added legal publication records as the governed output of approved cited legal answers.
- Added executable workflow support for `legal.answer.approve`.
- Executing an approved legal answer now creates a `legal_publication` workflow run, marks the question published, clears the answer review flag, and keeps approval execution idempotent.
- Added suite events and audit records for `legal.answer.published` and `workflow.action.executed`.
- Connected published legal answers back into Customer 360 through the answer publication object and workflow-run history.
- Updated Workflow Studio so legal-answer approvals can be approved and published from the workspace.
- Added API tests for publication execution, idempotent re-execution, Customer 360 propagation, run listing, timeline propagation, and audit capture.

## Implemented Slice 10: Legal Source Registry Review

Status: shipped in the local prototype on 2026-05-26.

- Added legal source review records for maintained and professionally reviewed Armenian legal/accounting source versions.
- Added `/api/legal/sources/:id/reviews` with status, effective date, title, URL, review note validation, Owner/Admin maintenance access, and source-specific Accountant/Lawyer professional review access.
- Legal source reviews update the source registry while preserving review history, latest reviewer, and review count.
- Legal answers now cite source metadata that reflects the latest reviewed legal source version.
- Added suite events and audit records for `legal.source.reviewed`.
- Updated the workspace Legal and accounting readiness panel with legal source registry cards and VAT review action.
- Added API tests for owner source maintenance, professional source review, source listing with latest review metadata, answer citation freshness, audit capture, and non-reviewer rejection.

## Implemented Slice 11: SRC Offline Export Packet

Status: shipped in the local prototype on 2026-05-26.

- Added finance SRC export records for period-level HayHashvapah invoice export packets.
- Added owner-only `/api/finance/src-exports` create endpoint and authenticated listing endpoint.
- Export packet creation requires an open finance period, at least one posted HayHashvapah invoice for that period, and an active reviewed VAT legal source.
- Export payloads include organization tax identity, period metadata, reviewed legal source metadata, invoice/customer TIN rows, totals, and SHA-256 checksum.
- Export creation is idempotent by period and does not claim live SRC submission; packets are prepared for accountant review.
- Added suite events and audit records for `finance.src_export.created`.
- Updated the workspace Legal and accounting readiness panel with SRC export packet cards and a Prepare SRC action.
- Added API tests for missing reviewed VAT-source blocking, idempotent export creation, packet payload/checksum correctness, export listing, audit capture, and period-lock blocking.

## Implemented Slice 12: Armenian E-Signature Evidence Packet

Status: shipped in the local prototype on 2026-05-26.

- Added Docs & Sign signature evidence packet records for accepted public quote evidence.
- Added owner-only `/api/docs/signature-packets` creation and authenticated packet listing.
- Packet creation requires an accepted CRM quote and an active reviewed Armenian e-signature legal source.
- Evidence payloads include organization/customer tax identity, accepted quote details, signer name/email, accepted timestamp, IP/user-agent evidence, legal source metadata, and SHA-256 checksum.
- Packet creation is idempotent by quote and is explicitly a Docs & Sign handoff artifact, not a qualified signature service.
- Added suite events and audit records for `docs.signature_packet.created`.
- Connected signature packets into Customer 360 under the Docs context and the operating timeline.
- Updated the workspace Legal and accounting readiness panel with e-sign evidence cards, Prepare eSign action, and e-sign source review action.
- Added API tests for e-sign source prerequisite blocking, idempotent packet creation, payload/checksum correctness, listing, Customer 360 propagation, timeline propagation, and audit capture.

## Implemented Slice 13: Armenian Personal-Data Export Governance

Status: shipped in the local prototype on 2026-05-26.

- Added privacy request and privacy export packet records for customer personal-data fulfillment workflows.
- Added authenticated `/api/privacy/requests` create/list endpoints.
- Export request creation requires an active reviewed Armenian personal-data legal source.
- Export requests create governed `privacy.request.approve` workflow approvals with legal risk.
- Executing an approved request creates an idempotent `privacy_export_packet` workflow run, marks the request fulfilled, and preserves repeated execution safety.
- Export payloads include customer identity, canonical Customer 360 profile, source lineage, CRM quote context, request metadata, reviewed legal source metadata, disclaimer, and SHA-256 checksum.
- Added suite events and audit records for `privacy.request.created`, `privacy.export_packet.created`, and `workflow.action.executed`.
- Connected privacy requests and export packets into Customer 360, suite payloads, the operating timeline, Workflow Studio, and the Armenia localization readiness panel.
- Added workspace actions for personal-data source review and export packet preparation.
- Added API tests for missing reviewed personal-data-source blocking, governed approval execution, idempotent re-execution, payload/checksum correctness, listing, Customer 360 propagation, timeline propagation, and audit capture.

## Implemented Slice 14: Personal-Data Deletion Retention Assessment

Status: shipped in the local prototype on 2026-05-26.

- Extended privacy requests to support governed `delete` requests in addition to export requests.
- Added privacy retention assessment records for deletion requests that must be checked against Armenian business, accounting, contract, and service-retention context.
- Executing an approved delete request now creates an idempotent `privacy_retention_assessment` workflow run instead of deleting customer data automatically.
- Assessment payloads include customer identity, canonical profile state, authoritative retained profile sources, HayHashvapah invoice/payment context, CRM quote context, service cases, erasable marketing/support candidates, reviewed legal source metadata, recommendation, and SHA-256 checksum.
- Added `restrict-delete-retain-statutory-records` recommendation when finance, payment, or contract/quote records are present.
- Added suite events and audit records for `privacy.retention_assessment.created` and workflow execution.
- Connected retention assessments into Customer 360, privacy request listing, suite payloads, Workflow Studio, and the Armenia localization readiness panel.
- Added workspace action for deletion assessment preparation.
- Added API tests proving delete requests are approval-gated, customer data remains intact, statutory records are retained, repeated execution is idempotent, and Customer 360/timeline/audit propagation works.

## Implemented Slice 15: Customer 360 Field-Level Visibility

Status: shipped in the local prototype on 2026-05-26.

- Added role-aware Customer 360 access policy metadata to every customer profile response.
- Owner/Admin users retain full Customer 360 access.
- Non-owner roles receive a `support-customer360-redacted` response that preserves operational service context while redacting tax identifiers, direct contact fields, financial amounts, VAT context, profile match keys, privacy payloads, document evidence payloads, workflow payloads, and sensitive timeline payload fields.
- Added audit records for `customer360.sensitive_fields.redacted` whenever a restricted role opens Customer 360.
- Updated the workspace Customer 360 panel with access-policy status and restricted amount rendering.
- Added API tests proving Support can use Customer 360 without receiving sensitive tax, finance, privacy, legal-answer, or payload data.

## Implemented Slice 16: Tenant Backup and Restore Proof

Status: shipped in the local prototype on 2026-05-26.

- Added owner-only tenant backup packets with checksum, table counts, exclusion metadata, note, creator, and creation timestamp.
- Added `/api/admin/backups` listing and creation endpoints plus `/api/admin/backups/:id/restore-proof` verification endpoint.
- Backup payloads include tenant organization state, app assignments, Customer 360 data, CRM, service, finance, quote, document, legal, workflow, suite event, and audit records needed for restore readiness.
- Backup payloads explicitly exclude sessions, user credentials, webhook signing keys, and quote public-access tokens.
- Webhook endpoints are retained with `secretExcluded: true` so restore operators know secrets must be re-entered.
- Restore proof verifies checksum integrity, sanitized secret scan, table counts, and restore-only-into-empty-tenant plan.
- Added audit records for `admin.backup.created` and `admin.backup.restore_proof.verified`.
- Updated the workspace with an owner-only Backup and Restore tenant proof panel.
- Added API tests proving sanitized payload creation, checksum correctness, secret exclusion, restore-proof verification, listing without payload leakage, audit capture, and non-owner rejection.

## Implemented Slice 17: Role Model And Access Review Evidence

Status: shipped in the local prototype on 2026-05-26.

- Added expanded Armenia SaaS roles: Accountant, Lawyer, Salesperson, Service Manager, and Auditor.
- Added least-privilege app entitlements for the expanded roles while preserving Owner/Admin full-suite access and Support's restricted service-facing access.
- Added owner-created access review packets with role summaries, user lists, app matrix, privileged-user inventory, orphaned assignment-role findings, governance controls, and SHA-256 checksum.
- Added auditor-readable `/api/admin/access-reviews` listing while keeping packet creation owner-only.
- Added suite events and audit records for `admin.access_review.created`.
- Added access review packets to tenant backup scope so governance evidence is restorable with the tenant.
- Updated the workspace with an Admin Governance access-review panel for Owner and Auditor roles.
- Added API tests proving expanded role login/entitlements, owner-created review packet integrity, auditor read-only visibility, checksum correctness, password-hash exclusion, and audit capture.

## Implemented Slice 18: CRM Lead Scoring And Conversion

Status: shipped in the local prototype on 2026-05-26.

- Added CRM lead records for Armenian SMB intake across Instagram, WhatsApp, Telegram, manual, and other sources.
- Added deterministic lead scoring, hot/warm/cold rating, qualified/new status assignment, and Salesperson routing.
- Added `/api/crm/leads` listing and creation plus `/api/crm/leads/:id/convert` conversion endpoint.
- Lead conversion creates a Customer 360 customer, canonical customer profile, source lineage, first qualified deal, and CRM conversion activity with forecast category.
- Conversion is idempotent: repeating conversion for the same lead returns the existing customer, deal, and activity.
- Added suite events and audit records for `crm.lead.created` and `crm.lead.converted`.
- Connected CRM activities into Customer 360 and tenant backup scope.
- Updated the workspace with an Armosphera CRM Lead Pipeline panel for capture, scoring visibility, qualified pipeline value, and hot-lead conversion.
- Added API tests proving lead capture/scoring/routing, qualified pipeline summary, conversion propagation into Customer 360/timeline, idempotency, audit capture, and auditor write rejection.

## Implemented Slice 19: CRM Forecast And Deal Health

Status: shipped in the local prototype on 2026-05-26.

- Added CRM deal forecast records with forecast category, close date, weighted value, health score, health status, manager note, updater, and timestamps.
- Added `/api/crm/forecast` summary endpoint and `/api/crm/deals/:id/forecast` update endpoint.
- Deal health now calculates deterministic reasons such as quote sent, commit category, current close date, probability alignment, and HayHashvapah handoff readiness.
- Weighted forecast uses current deal value and probability, grouped by forecast category for owner/sales review.
- Customer 360 deals now include forecast category, weighted value, health score/status, health reasons, close date, and manager note.
- Added suite events and audit records for `crm.deal.forecast_updated` / `crm.deal.forecast.updated`.
- Added deal forecasts to tenant backup scope.
- Updated the workspace with a Sales Forecast / Deal Health panel and inline forecast/health context in Customer 360 deal rows.
- Added API tests proving salesperson forecast update, weighted forecast summary, Customer 360/timeline propagation, audit capture, and support-role write rejection.

## Implemented Slice 20: Governed Quote Release Approval

Status: shipped in the local prototype on 2026-05-26.

- Added authenticated CRM quote creation for draft Armenian quotes tied to an existing customer and deal.
- Added `/api/crm/quotes/:id/request-approval` to create an idempotent governed `crm.quote.release` workflow approval.
- Public quote links now remain hidden until the quote is released; draft quotes return 404 through the public quote endpoint.
- Executing an approved quote-release workflow marks the quote `sent`, sets `sentAt`, records a `crm_quote_release` workflow run, and exposes the public acceptance URL.
- Added suite events and audit records for `crm.quote.created`, `crm.quote.release_requested`, `crm.quote.released`, and workflow execution.
- Narrowed quote-to-invoice finance approval lookup so quote release approvals do not collide with accepted-quote invoice approvals.
- Updated Workflow Studio so quote-release approvals can be approved and executed from the workspace.
- Added a Quote Governance panel for creating a draft quote and requesting public release approval.
- Added API tests proving draft quote creation, hidden public quote links before release, idempotent approval request, release execution, public quote visibility after release, Customer 360/timeline propagation, and audit capture.

## Implemented Slice 21: Governed Service Reply Execution

Status: shipped in the local prototype on 2026-05-26.

- Added executable workflow support for governed `service.reply.send` approvals.
- Approved service-reply workflows now turn the knowledge-grounded assistant suggestion into a human-approved operator reply.
- Reply execution updates the service case to `waiting-customer`, records a `service_reply` workflow run, and remains idempotent on repeated execution.
- Added suite events and audit records for `service.reply.sent` and workflow execution.
- Connected the service reply run and updated case message count back into Customer 360 and the Service Hub console.
- Updated Workflow Studio so legal/service reply approvals can be approved and sent from the workspace.
- Added API tests proving pending execution blocking, approval-gated reply sending, idempotency, Customer 360/timeline propagation, Service Hub queue propagation, and audit capture.

## Implemented Slice 22: Service SLA Supervisor Escalation

Status: shipped in the local prototype on 2026-05-26.

- Added supervisor-only service case escalation records for SLA/customer/finance risk follow-up.
- Added `/api/service/cases/:id/escalate` with Service Manager, Owner, and Admin authorization.
- Escalation updates the case to `escalated`, assigns supervisor ownership, adds an internal supervisor message, and keeps repeated open escalation requests idempotent.
- Added escalation queue metrics and escalation rows to the Service Hub console.
- Connected open escalations back into Customer 360 and tenant backup scope.
- Added suite events and audit records for `service.case.escalated`.
- Updated the workspace Service Hub with an at-risk case escalation action and supervisor escalation cards.
- Added API tests proving front-line support rejection, Service Manager escalation, idempotency, queue propagation, Customer 360/timeline propagation, and audit capture.

## Implemented Slice 23: Service Resolution And Satisfaction Evidence

Status: shipped in the local prototype on 2026-05-26.

- Added service case resolution records with resolution code, supervisor summary, customer confirmation timestamp, and 1-5 satisfaction score.
- Added `/api/service/cases/:id/resolve`; escalated cases require Service Manager, Owner, or Admin authority.
- Resolution closes the service case, marks the SLA state `resolved`, closes any open escalation, and appends an internal supervisor closure message.
- Resolution creation is idempotent per case so repeated closure attempts return the original evidence packet.
- Added average satisfaction and recent resolution cards to the Service Hub console.
- Connected resolution evidence and average satisfaction back into Customer 360 and tenant backup scope.
- Added suite events and audit records for `service.case.resolved`.
- Updated the workspace Service Hub with an escalated-case Resolve action and CSAT display.
- Added API tests proving escalated-case role enforcement, closure, escalation closeout, idempotency, queue propagation, Customer 360/timeline propagation, and audit capture.

## Implemented Slice 24: Campaign ROI Attribution

Status: shipped in the local prototype on 2026-05-26.

- Added marketing campaign and campaign attribution records for Armenia SMB lead/customer influence tracking.
- Seeded a pilot Instagram/WhatsApp campaign with lead and customer/deal attribution.
- Added `/api/campaigns/performance` for campaign spend, lead count, customer count, influenced pipeline, accepted revenue, paid revenue, and ROI percent.
- Campaign paid revenue uses payment receipts and paid HayHashvapah invoices from attributed customers.
- Added campaign semantic metrics into `/api/analytics`.
- Connected campaign attribution and customer-specific campaign performance back into Customer 360 and tenant backup scope.
- Added suite event evidence for `campaign.attribution.recorded`.
- Updated the workspace with a Growth Hub campaign ROI panel and Customer 360 campaign attribution rows.
- Added API tests proving campaign performance, analytics propagation, Customer 360 attribution, and timeline evidence.

## Implemented Slice 25: Receivables Aging Semantic Analytics

Status: shipped in the local prototype on 2026-05-26.

- Added `/api/analytics/receivables-aging` for deterministic Armenia-localized receivables reporting as of `2026-05-26`.
- Grouped open HayHashvapah invoices into current, 1-30, 31-60, 61-90, and 90+ day aging buckets.
- Added invoice-level drilldowns with customer, due date, days past due, bucket label, and CRM next-action guidance.
- Embedded receivables aging into `/api/analytics` beside pipeline, service, automation, and campaign metrics.
- Connected customer-specific aging evidence back into Customer 360 while preserving redaction for non-owner views.
- Updated the workspace with a HayHashvapah Analytics receivables aging panel and Customer 360 receivable evidence rows.
- Added API tests proving accountant analytics access, bucket totals, invoice drilldowns, analytics propagation, and Customer 360 evidence.

## Implemented Slice 26: Payment Promise Reminder Evidence

Status: shipped in the local prototype on 2026-05-26.

- Added governed payment-promise records linked to CRM collection tasks and HayHashvapah invoices.
- Added `/api/crm/tasks/:id/payment-promise` for recording promised amount, promise date, reminder channel, Armenian reminder copy, and note.
- Added `/api/crm/collection-promises` for customer-specific CRM collection follow-up evidence.
- Payment promise creation is idempotent per task, date, and amount to avoid duplicate reminders from repeated operator clicks.
- Recording a promise moves the CRM task to `waiting-payment`, schedules the reminder, emits `crm.collection_promise.recorded`, and writes audit evidence.
- Connected collection promises back into Customer 360 with redaction for non-owner sensitive views and tenant backup scope.
- Updated the workspace with a Customer 360 collection promise action, promise metrics, and promise evidence rows.
- Added API tests proving workflow task execution, promise creation, idempotency, listing, Customer 360 propagation, timeline evidence, and audit capture.

## Implemented Slice 27: Collection Reminder Dispatch Evidence

Status: shipped in the local prototype on 2026-05-26.

- Added collection reminder delivery records linked to payment promises, CRM collection tasks, and HayHashvapah invoices.
- Added `/api/crm/collection-promises/:id/send-reminder` for idempotent Armenian reminder dispatch evidence.
- Added `/api/crm/collection-reminders` for customer-specific reminder delivery history.
- Reminder dispatch updates the payment promise to `reminder-sent`, moves the CRM task to `reminder-sent`, emits `crm.collection_reminder.sent`, and writes audit evidence.
- Delivery evidence stores channel, provider, recipient, Armenian message copy, sent timestamp, invoice, task, and promise linkage.
- Connected reminder deliveries back into Customer 360 with redaction for non-owner sensitive views and tenant backup scope.
- Updated the workspace with a Customer 360 reminder dispatch action, sent reminder metric, and delivery evidence rows.
- Added API tests proving promise dispatch, idempotency, delivery listing, Customer 360 propagation, timeline evidence, and audit capture.

## Implemented Slice 28: Collection Promise Payment Fulfillment

Status: shipped in the local prototype on 2026-05-26.

- Extended HayHashvapah payment receipt recording so paid invoices fulfill linked Armosphera CRM collection promises.
- Full payment on a promised invoice now moves the collection promise to `fulfilled` and closes the linked CRM task.
- Added `crm.collection_promise.fulfilled` suite events and audit records with invoice, payment, promise, and task linkage.
- Refreshed customer open receivables after payment so Customer 360 and receivables aging reflect the paid invoice immediately.
- Returned `collectionFulfillment` from `/api/finance/invoices/:id/payments` for payment-driven CRM close-loop evidence.
- Updated Customer 360 with fulfilled promise metrics, promise status display, and a demo `Record payment` action for reminder-sent promises.
- Added API tests proving payment receipt, promise fulfillment, task closure, Customer 360 propagation, receivables clearing, timeline evidence, and audit capture.

## Implemented Slice 29: Armenian Bank Transaction Reconciliation

Status: shipped in the local prototype on 2026-05-26.

- Added finance bank transaction records for Armenian bank import and reconciliation evidence.
- Added `/api/finance/bank-transactions` for importing bank credits and matching them to open HayHashvapah invoices and active collection promises.
- Added `/api/finance/bank-transactions/:id/reconcile` to convert matched bank credits into payment receipts through the existing finance payment endpoint.
- Matching uses invoice number, exact amount, active payment promise, and promise amount to produce a confidence score and accountant next action.
- Reconciliation links the bank transaction to the created payment, marks the transaction `reconciled`, fulfills linked collection promises, closes CRM tasks, and clears Customer 360 receivables.
- Connected bank transactions back into Customer 360 with redaction for non-owner sensitive views and tenant backup scope.
- Updated the workspace with bank import and reconciliation actions plus bank transaction evidence rows.
- Added API tests proving import match, reconciliation, payment creation, promise fulfillment, Customer 360 propagation, timeline evidence, and audit capture.

## Implemented Slice 30: Workflow Dry-Run Governance

Status: shipped in the local prototype on 2026-05-26.

- Added workflow dry-run evidence records for testing automation rules before they create tasks, finance records, legal publications, or external messages.
- Added `/api/workflow/rules`, `/api/workflow/dry-runs`, and `/api/workflow/rules/:id/dry-run`.
- Implemented the first governed dry-run for `invoice.overdue -> crm.task.create`, producing a proposed CRM collection task preview from a HayHashvapah overdue invoice.
- Dry-run payloads include matched subject, risk level, approval requirement, guardrails, checksum, trigger/action metadata, and operator note.
- Dry-runs are explicitly non-mutating: they emit audit/suite evidence but do not create CRM tasks or execute workflow actions.
- Connected dry-run evidence back into Customer 360, Service Console / Workflow Studio, tenant backup scope, and role-aware redaction.
- Updated the workspace with a Workflow Studio dry-run control, rule/version context, dry-run history, and Customer 360 dry-run rows.
- Added API tests proving dry-run preview creation, no CRM task side effects, listing, Customer 360 propagation, timeline evidence, and audit capture.

## Implemented Slice 31: Workflow Rule State And Version Control

Status: shipped in the local prototype on 2026-05-26.

- Added automation rule version records so every Flow rule has owner-visible version history, enabled state, reason, checksum, and changer evidence.
- Added owner-only `/api/workflow/rules/:id/state` for pausing and resuming workflow rules with required reason capture.
- Added `/api/workflow/rules/:id/versions` for viewing rule change history.
- Workflow dry-runs now respect disabled rules and return a conflict instead of previewing actions while the rule is paused.
- Rule state changes emit `workflow.rule.disabled` / `workflow.rule.enabled` suite events and matching audit records.
- Connected rule version evidence into Service Console / Workflow Studio and tenant backup scope.
- Updated the workspace with pause/resume controls, current version display, enabled/paused state, and latest change reason.
- Added API tests proving non-owner rejection, disable/enable version increments, dry-run blocking while paused, version listing, resumed dry-run behavior, and audit/event evidence.

## Implemented Slice 32: Workflow Failure Retry Governance

Status: shipped in the local prototype on 2026-05-26.

- Failed governed workflow executions are now persisted as workflow run evidence instead of disappearing behind a transient error response.
- Added `workflow_guardrail` failed-run payloads with error code, retryability, next retry action, and attempt history for Armenian finance-period lock failures.
- Added `/api/workflow/runs/:id/retry` for retrying eligible failed workflow runs after the guardrail condition is corrected.
- Implemented the first retry path for `finance.invoice.propose`, so reopening a locked HayHashvapah period can complete the original draft-invoice workflow run.
- Retry updates the same workflow run to `completed`, preserves the previous failure in payload evidence, records the successful second attempt, and keeps approval execution idempotent.
- Retry execution emits and audits `workflow.action.failed`, `workflow.action.retried`, `workflow.action.executed`, and `finance.draft_invoice.created` evidence.
- Connected failed and retried run evidence into Workflow Studio and Customer 360.
- Updated the workspace run history with failed-run status, guardrail code, next action guidance, attempt count, and a retry control.
- Added API tests proving closed-period failure capture, retry after period reopen, Customer 360 propagation, and audit/event evidence.

## Implemented Slice 33: Workflow Rule Rollback Governance

Status: shipped in the local prototype on 2026-05-26.

- Added owner-only workflow rule rollback so Flow rules can be restored to an earlier reviewed version instead of only paused or resumed forward.
- Added `/api/workflow/rules/:id/rollback` with target version validation, required rollback reason, and role enforcement.
- Rollback restores the enabled state from the selected prior version and writes a new immutable `rollback` version as the current rule state.
- Rollback emits `workflow.rule.rollback` suite events and audit records with restored-from version, previous version, new version, enabled state, and checksum evidence.
- Workflow dry-runs immediately respect the restored state, so rolling back to a disabled version blocks execution previews again.
- Updated Workflow Studio with a rollback control beside pause/resume rule governance.
- Added API tests proving non-owner rejection, rollback version creation, restored disabled state, dry-run blocking, version listing, and audit/event evidence.

## Implemented Slice 34: Workflow Test-Event Governance

Status: shipped in the local prototype on 2026-05-26.

- Added workflow test-event evidence records so operators can validate trigger payloads before live automation execution.
- Added `/api/workflow/test-events` and `/api/workflow/rules/:id/test-event` for non-mutating trigger tests with customer, subject, payload, note, guardrail, and checksum evidence.
- Implemented the first test-event path for `invoice_overdue -> crm.task.create`, producing the same proposed collection task evidence without creating CRM tasks.
- Test events respect disabled workflow rules and return a conflict when a paused or rolled-back rule is not eligible for testing.
- Test-event creation emits `workflow.test_event.created` suite events and audit records with rule, subject, customer, and checksum evidence.
- Connected test-event evidence into Workflow Studio, Customer 360, Service Console, tenant backup scope, and role-aware redaction.
- Updated the workspace with a Test event control and test-event history beside dry-run evidence.
- Added API tests proving test-event creation, no CRM side effects, listing, rule latest-event propagation, Customer 360 propagation, disabled-rule blocking, and audit evidence.

## Implemented Slice 35: Grounded AI Customer Brief

Status: shipped in the local prototype on 2026-05-26.

- Added owner-only AI customer brief evidence for advisory Customer 360 summaries grounded in CRM, HayHashvapah finance, service, legal, and automation context.
- Added `/api/ai/customer-briefs` list/create endpoints with deterministic grounded-summary policy, confidence score, advisory-only flag, review requirement flag, grounding sources, next actions, and checksum evidence.
- Customer briefs are explicitly non-mutating: they do not create workflow runs, CRM tasks, finance records, legal records, or external messages.
- Customer brief generation emits `ai.customer_brief.generated` suite events and audit records with customer, grounding-source count, confidence, advisory-only flag, and checksum evidence.
- Connected generated briefs into Customer 360, tenant backup scope, and role-aware redaction.
- Updated the workspace Customer 360 panel with an owner-only AI brief action and compact grounded advisory summary card.
- Added API tests proving owner-only access, grounded sources, advisory-only semantics, no workflow/task side effects, Customer 360 propagation, backup inclusion, and audit/event evidence.

## Implemented Slice 36: Grounded AI Deal Risk Brief

Status: shipped in the local prototype on 2026-05-26.

- Added sales/owner AI deal-risk brief evidence for advisory opportunity coaching grounded in CRM deal, CRM forecast, quote, HayHashvapah receivable, and service case context.
- Added `/api/ai/deal-risk-briefs` list/create endpoints with deterministic grounded-deal-risk policy, risk level, risk score, confidence score, advisory-only flag, grounding sources, risk factors, next actions, and checksum evidence.
- Deal-risk briefs are explicitly non-mutating: they do not update forecasts, create workflow runs, create CRM tasks, send messages, or change HayHashvapah finance records.
- Deal-risk generation emits `ai.deal_risk.generated` suite events and audit records with deal, customer, risk score, confidence, grounding-source count, advisory-only flag, and checksum evidence.
- Connected generated deal-risk briefs into Customer 360, CRM forecast summaries, tenant backup scope, and role-aware redaction.
- Updated the workspace Deal Health panel with a role-aware Risk brief action and compact grounded risk card.
- Added API tests proving support rejection, grounded CRM/forecast/finance/service sources, advisory-only semantics, no workflow/task side effects, forecast totals unchanged, Customer 360 propagation, backup inclusion, and audit/event evidence.

## Implemented Slice 37: Grounded AI Overdue Invoice Explanation

Status: shipped in the local prototype on 2026-05-26.

- Added accountant/sales/owner AI overdue-invoice explanation evidence for advisory collection guidance grounded in HayHashvapah invoice, receivables aging, CRM task, and customer profile context.
- Added `/api/ai/invoice-overdue-explanations` list/create endpoints with deterministic grounded-overdue-invoice policy, risk level, days-past-due, amount, VAT, confidence score, suggested follow-up, next actions, grounding sources, accountant review status, and checksum evidence.
- Overdue-invoice explanations are explicitly non-mutating: they do not mark invoices paid, create payment receipts, create CRM tasks, execute workflow runs, send messages, or change HayHashvapah finance records.
- Financial AI output requires accountant review status (`accountant-review-required`) and keeps `reviewRequired=true` before any customer-facing use.
- Explanation generation emits `ai.invoice_overdue.generated` suite events and audit records with invoice, customer, risk level, days overdue, confidence, advisory-only flag, accountant review status, grounding-source count, and checksum evidence.
- Connected generated explanations into Customer 360, receivables aging analytics, tenant backup scope, and role-aware redaction.
- Updated the workspace Receivables Aging panel with a role-aware Explain invoice action and compact grounded explanation card.
- Added API tests proving support rejection, grounded invoice/aging/task/profile sources, accountant review requirement, advisory-only semantics, no invoice/payment/task/workflow side effects, Customer 360 propagation, backup inclusion, and audit/event evidence.

## Implemented Slice 38: Grounded AI Ticket Summary And Knowledge Recommendation

Status: shipped in the local prototype on 2026-05-26.

- Added service-role AI ticket summary evidence for advisory support triage grounded in service case, case message, customer profile, and reviewed knowledge article context.
- Added `/api/ai/ticket-summaries` list/create endpoints with deterministic grounded-ticket-summary policy, recommended knowledge article, review status, confidence score, advisory-only flag, review requirement, next actions, grounding sources, and checksum evidence.
- Ticket summaries are explicitly non-mutating: they do not add case messages, execute workflow runs, create approvals, send replies, resolve cases, or change SLA state.
- Knowledge recommendations preserve review gates, including accountant review for VAT/procurement wording before any customer-facing service reply.
- Ticket summary generation emits `ai.ticket_summary.generated` suite events and audit records with case, customer, recommended knowledge, confidence, advisory-only flag, review requirement, grounding-source count, and checksum evidence.
- Connected generated summaries into Service Console, Customer 360, tenant backup scope, and role-aware redaction.
- Updated the workspace Service Console with a role-aware Summarize action and compact grounded knowledge recommendation card.
- Added API tests proving accountant rejection, grounded service/case-message/knowledge/profile sources, review requirement, advisory-only semantics, no message/workflow/approval side effects, Service Console propagation, Customer 360 propagation, backup inclusion, and audit/event evidence.

## Implemented Slice 39: Advisory AI Workflow Builder Helper

Status: shipped in the local prototype on 2026-05-26.

- Added owner/admin AI workflow-builder suggestion evidence for governed Workflow Studio drafting without creating or enabling automation rules.
- Added `/api/ai/workflow-builder-suggestions` list/create endpoints with deterministic grounded-workflow-builder policy, suggested rule name, trigger, action, risk level, approval requirement, required apps, guardrails, suggested payload, test-event input, grounding sources, confidence score, advisory-only flag, review requirement, and checksum evidence.
- Workflow-builder suggestions are explicitly non-mutating: they do not create automation rules, change rule versions, create dry-runs, create test events, execute workflow runs, send messages, or create CRM/finance records.
- Suggestions are grounded in existing automation-rule governance, HayHashvapah overdue invoice evidence, app boundaries, and Workflow Studio dry-run/test-event/approval guardrails.
- Suggestion generation emits `ai.workflow_builder.suggested` suite events and audit records with trigger, action, risk level, approval requirement, advisory-only flag, grounding-source count, and checksum evidence.
- Connected generated suggestions into Service Console / Workflow Studio and tenant backup scope.
- Updated the workspace Workflow Studio with a role-aware Suggest rule action and compact advisory suggestion card.
- Added API tests proving support rejection, grounded automation/finance/governance/app-boundary sources, advisory-only semantics, no workflow-rule/dry-run/test-event/run side effects, Service Console propagation, backup inclusion, and audit/event evidence.

## Implemented Slice 40: Semantic Analytics Metric Catalog And Drilldowns

Status: shipped in the local prototype on 2026-05-27.

- Added an analytics semantic layer for Zoho One parity so KPI cards now carry explicit definitions, formulas, source apps, owner roles, refresh cadence, record counts, and drilldown URLs.
- Added `/api/analytics/semantic-metrics` and `/api/analytics/semantic-metrics/:id/drilldown` with analytics app access control.
- Implemented metric definitions for pipeline value, weighted forecast, campaign ROI, receivables aging, overdue exposure, ticket backlog, SLA risk, and Armenia VAT/SRC readiness.
- Added drilldown records that connect overdue exposure back to HayHashvapah invoice records and SLA risk back to Armosphera Desk cases.
- Connected the metric catalog into the existing `/api/analytics` payload for role-aware dashboards and reporting.
- Updated the workspace dashboard with a dense Metric Catalog panel using Armosphera CRM / HayHashvapah visual language.
- Added API tests proving support rejection, metric definitions, Armenian finance/localization source mapping, overdue invoice drilldown, SLA risk drilldown, unknown-metric handling, and analytics payload propagation.

## Implemented Slice 41: Semantic Analytics Time-Series Snapshots

Status: shipped in the local prototype on 2026-05-27.

- Added persisted analytics metric snapshots so semantic metrics can be captured as daily time-series evidence for owner and accountant reporting.
- Added `/api/analytics/semantic-snapshots` list/capture endpoints with analytics app access control and writer restrictions for Owner, Admin, and Accountant roles.
- Snapshot capture stores metric definition, formula, source apps, unit, value, record count, semantic layer version, report date, checksum, capture note, and capture user.
- Same-day snapshot capture is idempotent by metric/report date, refreshing values without duplicating rows.
- Snapshot listing returns both raw snapshot rows and grouped series points for dashboard charts and exportable reports.
- Snapshot capture emits `analytics.semantic_snapshot.captured` suite events and audit records.
- Added snapshots to tenant backup scope so analytics reporting evidence is restorable with the tenant.
- Updated the Metric Catalog dashboard with a role-aware Capture snapshot action and compact time-series strip.
- Added API tests proving support rejection, auditor write rejection, accountant capture, same-day idempotency, next-day series, analytics payload propagation, backup inclusion, and audit evidence.

## Implemented Slice 42: Exportable Owner And Accountant Analytics Reports

Status: shipped in the local prototype on 2026-05-27.

- Added persisted analytics report packets for owner operating reports and accountant export reports generated from semantic metric snapshots.
- Added `/api/analytics/reports` list/create/read endpoints with analytics app access control and role-aware visibility.
- Owner/Admin can generate owner and accountant packets; Accountant can generate accountant packets only; Auditor can read owner/accountant packets; non-report roles are blocked.
- Accountant reports export receivables aging, overdue exposure, and VAT/SRC readiness as CSV-ready packet content.
- Owner reports export the full semantic metric catalog as JSON-ready packet content.
- Report packets include period key, format, metric count, snapshot count, content type, file name, payload, export content, checksum, note, creator, and created timestamp.
- Report generation emits `analytics.report_packet.created` suite events and audit records.
- Added report packets to tenant backup scope so exported analytics evidence is restorable.
- Updated the Metric Catalog dashboard with role-aware owner/accountant report actions and recent report packet cards.
- Added API tests proving role rejection, accountant CSV export, owner JSON export, list visibility, analytics payload propagation, backup inclusion, and audit evidence.

## Implemented Slice 43: Role-Aware Analytics Dashboards

Status: shipped in the local prototype on 2026-05-27.

- Added `/api/analytics/role-dashboard` as a filtered operating lens for each Armenia SaaS role.
- Added role-specific dashboards for Owner, Admin, Accountant, Salesperson, Operator, Support, Service Manager, and Auditor.
- Owner/Admin dashboards prioritize operating metrics, report generation, overdue exposure, and SLA risk.
- Accountant dashboards prioritize receivables aging, overdue exposure, VAT/SRC readiness, snapshot capture, and accountant report export.
- Sales dashboards prioritize pipeline value, weighted forecast, campaign ROI, and CRM forecast actions.
- Support and Service Manager dashboards prioritize ticket backlog and SLA risk without exposing HayHashvapah finance context to Support.
- Auditor dashboards expose read-only report and checksum evidence without write permissions.
- Added role permission flags for analytics app access, snapshot capture, owner report creation, accountant report creation, report reading, finance app access, and sensitive finance visibility.
- Connected the role dashboard into the main analytics payload and workspace UI above the operating grid.
- Added API tests proving owner/accountant/sales/support/service-manager/auditor dashboard tailoring, support no-finance leakage, report visibility, action tailoring, and analytics payload propagation.

## Implemented Slice 44: Privileged MFA Login Guardrail

Status: shipped in the local prototype on 2026-05-27.

- Added TOTP MFA enrollment for privileged Owner and Admin users while rejecting non-privileged support enrollment attempts.
- Added a password login MFA challenge flow that blocks privileged session creation until the one-time code challenge is satisfied.
- Added `/api/security/mfa`, `/api/security/mfa/enroll`, `/api/security/mfa/verify-enrollment`, and `/api/login/mfa` endpoints.
- Stored MFA factors and login challenges with five-minute challenge expiry, active/pending factor states, and audit evidence for enrollment, challenge creation, failures, and verification.
- Preserved the secret boundary in tenant backup: MFA factor metadata is included for restore/audit visibility, while `secret_base32` is excluded and replaced with `secretExcluded=true`.
- Added the privileged workspace security panel for enrollment, manual authenticator setup key entry, verification, and active factor visibility.
- Added an MFA-aware login prompt so privileged users complete the code challenge before the suite workspace loads.
- Added API tests proving support rejection, enrollment setup, bad-code rejection, activation, password-only no-cookie challenge, challenge completion, support login bypass, backup sanitization, and audit evidence.

## Implemented Slice 45: Admin Session Inventory And Revocation

Status: shipped in the local prototype on 2026-05-27.

- Added governed session metadata for user agent, IP address, created/last-seen timestamps, MFA verification state, and administrative revocation state.
- Added `/api/admin/sessions` for Owner/Admin/Auditor token-safe session inventory with active, privileged, MFA-verified, stale, revoked, and expired summary counts.
- Added `/api/admin/sessions/:id/revoke` for Owner/Admin session revocation using public hashed session identifiers instead of raw session tokens.
- Blocked revoked sessions in the authentication path so revoked cookies can no longer load the suite workspace.
- Added risk signals for privileged active sessions without MFA and sessions missing device context.
- Added audit evidence for administrative revocation with target user, public session identifier, reason, and current-session flag.
- Updated the workspace identity panel with active session cards, risk signals, MFA state, and revoke actions for non-current active sessions.
- Added API tests proving support rejection, auditor read-only access, token non-disclosure, owner revocation, revoked-cookie rejection, owner continuity, summary updates, and audit evidence.

## Implemented Slice 46: Tamper-Evident Audit Export Packets

Status: shipped in the local prototype on 2026-05-27.

- Added persisted audit export packets for owner/admin-created and auditor-readable compliance evidence.
- Added `/api/admin/audit-exports` list/create endpoints and `/api/admin/audit-exports/:id` detail access.
- Export packets include organization context, period boundaries, event count, first/last audit event ids, export checksum, chain head, controls, sanitized audit events, and a SHA-256 forward hash chain.
- Audit event details are recursively sanitized for password, secret, token, cookie, and authorization keys before export.
- Added audit export packets to tenant backup scope so compliance evidence is included in restore-ready tenant packets.
- Added `admin.audit_export.created` audit evidence with export id, event count, first/last ids, checksum, and chain head.
- Updated the workspace admin area with an Audit integrity panel showing event count, checksum prefix, chain head, and role-aware Create export action.
- Added API tests proving support rejection, auditor read-only access, owner creation, chain verification, checksum verification, token non-disclosure, auditor detail read, backup inclusion, and audit evidence.

## Implemented Slice 47: Integration Hub Connector Contracts

Status: shipped in the local prototype on 2026-05-27.

- Added Integration Hub connector contracts for Gmail, Google Calendar, Google Drive, WhatsApp Business, Telegram Bot, e-signature providers, HayHashvapah finance sync, and migration import.
- Added `/api/integrations/connectors`, `/api/integrations/connectors/:key/configure`, and `/api/integrations/connectors/:key/health-check`.
- Connector contracts define provider, category, auth type, required scopes, capabilities, owner role, data boundary, and rebuild policy so commodity products remain external integrations.
- Owner/Admin can configure and health-check connectors; Auditor can read connector evidence; non-admin operational roles are rejected.
- Connector secrets are never returned by API or backups; only SHA-256 fingerprints and `secretExcluded=true` are exposed.
- Health checks produce ready/blocked evidence from endpoint URL, secret boundary, connected status, provider boundary, and missing required scopes.
- Added connector configuration and readiness checks to tenant backup scope.
- Updated the workspace with an Integration Hub panel showing connector counts, connected/ready state, provider contracts, and role-aware WhatsApp sandbox configuration.
- Added API tests proving support rejection, default connector catalog, WhatsApp configuration, token non-disclosure, ready health checks, blocked missing-scope checks, auditor read-only access, backup inclusion, and audit evidence.

## Implemented Slice 48: Clinic/Wellness Pilot Template

Status: shipped in the local prototype on 2026-05-27.

- Added the first vertical pilot template for Armenian clinic, dental, beauty, and wellness operators.
- Added `/api/pilots/templates/clinic-wellness` and `/api/pilots/templates/clinic-wellness/install`.
- The template packages Armosphera CRM, Desk, Flow, Analytics, Docs, HayHashvapah Finance, WhatsApp/Telegram intake, calendar/document connectors, e-signature, and migration import boundaries.
- Added Armenia-localized package pricing in AMD for patient retention automation, booking/inbox setup, and receivables/HayHashvapah handoff.
- Added template controls for ՀՎՀՀ/TIN capture, 20% VAT review, Armenian personal-data handling, SRC/File Online readiness, and HayHashvapah period-lock/accountant review.
- Pilot installs are idempotent per customer/package selection and include rollout shape for five paid pilots, setup fee, monthly ops/SaaS fee, optional performance fee, readiness gaps, checksum, and customer context.
- Added pilot install evidence to tenant backup scope and `pilot.template.installed` suite/audit events.
- Updated the workspace with a Pilot template panel showing package fees, connector count, install action, readiness gaps, and checksum evidence.
- Added API tests proving support rejection, template content, package totals, HayHashvapah handoff, idempotent install, auditor visibility, backup inclusion, and audit evidence.

## Implemented Slice 49: Clinic Pilot Owner Operating Brief

Status: shipped in the local prototype on 2026-05-27.

- Added owner operating brief packets for the clinic/wellness pilot, generated from installed template evidence.
- Added `/api/pilots/clinic-wellness/owner-briefs` list/create endpoints with pilot-template role gates: Owner/Admin/Salesperson can create; Auditor and operational readers can view metadata; Support is rejected.
- Each brief answers the five pilot owner acceptance questions: who owes money, which leads are stuck, which tickets are late, which campaigns produced paying clients, and what tax/accounting actions need review.
- Brief payloads merge HayHashvapah receivables, CRM lead backlog, service SLA state, campaign-to-paid-revenue attribution, Armenian VAT/SRC legal-source readiness, and accounting period-lock review evidence.
- Brief generation is idempotent per installed pilot and report date, producing a checksum-bound JSON payload and metadata-only list view.
- Added owner brief packets to tenant backup scope and `pilot.owner_brief.created` suite/audit events.
- Updated the workspace with a Pilot owner brief panel showing answer counts, next actions, readiness gaps, status, report date, and checksum evidence.
- Added API tests proving support rejection, owner creation, all five answer categories, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 50: Clinic Pilot Operator Workbench

Status: shipped in the local prototype on 2026-05-27.

- Added operator workbench packets generated from clinic/wellness owner operating briefs.
- Added `/api/pilots/clinic-wellness/operator-workbenches` list/create endpoints with support rejection and role-aware operator, salesperson, service manager, accountant, owner/admin, and auditor access.
- Workbenches convert the owner brief into five frontline lanes: receivables follow-up, stuck lead conversion, SLA rescue, campaign revenue loop, and tax/accounting review.
- Each action carries owner role, priority, source record, next step, review requirement, suggested channel, and HayHashvapah invoice context where money is involved.
- Workbench generation is idempotent per owner brief and produces checksum-bound payloads with metadata-only list visibility.
- Added operator workbench packets to tenant backup scope and `pilot.operator_workbench.created` suite/audit events.
- Updated the workspace with a Pilot operator workbench panel showing action count, high-priority count, review-required count, action lanes, checklist, and checksum evidence.
- Added API tests proving support rejection, operator creation, all five lane mappings, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 51: Clinic Pilot Accountant Review Queue

Status: shipped in the local prototype on 2026-05-27.

- Added accountant review queue packets generated from clinic/wellness operator workbenches.
- Added `/api/pilots/clinic-wellness/accountant-reviews` list/create endpoints with Owner/Admin/Accountant create access, Auditor metadata visibility, and support/operator rejection for accountant-only evidence.
- Review queues convert workbench compliance and receivable actions into VAT/SRC, period-lock, overdue receivable wording, and HayHashvapah invoice review items.
- Each item carries category, status, owner role, review requirement, due date, legal source, period key, invoice number, AMD amount, VAT amount, and source evidence where applicable.
- Review queues compute item count, open review count, VAT item count, period item count, and overdue money at risk in AMD.
- Queue creation is idempotent per operator workbench and produces checksum-bound payloads with metadata-only list visibility.
- Added accountant review packets to tenant backup scope and `pilot.accountant_review.created` suite/audit events.
- Updated the workspace with a Pilot accountant review panel showing open review count, item count, money at risk, review cards, checklist, and checksum evidence.
- Added API tests proving support rejection, accountant creation, VAT source mapping, period-lock mapping, receivable VAT check mapping, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 52: Clinic Pilot Launch Readiness Gate

Status: shipped in the local prototype on 2026-05-27.

- Added launch readiness packets generated from the completed clinic/wellness pilot evidence chain.
- Added `/api/pilots/clinic-wellness/launch-readiness` list/create endpoints with Owner/Admin create access, role-aware operational read access, Auditor metadata visibility, and Support rejection.
- Readiness packets consolidate template install, owner brief, operator workbench, accountant review queue, connector gaps, commercial pricing, and overdue money-at-risk into one go-live decision.
- Launch gates cover pilot evidence chain, commercial package, operator workbench, accountant review, integration readiness, and overdue money at risk.
- Packets compute gate count, blocked gate count, blocker count, money at risk, commercial setup fee, monthly ops fee, and target launch date.
- The current seeded pilot correctly blocks go-live until accountant VAT/SRC and period-lock items, connector gaps, and overdue receivable risk are resolved.
- Packet creation is idempotent per accountant review and target launch date and produces checksum-bound payloads with metadata-only list visibility.
- Added launch readiness packets to tenant backup scope and `pilot.launch_readiness.created` suite/audit events.
- Updated the workspace with a Pilot launch gate panel showing blocked/ready status, blocker count, money at risk, gate cards, next actions, and checksum evidence.
- Added API tests proving support rejection, owner creation, commercial pricing propagation, blocked gate calculation, connector blockers, accountant blockers, money-at-risk blockers, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 53: Clinic Pilot Launch Remediation Plan

Status: shipped in the local prototype on 2026-05-27.

- Added launch remediation plans generated from blocked clinic/wellness launch readiness packets.
- Added `/api/pilots/clinic-wellness/launch-remediation-plans` list/create endpoints with Owner/Admin create access, operational read access, Auditor metadata visibility, and Support rejection.
- Remediation plans convert launch blockers into assigned actions for accountant review, connector setup, overdue receivable risk, and commercial package completion where needed.
- Each action carries owner role, source gate, priority, status, due date, next step, connector key, open review count, or money-at-risk evidence as applicable.
- Plans compute action count, high-priority count, blocker count, owner-role coverage, and AMD money at risk.
- Plan creation is idempotent per launch readiness packet and produces checksum-bound payloads with metadata-only list visibility.
- Added remediation plans to tenant backup scope and `pilot.launch_remediation.created` suite/audit events.
- Updated the workspace with a Pilot remediation panel showing open action count, high-priority count, money at risk, assigned actions, checklist, and checksum evidence.
- Added API tests proving support rejection, owner creation, accountant/Admin/operator action mapping, connector remediation mapping, money-at-risk remediation, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 54: Clinic Pilot Remediation Action Resolution

Status: shipped in the local prototype on 2026-05-27.

- Added remediation action resolution packets so assigned roles can close launch remediation actions with evidence.
- Added `/api/pilots/clinic-wellness/remediation-resolutions` list and `/api/pilots/clinic-wellness/remediation-actions/:actionKey/resolve` create endpoints with operational read access, Support rejection, and action-owner write enforcement.
- Owner/Admin can resolve any remediation action, while Accountant and Operator can resolve only the actions assigned to their roles.
- Resolution packets capture the action snapshot, evidence type, evidence text, resolver identity, target launch date, current progress, and checksum-bound payload.
- Resolution creation is idempotent per remediation plan and action key.
- Added remediation action resolutions to tenant backup scope and `pilot.remediation_action.resolved` suite/audit events.
- Updated the workspace remediation panel with resolved/remaining progress, latest resolution checksum evidence, and role-aware Resolve buttons for open actions.
- Added API tests proving support rejection, cross-role denial, accountant/operator resolution, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 55: Clinic Pilot Launch Clearance Packet

Status: shipped in the local prototype on 2026-05-27.

- Added launch clearance packets generated from remediation plans and their action-resolution evidence.
- Added `/api/pilots/clinic-wellness/launch-clearance` list/create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support rejection.
- Clearance packets remain blocked until every remediation action has a checksum-bound resolution packet.
- Once all remediation actions are resolved, clearance packets mark go-live allowed and return a `ready-for-paid-pilot` decision.
- Clearance packets capture resolved actions, unresolved actions, resolution checksums, action counts, completion percent, money at risk, controls, checklist, and owner note.
- Clearance creation is idempotent for the same remediation plan and resolution chain while allowing a later cleared packet after a previously blocked check.
- Added clearance packets to tenant backup scope and `pilot.launch_clearance.created` suite/audit events.
- Updated the workspace with a Pilot clearance panel showing go-live decision, completion, open/resolved actions, controls, and checksum evidence.
- Added API tests proving support rejection, blocked pre-resolution clearance, all-action resolution, cleared go-live decision, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 56: Clinic Pilot Paid Offer Packet

Status: shipped in the local prototype on 2026-05-27.

- Added paid pilot offer packets generated only from cleared clinic/wellness launch clearance packets.
- Added `/api/pilots/clinic-wellness/paid-offers` list/create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Paid offers are blocked when the source clearance packet is not cleared, so sales cannot issue customer-facing terms before go-live evidence is complete.
- Offer payloads include customer context, clearance checksum evidence, AMD pricing, 20% VAT, first-month subtotal/VAT/total, pilot count, valid-until date, commercial handoffs, and governance controls.
- Paid offer creation is idempotent per clearance packet and produces checksum-bound payloads with metadata-only list visibility.
- Added paid offer packets to tenant backup scope and `pilot.paid_offer.created` suite/audit events.
- Updated the workspace with a Paid pilot offer panel showing first-month total, setup/monthly fees, VAT metrics, handoff chips, and checksum evidence.
- Added API tests proving blocked-clearance rejection, support rejection, sales creation, Armenia VAT pricing, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 57: Clinic Pilot Offer To CRM Quote Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added quote handoff packets that convert a ready paid pilot offer into a draft CRM quote and governed quote-release approval.
- Added `/api/pilots/clinic-wellness/quote-handoffs` list and `/api/pilots/clinic-wellness/paid-offers/:offerId/quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- The handoff creates VAT-inclusive CRM quote lines from the offer’s setup fee and monthly operations fee, preserving the AMD subtotal, 20% VAT, and first-month total.
- Generated quotes remain hidden from public quote links until the existing `crm.quote.release` approval is approved and executed.
- Handoff creation is idempotent per paid offer and records the paid offer checksum, quote id, approval id, deal id, commercial totals, and governance controls.
- Added handoff packets to tenant backup scope and `pilot.offer_quote_handoff.created` suite/audit events.
- Updated the workspace with a Quote handoff panel showing quote, approval, deal, status, total, controls, and checksum evidence.
- Added API tests proving support rejection, draft quote generation, release approval creation, hidden public quote before approval, idempotency, auditor metadata visibility, backup inclusion, checksum verification, and audit evidence.

## Implemented Slice 58: Clinic Pilot Quote Release Evidence Packet

Status: shipped in the local prototype on 2026-05-27.

- Added quote release evidence packets that can be recorded only after the owner-approved `crm.quote.release` workflow executes and the quote is publicly available.
- Added `/api/pilots/clinic-wellness/quote-releases` list and `/api/pilots/clinic-wellness/quote-handoffs/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Release packets link the quote handoff checksum, offer id, quote id, approval id, customer, deal, public quote URL metadata, sent timestamp, AMD total, and release controls.
- Creation is idempotent per handoff/quote/sent timestamp and is blocked before quote release workflow execution.
- Added release packets to tenant backup scope and `pilot.quote_release.created` suite/audit events.
- Updated the workspace with a Quote release panel showing public quote status, quote, approval, handoff, controls, and checksum evidence.
- Added API tests proving support rejection, pre-release blocking, owner approval/execution, public quote visibility, packet checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 59: Clinic Pilot Accepted Quote To HayHashvapah Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added quote acceptance handoff packets that connect a customer-accepted public quote to the governed HayHashvapah draft-invoice approval.
- Added `/api/pilots/clinic-wellness/quote-acceptance-handoffs` list and `/api/pilots/clinic-wellness/quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Handoff creation is blocked until the released public quote is accepted and the existing `finance.invoice.propose` approval exists.
- Packets link the quote release checksum, quote handoff, paid offer, acceptance evidence, deal-won state, Armenia VAT mode, finance approval id, period key, due days, signer, AMD total, and HayHashvapah controls.
- Creation is idempotent per release packet, quote acceptance, and finance approval.
- Added acceptance handoff packets to tenant backup scope and `pilot.quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with an Acceptance handoff panel showing signer, period, VAT mode, approval id, controls, and checksum evidence.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, deal-won transition, finance approval generation, packet checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 60: Clinic Pilot HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-27.

- Added HayHashvapah draft invoice packets that can be recorded only after the owner executes the accepted-quote `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/quote-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Corrected accepted-quote draft invoice creation so HayHashvapah drafts use the accepted quote total instead of stale deal value when the workflow approval carries a quote id.
- Packets link the acceptance handoff checksum, quote release, quote handoff, paid offer, acceptance, finance approval, workflow run, HayHashvapah draft invoice, Armenia VAT breakdown, period key, and posting-readiness controls.
- Creation is idempotent per acceptance handoff, workflow run, and draft invoice.
- Added draft invoice packets to tenant backup scope and `pilot.hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a HayHashvapah draft panel showing draft number, period, VAT/subtotal/total, workflow run, controls, and checksum evidence.
- Added API tests proving support rejection, pre-execution blocking, owner approval/execution, quote-total invoice math, packet checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 61: Clinic Pilot Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-27.

- Added official HayHashvapah invoice posting packets that can be recorded only after the existing draft invoice is posted into an open receivable.
- Added `/api/pilots/clinic-wellness/official-invoices` list and `/api/pilots/clinic-wellness/hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Posting packets link the draft packet checksum, accepted quote chain, draft invoice, official invoice, finance invoice link, Armenian VAT/period metadata, and collection-readiness controls.
- Creation is idempotent per draft packet, finance invoice link, and official invoice.
- Added posting packets to tenant backup scope and `pilot.hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with an Official invoice panel showing receivable number, VAT, period, link id, controls, and checksum evidence.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, accepted quote total preservation, packet checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 62: Clinic Pilot HayHashvapah Payment Collection Packet

Status: shipped in the local prototype on 2026-05-27.

- Added payment collection packets that can be recorded only after the official HayHashvapah invoice is fully paid through the existing payment receipt flow.
- Added `/api/pilots/clinic-wellness/payment-collections` list and `/api/pilots/clinic-wellness/official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Collection packets link the official invoice posting checksum, accepted quote chain, official invoice, finance invoice link, payment receipt, Armenian VAT/period metadata, and pilot closeout-readiness controls.
- Creation is idempotent per posting packet, payment receipt, and official invoice.
- Added payment collection packets to tenant backup scope and `pilot.hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Payment collection panel showing receipt reference, collected amount, VAT, paid date, invoice number, controls, and checksum evidence.
- Added API tests proving support rejection, pre-payment blocking, official payment receipt recording, paid invoice status, packet checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 63: Clinic Pilot Closeout And Renewal Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added pilot closeout packets that can be created only after HayHashvapah payment collection evidence exists for the paid pilot.
- Added `/api/pilots/clinic-wellness/closeouts` list and `/api/pilots/clinic-wellness/payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support rejection.
- Closeout creation creates an idempotent CRM renewal task for the salesperson, linking the paid pilot, customer, deal, payment receipt, invoice, and next renewal due date.
- Closeout packets link the payment collection checksum, accepted quote chain, paid invoice, HayHashvapah payment receipt, CRM renewal task, closeout date, AMD amount, and owner renewal controls.
- Added closeout packets to tenant backup scope and `pilot.closeout.created` suite/audit events.
- Updated the workspace with a Pilot closeout panel showing closeout status, collected amount, renewal due date, CRM task id, controls, and checksum evidence.
- Added API tests proving support rejection, owner creation, CRM renewal task creation, checksum verification, idempotency, auditor metadata visibility, Customer 360 task visibility, backup inclusion, and audit evidence.

## Implemented Slice 64: Clinic Pilot Renewal Quote Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added pilot renewal quote handoff packets that convert a closed paid pilot into a monthly CRM renewal quote with a governed quote-release approval.
- Added `/api/pilots/clinic-wellness/renewal-quotes` list and `/api/pilots/clinic-wellness/closeouts/:closeoutPacketId/renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Renewal quote handoffs link the closeout checksum, HayHashvapah payment collection, CRM renewal task, customer, deal, draft quote, approval id, AMD subtotal, 20% VAT, total, valid-until date, and release controls.
- Draft public renewal quotes remain hidden until the existing `crm.quote.release` approval is executed.
- Added renewal quote handoff packets to tenant backup scope and `pilot.renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Renewal quote panel showing quote total, approval id, release status, VAT, subtotal, controls, and checksum evidence.
- Added API tests proving support rejection, Salesperson creation, checksum verification, public quote hiding before approval, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 65: Clinic Pilot Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-27.

- Added pilot renewal quote release packets that can be recorded only after the owner-approved `crm.quote.release` workflow execution makes the renewal quote public.
- Added `/api/pilots/clinic-wellness/renewal-quote-releases` list and `/api/pilots/clinic-wellness/renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Renewal release packets link the renewal handoff checksum, closeout checksum, CRM renewal task, public quote token, approval id, AMD subtotal, 20% VAT, total, and public-link controls.
- Added renewal release packets to tenant backup scope and `pilot.renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Renewal release panel showing public visibility, quote id, approval id, handoff id, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 66: Clinic Renewal Acceptance To HayHashvapah Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added renewal acceptance handoff packets that can be recorded only after the customer accepts the released monthly renewal quote.
- Added `/api/pilots/clinic-wellness/renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Renewal acceptance handoffs link the renewal release checksum, renewal quote handoff checksum, paid pilot closeout checksum, CRM renewal task, accepted quote, signer, finance invoice approval, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added renewal acceptance handoff packets to tenant backup scope and `pilot.renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Renewal acceptance panel showing accepted renewal total, finance approval id, accounting period, VAT mode, renewal task id, controls, and checksum/status evidence.
- Added API tests proving support rejection, pre-acceptance blocking, public renewal acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 67: Clinic Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-27.

- Added renewal HayHashvapah draft invoice packets that can be recorded only after the owner executes the accepted renewal quote's `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Renewal draft packets link the renewal acceptance checksum, renewal quote release, renewal quote handoff, paid pilot closeout, CRM renewal task, finance workflow run, HayHashvapah draft invoice, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added renewal HayHashvapah draft invoice packets to tenant backup scope and `pilot.renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Renewal draft panel showing draft number, workflow run, period, VAT, subtotal, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-execution blocking, owner approval execution, HayHashvapah draft invoice linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 68: Clinic Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-27.

- Added renewal official HayHashvapah invoice posting packets that can be recorded only after the renewal draft invoice is posted to an official receivable.
- Added `/api/pilots/clinic-wellness/renewal-official-invoices` list and `/api/pilots/clinic-wellness/renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Renewal posting packets link the renewal draft checksum, renewal acceptance handoff, renewal quote release, renewal quote handoff, paid pilot closeout, previous pilot posting packet, CRM renewal task, official invoice, finance invoice link, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added renewal official HayHashvapah invoice posting packets to tenant backup scope and `pilot.renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Renewal receivable panel showing invoice number, finance link, period, VAT, invoice id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, accepted renewal quote total preservation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 69: Clinic Renewal Payment Collection Packet

Status: shipped in the local prototype on 2026-05-27.

- Added renewal payment collection packets that can be recorded only after the renewal official HayHashvapah invoice is fully paid through the finance payment receipt flow.
- Added `/api/pilots/clinic-wellness/renewal-payment-collections` list and `/api/pilots/clinic-wellness/renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Renewal payment packets link the renewal official posting checksum, renewal draft packet, renewal acceptance handoff, renewal quote release, renewal quote handoff, paid pilot closeout, prior pilot payment collection, prior official posting, CRM renewal task, paid invoice, payment receipt, Armenian VAT mode, accounting period, AMD subtotal, VAT, and paid amount.
- Added renewal payment collection packets to tenant backup scope and `pilot.renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Renewal payment panel showing payment reference, invoice number, payment date, VAT, payment id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-payment blocking, finance receipt linkage, full-payment preservation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 70: Clinic Renewal Cycle Closeout Packet

Status: shipped in the local prototype on 2026-05-27.

- Added renewal cycle closeout packets that can be created only after renewal payment collection evidence exists for the paid monthly renewal invoice.
- Added `/api/pilots/clinic-wellness/renewal-closeouts` list and `/api/pilots/clinic-wellness/renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support rejection.
- Renewal closeout creation creates an idempotent next-cycle CRM renewal task for the salesperson, linking the renewal payment collection, paid renewal invoice, customer, deal, prior closeout, and next renewal due date.
- Renewal closeout packets link the renewal payment collection checksum, renewal official posting, renewal draft packet, renewal acceptance handoff, renewal quote release, renewal quote handoff, prior pilot closeout, prior payment collection, paid invoice, payment receipt, current CRM renewal task, next CRM renewal task, closeout date, AMD amount, and next-cycle controls.
- Added renewal closeout packets to tenant backup scope and `pilot.renewal_closeout.created` suite/audit events.
- Updated the workspace with a Renewal closeout panel showing closeout status, collected amount, closeout date, next renewal due date, next CRM task id, controls, and checksum evidence.
- Added API tests proving support rejection, next CRM renewal task creation, checksum verification, idempotency, auditor metadata visibility, Customer 360 task propagation, backup inclusion, and audit evidence.

## Implemented Slice 71: Clinic Next Renewal Quote Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added next renewal quote handoff packets that can be created only after a paid renewal cycle is closed and the next-cycle CRM task exists.
- Added `/api/pilots/clinic-wellness/next-renewal-quotes` list and `/api/pilots/clinic-wellness/renewal-closeouts/:renewalCloseoutPacketId/next-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Next renewal quote handoffs create a draft AMD quote for the next monthly renewal, require a governed `crm.quote.release` approval, and keep the public quote hidden until approval execution.
- Next renewal quote packets link the renewal closeout checksum, renewal payment collection, renewal posting, renewal draft, renewal acceptance, previous renewal quote release, previous renewal quote handoff, prior paid pilot closeout, prior payment collection, current renewal task, next renewal task, quote, approval, AMD subtotal, 20% VAT, total, and release controls.
- Added next renewal quote handoff packets to tenant backup scope and `pilot.next_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Next renewal quote panel showing next-cycle amount, valid-until date, VAT, approval id, next renewal task id, controls, and status evidence.
- Added API tests proving support rejection, quote and approval creation, public quote hiding, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 72: Clinic Next Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-27.

- Added next renewal quote release packets that can be created only after the owner executes the next renewal quote's governed `crm.quote.release` approval.
- Added `/api/pilots/clinic-wellness/next-renewal-quote-releases` list and `/api/pilots/clinic-wellness/next-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Next renewal release packets prove that the public customer quote link is visible only after approval execution and preserve the next-renewal quote's AMD subtotal, 20% VAT, total, public token, and acceptance URL.
- Next renewal release packets link the next renewal quote handoff checksum, renewal closeout checksum, renewal payment collection, renewal posting, renewal draft, renewal acceptance, previous renewal quote release, previous renewal quote handoff, prior paid pilot closeout, prior payment collection, current renewal task, next renewal task, quote, and approval.
- Added next renewal quote release packets to tenant backup scope and `pilot.next_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Next renewal release panel showing public visibility, quote id, approval id, next renewal task id, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 73: Clinic Next Renewal Acceptance To HayHashvapah Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added next renewal acceptance handoff packets that can be created only after the customer accepts the released next monthly renewal quote.
- Added `/api/pilots/clinic-wellness/next-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/next-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next renewal acceptance handoffs link the next renewal release checksum, next renewal quote handoff checksum, renewal closeout checksum, previous renewal release/handoff, prior paid pilot closeout, current renewal task, next renewal task, accepted quote, signer, finance invoice approval, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added next renewal acceptance handoff packets to tenant backup scope and `pilot.next_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Next renewal acceptance panel showing accepted quote total, finance approval id, period, VAT mode, next renewal task id, controls, and status evidence.
- Added API tests proving support rejection, pre-acceptance blocking, public next-renewal acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 74: Clinic Next Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-27.

- Added next renewal HayHashvapah draft invoice packets that can be created only after the owner opens the target accounting period and executes the accepted next-renewal quote's governed finance approval.
- Added `/api/pilots/clinic-wellness/next-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/next-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Seeded the upcoming 2026-06 accounting period as locked until owner reopening, preserving Armenian period-lock governance before the next monthly renewal draft can be created.
- Next renewal draft packets link the next renewal acceptance checksum, release checksum, quote handoff checksum, renewal closeout checksum, previous renewal artifacts, current renewal task, next renewal task, accepted quote, finance approval, workflow run, HayHashvapah draft invoice, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added next renewal HayHashvapah draft invoice packets to tenant backup scope and `pilot.next_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Next renewal draft panel showing draft total, draft number, workflow run id, period, VAT, subtotal, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-execution blocking, period reopening, finance workflow execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 75: Clinic Next Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-27.

- Added next renewal official HayHashvapah invoice posting packets that can be recorded only after the next-renewal draft invoice is posted to an official receivable in an open accounting period.
- Added `/api/pilots/clinic-wellness/next-renewal-official-invoices` list and `/api/pilots/clinic-wellness/next-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next renewal posting packets link the next renewal draft checksum, next renewal acceptance handoff, next renewal quote release, next renewal quote handoff, renewal closeout, previous renewal posting/draft/release/handoff, prior paid pilot posting/payment, current renewal task, next renewal task, official invoice, finance invoice link, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added next renewal official HayHashvapah invoice posting packets to tenant backup scope and `pilot.next_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Next renewal receivable panel showing invoice number, finance link id, period, VAT, invoice id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-posting blocking, official receivable posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 76: Clinic Next Renewal HayHashvapah Payment Collection Packet

Status: shipped in the local prototype on 2026-05-27.

- Added next renewal payment collection packets that can be recorded only after the next-renewal official HayHashvapah invoice is fully paid through the finance receipt flow.
- Added `/api/pilots/clinic-wellness/next-renewal-payment-collections` list and `/api/pilots/clinic-wellness/next-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next renewal payment packets link the next renewal official posting checksum, draft, acceptance handoff, quote release, quote handoff, renewal closeout, previous renewal artifacts, prior paid pilot posting/payment, current renewal task, next renewal task, paid invoice, payment receipt, Armenian VAT mode, accounting period, AMD subtotal, VAT, and amount.
- Added next renewal payment collection packets to tenant backup scope and `pilot.next_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Next renewal payment panel showing payment reference, invoice number, payment date, VAT, payment id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-payment blocking, finance receipt linkage, full-payment preservation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 77: Clinic Next Renewal Cycle Closeout Packet

Status: shipped in the local prototype on 2026-05-27.

- Added next renewal cycle closeout packets that can be created only after next-renewal payment collection evidence exists for the paid monthly invoice.
- Added `/api/pilots/clinic-wellness/next-renewal-closeouts` list and `/api/pilots/clinic-wellness/next-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support rejection.
- Next renewal closeout creates an idempotent following-cycle CRM renewal task for sales while preserving the current next-renewal task as lineage.
- Next renewal closeout packets link the next renewal payment collection checksum, official posting, draft packet, acceptance handoff, quote release, quote handoff, prior renewal closeout, previous renewal artifacts, prior paid pilot artifacts, paid invoice, payment receipt, current renewal task, next renewal task, following renewal task, closeout date, AMD amount, and controls.
- Added next renewal closeout packets to tenant backup scope and `pilot.next_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Next renewal closeout panel showing closeout status, collected amount, closeout date, following due date, following CRM task id, controls, and checksum evidence.
- Added API tests proving support rejection, following CRM renewal task creation, checksum verification, idempotency, auditor metadata visibility, Customer 360 task propagation, backup inclusion, and audit evidence.

## Implemented Slice 78: Clinic Following Renewal Quote Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added following renewal quote handoff packets that can be created only after the paid next-renewal cycle is closed and the following-cycle CRM task exists.
- Added `/api/pilots/clinic-wellness/following-renewal-quotes` list and `/api/pilots/clinic-wellness/next-renewal-closeouts/:nextRenewalCloseoutPacketId/following-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Following renewal quote handoffs create a draft AMD quote for the next monthly cycle after the next-renewal closeout, require governed `crm.quote.release` approval, and keep the public quote hidden until approval execution.
- Following renewal quote packets link the next renewal closeout checksum, next renewal payment collection, official posting, draft, acceptance handoff, quote release, quote handoff, prior renewal artifacts, prior paid pilot artifacts, current renewal task, next renewal task, following renewal task, quote, approval, AMD subtotal, 20% VAT, total, and release controls.
- Added following renewal quote handoff packets to tenant backup scope and `pilot.following_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Following renewal quote panel showing following-cycle amount, valid-until date, VAT, approval id, following renewal task id, controls, and status evidence.
- Added API tests proving support rejection, quote and approval creation, public quote hiding, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 79: Clinic Following Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-27.

- Added following renewal quote release packets that can be created only after the owner executes the following renewal quote's governed `crm.quote.release` approval.
- Added `/api/pilots/clinic-wellness/following-renewal-quote-releases` list and `/api/pilots/clinic-wellness/following-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Following renewal release packets prove that the public customer quote link is visible only after approval execution and preserve the following-renewal quote's AMD subtotal, 20% VAT, total, public token, and acceptance URL.
- Following renewal release packets link the following quote handoff checksum, next renewal closeout checksum, next renewal payment/posting/draft/acceptance/release lineage, previous renewal lineage, prior paid pilot lineage, current renewal task, next renewal task, following renewal task, quote, and approval.
- Added following renewal quote release packets to tenant backup scope and `pilot.following_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Following release panel showing public quote status, quote, approval, following renewal task, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 80: Clinic Following Renewal Acceptance Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added following renewal acceptance handoff packets that can be created only after the customer accepts the released following monthly renewal quote.
- Added `/api/pilots/clinic-wellness/following-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/following-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following renewal acceptance handoffs link the following release checksum, following quote handoff checksum, next renewal closeout checksum, next renewal payment/posting/draft/acceptance/release lineage, previous renewal lineage, prior paid pilot lineage, current renewal task, next renewal task, following renewal task, accepted quote, signer, finance invoice approval, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added following renewal acceptance handoff packets to tenant backup scope and `pilot.following_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Following acceptance panel showing accepted quote amount, period, VAT mode, finance approval id, following renewal task id, controls, and status evidence.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, finance approval generation, packet checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 81: Clinic Following Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-27.

- Added following renewal HayHashvapah draft invoice packets that can be created only after the owner executes the accepted following-renewal quote's finance invoice approval.
- Added `/api/pilots/clinic-wellness/following-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/following-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following renewal draft packets link the accepted handoff checksum, following release and quote handoff checksums, next renewal closeout lineage, prior renewal and paid pilot artifacts, current renewal task, next renewal task, following renewal task, accepted quote, finance approval, workflow run, draft invoice, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added following renewal HayHashvapah draft packets to tenant backup scope and `pilot.following_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Following draft panel showing draft invoice number, workflow run, accounting period, VAT, subtotal, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, period reopening, finance workflow execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 82: Clinic Following Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-27.

- Added following renewal official HayHashvapah invoice posting packets that can be created only after the following-renewal draft invoice is posted into the official receivables ledger.
- Added `/api/pilots/clinic-wellness/following-renewal-official-invoices` list and `/api/pilots/clinic-wellness/following-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following renewal official invoice packets link the following draft checksum, accepted following quote handoff, following release and quote handoff, next-renewal closeout lineage, prior next-renewal and renewal artifacts, prior paid pilot artifacts, CRM renewal tasks, posted draft invoice, official invoice, finance invoice link, Armenian VAT mode, accounting period, AMD subtotal, VAT, and total.
- Added following renewal official invoice posting packets to tenant backup scope and `pilot.following_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Following receivable panel showing invoice number, finance link, accounting period, VAT, invoice id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 83: Clinic Following Renewal Payment Collection Packet

Status: shipped in the local prototype on 2026-05-27.

- Added following renewal HayHashvapah payment collection packets that can be created only after the following-renewal official invoice is fully paid.
- Added `/api/pilots/clinic-wellness/following-renewal-payment-collections` list and `/api/pilots/clinic-wellness/following-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following renewal payment packets link the following official posting checksum, draft packet, accepted following quote handoff, following release and quote handoff, next-renewal closeout lineage, prior next-renewal and renewal artifacts, prior paid pilot artifacts, CRM renewal tasks, official invoice, finance payment, Armenian VAT mode, accounting period, AMD VAT, and collected amount.
- Added following renewal payment collection packets to tenant backup scope and `pilot.following_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Following payment panel showing receipt reference, invoice number, payment date, VAT, payment id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-payment blocking, finance receipt linkage, full-payment preservation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 84: Clinic Following Renewal Cycle Closeout Packet

Status: shipped in the local prototype on 2026-05-27.

- Added following renewal cycle closeout packets that can be created only after following-renewal HayHashvapah payment collection evidence exists for the paid monthly invoice.
- Added `/api/pilots/clinic-wellness/following-renewal-closeouts` list and `/api/pilots/clinic-wellness/following-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Following renewal closeout creates an idempotent subsequent-renewal CRM task for sales while preserving renewal, next-renewal, and following-renewal task lineage.
- Following renewal closeout packets link the following payment collection checksum, official posting, draft packet, acceptance handoff, quote release, quote handoff, next-renewal closeout lineage, prior renewal and paid pilot artifacts, paid invoice, payment receipt, Armenian VAT mode, accounting period, AMD amount, closeout date, subsequent due date, and controls.
- Added following renewal closeout packets to tenant backup scope and `pilot.following_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Following closeout panel showing status, collected amount, closeout date, subsequent due date, subsequent CRM task id, controls, and checksum evidence.
- Added API tests proving support/accountant rejection, subsequent CRM renewal task creation, checksum verification, idempotency, auditor metadata visibility, Customer 360 task propagation, backup inclusion, and audit evidence.

## Implemented Slice 85: Clinic Subsequent Renewal Quote Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added subsequent renewal quote handoff packets that can be created only after the paid following-renewal cycle is closed and the subsequent-renewal CRM task exists.
- Added `/api/pilots/clinic-wellness/subsequent-renewal-quotes` list and `/api/pilots/clinic-wellness/following-renewal-closeouts/:followingRenewalCloseoutPacketId/subsequent-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Subsequent renewal quote handoffs create a draft AMD quote for the next monthly cycle after following-renewal closeout, require governed `crm.quote.release` approval, and keep the public quote hidden until approval execution.
- Subsequent renewal quote packets link the following renewal closeout checksum, following payment collection checksum, following posting/draft/acceptance/release/handoff lineage, next-renewal and renewal lineage, prior paid pilot artifacts, current CRM renewal tasks, quote, approval, AMD subtotal, 20% VAT, total, and release controls.
- Added subsequent renewal quote handoff packets to tenant backup scope and `pilot.subsequent_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Subsequent renewal quote panel showing amount, valid-until date, VAT, approval id, subsequent renewal task id, controls, and status evidence.
- Added API tests proving support rejection, quote and approval creation, public quote hiding, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 86: Clinic Subsequent Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-27.

- Added subsequent renewal quote release packets that can be created only after the owner executes the subsequent renewal quote's governed `crm.quote.release` approval.
- Added `/api/pilots/clinic-wellness/subsequent-renewal-quote-releases` list and `/api/pilots/clinic-wellness/subsequent-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Subsequent renewal release packets prove that the public customer quote link is visible only after approval execution and preserve the subsequent-renewal quote's AMD subtotal, 20% VAT, total, public token, and acceptance URL.
- Subsequent renewal release packets link the subsequent quote handoff checksum, following renewal closeout checksum, following payment collection checksum, following renewal lineage, next-renewal and renewal lineage, prior paid pilot lineage, CRM renewal tasks, quote, and approval.
- Added subsequent renewal quote release packets to tenant backup scope and `pilot.subsequent_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Subsequent release panel showing public quote status, quote amount, VAT, approval id, subsequent renewal task id, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 87: Clinic Subsequent Renewal Acceptance Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added subsequent renewal acceptance handoff packets that can be created only after the customer accepts the public subsequent renewal quote and HayHashvapah invoice approval exists.
- Added `/api/pilots/clinic-wellness/subsequent-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/subsequent-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Subsequent renewal acceptance handoffs link the release checksum, quote handoff checksum, following renewal closeout/payment lineage, following/next/renewal/prior cycle lineage, CRM renewal tasks, accepted quote, quote acceptance, HayHashvapah finance approval, Armenian AMD totals, 20% VAT mode, and accounting period.
- Added subsequent renewal acceptance handoff packets to tenant backup scope and `pilot.subsequent_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Subsequent acceptance panel showing signer, period, VAT mode, approval id, handoff controls, and status evidence.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 88: Clinic Subsequent Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-27.

- Added subsequent renewal HayHashvapah draft invoice packets that can be created only after the owner executes the accepted subsequent renewal quote's governed `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/subsequent-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/subsequent-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Seeded the August 2026 finance period as locked-by-default so the subsequent renewal draft path proves the Armenian period guard, reopen, and workflow retry behavior before packet creation.
- Subsequent renewal draft packets link the acceptance handoff checksum, quote release checksum, quote handoff checksum, following renewal closeout/payment lineage, following/next/renewal/prior cycle lineage, CRM renewal tasks, executed workflow run, HayHashvapah draft invoice, AMD totals, 20% VAT, and accounting period.
- Added subsequent renewal draft invoice packets to tenant backup scope and `pilot.subsequent_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Subsequent draft panel showing draft total, draft number, workflow run id, period, VAT, subtotal, status, and controls.
- Added API tests proving support rejection, pre-execution blocking, period-lock retry, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 89: Clinic Subsequent Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-27.

- Added subsequent renewal official HayHashvapah invoice posting packets that can be created only after the subsequent renewal draft invoice is posted into an official receivable.
- Added `/api/pilots/clinic-wellness/subsequent-renewal-official-invoices` list and `/api/pilots/clinic-wellness/subsequent-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Subsequent renewal posting packets link the draft packet checksum, acceptance handoff checksum, quote release/handoff, following renewal closeout/payment lineage, following/next/renewal/prior cycle lineage, CRM renewal tasks, HayHashvapah draft invoice, official invoice, finance link, AMD subtotal, 20% VAT, and accounting period.
- Added subsequent renewal official invoice posting packets to tenant backup scope and `pilot.subsequent_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Subsequent receivable panel showing official invoice number, finance link, period, VAT, status, checksum, and posting controls.
- Added API tests proving support rejection, pre-posting blocking, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 90: Clinic Subsequent Renewal Payment Collection Packet

Status: shipped in the local prototype on 2026-05-27.

- Added subsequent renewal payment collection packets that can be created only after the official subsequent renewal HayHashvapah invoice is fully paid.
- Added `/api/pilots/clinic-wellness/subsequent-renewal-payment-collections` list and `/api/pilots/clinic-wellness/subsequent-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Subsequent renewal payment packets link the official posting checksum, draft packet, acceptance/release/handoff lineage, following renewal closeout/payment lineage, following/next/renewal/prior cycle lineage, CRM renewal tasks, paid invoice, payment receipt, AMD amount, 20% VAT, and accounting period.
- Added subsequent renewal payment collection packets to tenant backup scope and `pilot.subsequent_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Subsequent payment panel showing receipt reference, invoice number, payment id, paid date, VAT, status, checksum, and collection controls.
- Added API tests proving support rejection, unpaid-invoice blocking, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 91: Clinic Subsequent Renewal Closeout Packet

Status: shipped in the local prototype on 2026-05-27.

- Added subsequent renewal closeout packets that can be created only after the paid subsequent-renewal HayHashvapah payment collection evidence exists.
- Added `/api/pilots/clinic-wellness/subsequent-renewal-closeouts` list and `/api/pilots/clinic-wellness/subsequent-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Subsequent renewal closeout packets link the payment collection checksum, official posting checksum, draft/acceptance/release/handoff lineage, following renewal closeout/payment lineage, following/next/renewal/prior cycle lineage, paid invoice, payment receipt, AMD totals, 20% VAT, accounting period, and CRM continuation renewal task.
- Added subsequent renewal closeout packets to tenant backup scope and `pilot.subsequent_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Subsequent closeout panel showing closeout date, continuation due date, continuation CRM task, payment reference, checksum, and closeout controls.
- Added API tests proving support/accountant rejection, checksum verification, idempotency, auditor metadata visibility, Customer 360 task linkage, backup inclusion, and audit evidence.

## Implemented Slice 92: Clinic Continuation Renewal Quote Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added continuation renewal quote handoff packets that can be created only after the subsequent renewal cycle is closed and its CRM continuation task exists.
- Added `/api/pilots/clinic-wellness/continuation-renewal-quotes` list and `/api/pilots/clinic-wellness/subsequent-renewal-closeouts/:subsequentRenewalCloseoutPacketId/continuation-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Continuation quote handoffs create a governed CRM quote release approval while keeping the public quote hidden until approval execution.
- Continuation handoff packets link the subsequent closeout checksum, subsequent payment collection checksum, subsequent quote/invoice lineage, following/next/renewal/prior cycle lineage, CRM renewal tasks, AMD monthly amount, 20% VAT, quote metadata, and approval metadata.
- Added continuation renewal quote handoff packets to tenant backup scope and `pilot.continuation_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Continuation renewal quote panel showing quote total, valid-until date, VAT, approval id, continuation task, status, and handoff controls.
- Added API tests proving support rejection, checksum verification, hidden public quote behavior before approval, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 93: Clinic Continuation Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-27.

- Added continuation renewal quote release packets that can be created only after the owner executes the continuation quote's governed `crm.quote.release` approval and the public quote is available.
- Added `/api/pilots/clinic-wellness/continuation-renewal-quote-releases` list and `/api/pilots/clinic-wellness/continuation-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Continuation release packets link the continuation quote handoff checksum, subsequent renewal closeout checksum, subsequent payment collection checksum, subsequent/following/next/renewal/prior lineage, CRM renewal tasks, public quote token/URL, AMD total, and 20% VAT.
- Added continuation renewal quote release packets to tenant backup scope and `pilot.continuation_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Continuation release panel showing release status, public quote path, total, VAT, approval id, continuation task, checksum, and release controls.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after workflow execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 94: Clinic Continuation Renewal Acceptance Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added continuation renewal acceptance handoff packets that can be created only after the customer accepts the public continuation renewal quote and HayHashvapah invoice approval exists.
- Added `/api/pilots/clinic-wellness/continuation-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/continuation-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Continuation acceptance handoffs link the release checksum, quote handoff checksum, subsequent renewal closeout/payment lineage, subsequent/following/next/renewal/prior lineage, CRM renewal tasks, accepted quote, quote acceptance, HayHashvapah finance approval, Armenian AMD totals, 20% VAT mode, and accounting period.
- Added continuation renewal acceptance handoff packets to tenant backup scope and `pilot.continuation_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Continuation acceptance panel showing signer, period, VAT mode, continuation task, finance approval id, checksum, and handoff controls.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 95: Clinic Continuation Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-27.

- Added continuation renewal HayHashvapah draft invoice packets that can be created only after the owner executes the accepted continuation renewal quote's governed `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/continuation-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/continuation-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Seeded the September 2026 finance period as locked-by-default so the continuation renewal draft path proves the Armenian period guard, reopen, and workflow retry behavior before packet creation.
- Continuation renewal draft packets link the acceptance handoff checksum, quote release checksum, quote handoff checksum, subsequent renewal closeout/payment lineage, subsequent/following/next/renewal/prior cycle lineage, CRM renewal tasks, executed workflow run, HayHashvapah draft invoice, AMD totals, 20% VAT, and accounting period.
- Added continuation renewal draft invoice packets to tenant backup scope and `pilot.continuation_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Continuation draft panel showing draft total, draft number, workflow run id, period, VAT, subtotal, status, and controls.
- Added API tests proving support rejection, pre-execution blocking, period-lock retry, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 96: Clinic Continuation Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-27.

- Added continuation renewal official HayHashvapah invoice posting packets that can be created only after the continuation renewal draft invoice is posted into an official receivable.
- Added `/api/pilots/clinic-wellness/continuation-renewal-official-invoices` list and `/api/pilots/clinic-wellness/continuation-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Continuation renewal posting packets link the draft packet checksum, acceptance handoff checksum, quote release/handoff, subsequent renewal closeout/payment lineage, subsequent/following/next/renewal/prior cycle lineage, CRM renewal tasks, HayHashvapah draft invoice, official invoice, finance link, AMD subtotal, 20% VAT, and accounting period.
- Added continuation renewal official invoice posting packets to tenant backup scope and `pilot.continuation_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Continuation receivable panel showing official invoice number, finance link, period, VAT, status, checksum, and posting controls.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 97: Clinic Continuation Renewal Payment Collection Packet

Status: shipped in the local prototype on 2026-05-27.

- Added continuation renewal payment collection packets that can be created only after the official continuation renewal HayHashvapah invoice is fully paid.
- Added `/api/pilots/clinic-wellness/continuation-renewal-payment-collections` list and `/api/pilots/clinic-wellness/continuation-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Continuation renewal payment packets link the official posting checksum, draft packet, acceptance/release/handoff lineage, subsequent renewal closeout/payment lineage, subsequent/following/next/renewal/prior cycle lineage, CRM renewal tasks, paid invoice, payment receipt, AMD amount, 20% VAT, and accounting period.
- Added continuation renewal payment collection packets to tenant backup scope and `pilot.continuation_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Continuation payment panel showing receipt reference, invoice number, payment id, paid date, VAT, status, checksum, and collection controls.
- Added API tests proving support rejection, unpaid-invoice blocking, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 98: Clinic Continuation Renewal Closeout Packet

Status: shipped in the local prototype on 2026-05-27.

- Added continuation renewal closeout packets that can be created only after the paid continuation-renewal HayHashvapah payment collection evidence exists.
- Added `/api/pilots/clinic-wellness/continuation-renewal-closeouts` list and `/api/pilots/clinic-wellness/continuation-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Continuation renewal closeout packets link the payment collection checksum, official posting checksum, draft/acceptance/release/handoff lineage, subsequent renewal closeout/payment lineage, following/next/renewal/prior cycle lineage, paid invoice, payment receipt, AMD totals, 20% VAT, accounting period, and CRM ongoing renewal task.
- Added continuation renewal closeout packets to tenant backup scope and `pilot.continuation_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Continuation closeout panel showing closeout date, ongoing due date, ongoing CRM task, payment reference, checksum, and closeout controls.
- Added API tests proving support/accountant rejection, checksum verification, idempotency, auditor metadata visibility, Customer 360 task linkage, backup inclusion, and audit evidence.

## Implemented Slice 99: Clinic Ongoing Renewal Quote Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added ongoing renewal quote handoff packets that can be created only after the paid continuation renewal cycle is closed and its ongoing CRM renewal task exists.
- Added `/api/pilots/clinic-wellness/ongoing-renewal-quotes` list and `/api/pilots/clinic-wellness/continuation-renewal-closeouts/:continuationRenewalCloseoutPacketId/ongoing-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Ongoing renewal quote handoffs create a draft AMD monthly renewal quote, request governed `crm.quote.release` approval, and keep the public quote hidden until approval execution.
- Ongoing renewal quote packets link the continuation renewal closeout checksum, continuation renewal payment/posting/draft/acceptance/release/handoff lineage, subsequent/following/next/renewal/prior cycle lineage, ongoing CRM renewal task, quote, approval, AMD subtotal, 20% VAT, total, and release controls.
- Added ongoing renewal quote handoff packets to tenant backup scope and `pilot.ongoing_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with an Ongoing renewal quote panel showing amount, valid-until date, VAT, approval id, ongoing renewal task id, controls, and status evidence.
- Added API tests proving support rejection, quote and approval creation, hidden public quote behavior before approval, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 100: Clinic Ongoing Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-27.

- Added ongoing renewal quote release packets that can be created only after the owner executes the ongoing quote's governed `crm.quote.release` approval and the public quote is available.
- Added `/api/pilots/clinic-wellness/ongoing-renewal-quote-releases` list and `/api/pilots/clinic-wellness/ongoing-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Ongoing renewal quote release packets prove that the public customer quote link is visible only after approval execution and preserve the ongoing-renewal quote's AMD subtotal, 20% VAT, total, public token, and acceptance URL.
- Ongoing renewal quote release packets link the ongoing quote handoff checksum, continuation renewal closeout/payment/posting/draft/acceptance/release/handoff lineage, subsequent/following/next/renewal/prior cycle lineage, CRM renewal tasks, quote, and approval.
- Added ongoing renewal quote release packets to tenant backup scope and `pilot.ongoing_renewal_quote_release.created` suite/audit events.
- Updated the workspace with an Ongoing release panel showing public quote status, quote, approval, ongoing renewal task, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 101: Clinic Ongoing Renewal Acceptance Handoff Packet

Status: shipped in the local prototype on 2026-05-27.

- Added ongoing renewal acceptance handoff packets that can be created only after the customer accepts the public ongoing renewal quote and HayHashvapah invoice approval exists.
- Added `/api/pilots/clinic-wellness/ongoing-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/ongoing-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Ongoing acceptance handoffs link the ongoing release checksum, ongoing quote handoff checksum, continuation renewal closeout/payment/posting/draft/acceptance/release lineage, earlier renewal lineage, CRM renewal tasks, accepted quote, quote acceptance, HayHashvapah finance approval, AMD totals, 20% VAT mode, and accounting period.
- Added ongoing renewal acceptance handoff packets to tenant backup scope and `pilot.ongoing_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with an Ongoing acceptance panel showing signer, period, VAT mode, ongoing renewal task, finance approval id, checksum-backed controls, and handoff action.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 102: Clinic Ongoing Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-27.

- Added ongoing renewal HayHashvapah draft invoice packets that can be created only after the owner executes the accepted ongoing renewal quote's governed `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/ongoing-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/ongoing-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Seeded the October 2026 finance period as locked by default so the ongoing renewal draft path proves Armenian period guard, reopen, and workflow retry before packet creation.
- Ongoing draft packets link the acceptance handoff checksum, quote release checksum, quote handoff checksum, continuation renewal closeout/payment lineage, earlier renewal lineage, CRM renewal tasks, executed workflow run, HayHashvapah draft invoice, AMD totals, 20% VAT, and accounting period.
- Added ongoing draft invoice packets to tenant backup scope and `pilot.ongoing_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with an Ongoing draft panel showing draft total, draft number, workflow run id, period, VAT, subtotal, status, and controls.
- Added API tests proving support rejection, pre-execution blocking, period-lock retry, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 103: Clinic Ongoing Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-27.

- Added ongoing renewal official HayHashvapah invoice posting packets that can be created only after the ongoing draft invoice is posted into an official receivable.
- Added `/api/pilots/clinic-wellness/ongoing-renewal-official-invoices` list and `/api/pilots/clinic-wellness/ongoing-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Ongoing official invoice packets link the ongoing draft checksum, acceptance handoff checksum, quote release checksum, quote handoff checksum, continuation renewal closeout/payment lineage, earlier renewal lineage, CRM renewal tasks, official invoice, invoice link, AMD totals, 20% VAT, and October 2026 accounting period.
- Added ongoing official invoice posting packets to tenant backup scope and `pilot.ongoing_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with an Ongoing receivable panel showing official invoice number, invoice link, period, VAT, invoice id, status, and controls.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 104: Clinic Ongoing Renewal HayHashvapah Payment Collection Packet

Status: shipped in the local prototype on 2026-05-27.

- Added ongoing renewal payment collection packets that can be created only after the official ongoing renewal invoice is fully paid by a HayHashvapah receipt.
- Added `/api/pilots/clinic-wellness/ongoing-renewal-payment-collections` list and `/api/pilots/clinic-wellness/ongoing-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Ongoing payment packets link the official posting checksum, draft packet, acceptance handoff, quote release, quote handoff, continuation renewal closeout/payment lineage, earlier renewal lineage, CRM renewal tasks, paid invoice, payment receipt, AMD amount, 20% VAT, and October 2026 period.
- Added ongoing payment collection packets to tenant backup scope and `pilot.ongoing_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with an Ongoing payment panel showing receipt reference, paid date, VAT, payment id, status, and controls.
- Added API tests proving support rejection, pre-payment blocking, payment receipt creation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 105: Clinic Ongoing Renewal Closeout and Next Recurring Task

Status: shipped in the local prototype on 2026-05-27.

- Added ongoing renewal closeout packets that can be created only after the paid ongoing renewal HayHashvapah payment collection packet exists.
- Added `/api/pilots/clinic-wellness/ongoing-renewal-closeouts` list and `/api/pilots/clinic-wellness/ongoing-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Ongoing closeout packets link the payment collection checksum, official posting checksum, draft packet, acceptance handoff, quote release, quote handoff, continuation renewal closeout/payment lineage, earlier renewal lineage, CRM renewal tasks, paid invoice, payment receipt, AMD amount, 20% VAT, October 2026 period, and next recurring ongoing renewal due date.
- The closeout creates an idempotent CRM task with source key `pilot-ongoing-renewal-closeout-next:{paymentCollectionPacketId}` so sales can prepare the next ongoing renewal quote cycle.
- Added ongoing closeout packets to tenant backup scope and `pilot.ongoing_renewal_closeout.created` suite/audit events.
- Updated the workspace with an Ongoing closeout panel showing closed date, amount, next due date, next task id, checksum, and controls.
- Added API tests proving support/accountant rejection, checksum verification, idempotency, auditor metadata visibility, customer 360 task linkage, backup inclusion, and audit evidence.

## Implemented Slice 106: Clinic Next Ongoing Renewal Quote Handoff

Status: shipped in the local prototype on 2026-05-27.

- Added next ongoing renewal quote handoff packets that can be created only after the ongoing renewal cycle is closed and the next recurring CRM task exists.
- Added `/api/pilots/clinic-wellness/next-ongoing-renewal-quotes` list and `/api/pilots/clinic-wellness/ongoing-renewal-closeouts/:ongoingRenewalCloseoutPacketId/next-ongoing-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Next ongoing handoffs create a draft CRM quote and governed `crm.quote.release` approval while keeping the public quote hidden until the approval executes.
- Next ongoing handoff packets link the ongoing closeout checksum, ongoing payment collection checksum, official posting checksum, previous continuation and renewal lineage, paid invoice/payment context, next ongoing CRM task, AMD monthly amount, and 20% Armenian VAT.
- Added next ongoing quote handoff packets to tenant backup scope and `pilot.next_ongoing_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Next ongoing renewal panel showing monthly quote amount, quote id, next task id, valid-until date, VAT, approval id, status, and controls.
- Added API tests proving support rejection, quote and approval creation, hidden public quote behavior, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 107: Clinic Next Ongoing Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-27.

- Added next ongoing renewal quote release packets that can be created only after the owner executes the governed next ongoing quote release workflow and the public quote is available.
- Added `/api/pilots/clinic-wellness/next-ongoing-renewal-quote-releases` list and `/api/pilots/clinic-wellness/next-ongoing-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Next ongoing release packets prove public quote availability after approval execution and preserve the next ongoing quote's AMD subtotal, 20% VAT, total, public token, and acceptance URL.
- Next ongoing release packets link the next ongoing quote handoff checksum, ongoing closeout/payment/posting/draft/acceptance/release/handoff lineage, previous continuation and renewal lineage, CRM renewal tasks, next ongoing CRM task, quote, and approval.
- Added next ongoing quote release packets to tenant backup scope and `pilot.next_ongoing_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Next ongoing release panel showing public quote status, quote, approval, next ongoing task, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 108: Clinic Next Ongoing Renewal Acceptance Handoff Packet

Status: shipped in the local prototype on 2026-05-28.

- Added next ongoing renewal acceptance handoff packets that can be created only after the customer accepts the released next ongoing renewal quote and the HayHashvapah finance approval exists.
- Added `/api/pilots/clinic-wellness/next-ongoing-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/next-ongoing-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next ongoing acceptance handoffs link the next ongoing release checksum, next ongoing quote handoff checksum, ongoing closeout/payment/posting/draft/acceptance/release lineage, previous continuation and renewal lineage, CRM renewal tasks, next ongoing CRM task, accepted quote, quote acceptance, and HayHashvapah finance approval.
- The handoff preserves Armenian accounting context from the accepted public quote, including AMD totals, 20% VAT mode, signer evidence, and the November 2026 accounting period.
- Added next ongoing acceptance handoff packets to tenant backup scope and `pilot.next_ongoing_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Next ongoing acceptance panel showing signer, period, VAT mode, finance approval, next ongoing task, controls, and checksum evidence.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 109: Clinic Next Ongoing Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-28.

- Added next ongoing renewal HayHashvapah draft invoice packets that can be created only after the owner executes the accepted next ongoing renewal quote's governed `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/next-ongoing-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/next-ongoing-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Seeded the November 2026 finance period as locked by default so the next ongoing renewal draft path proves the Armenian period guard, reopen, and workflow retry before packet creation.
- Next ongoing draft packets link the acceptance handoff checksum, quote release checksum, quote handoff checksum, ongoing closeout/payment/posting/draft/acceptance/release lineage, prior continuation and renewal lineage, CRM renewal tasks, executed workflow run, HayHashvapah draft invoice, AMD totals, 20% VAT, and accounting period.
- Added next ongoing renewal draft invoice packets to tenant backup scope and `pilot.next_ongoing_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Next ongoing draft panel showing draft total, draft number, workflow run id, period, VAT, subtotal, status, and controls.
- Added API tests proving support rejection, pre-execution blocking, period-lock retry, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 110: Clinic Next Ongoing Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-28.

- Added next ongoing renewal official HayHashvapah invoice posting packets that can be created only after the next ongoing draft invoice is posted into an official receivable.
- Added `/api/pilots/clinic-wellness/next-ongoing-renewal-official-invoices` list and `/api/pilots/clinic-wellness/next-ongoing-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next ongoing official invoice packets link the next ongoing draft checksum, acceptance handoff checksum, quote release checksum, quote handoff checksum, ongoing closeout/payment/posting/draft/acceptance/release lineage, previous renewal lineage, CRM renewal tasks, official invoice, invoice link, AMD totals, 20% VAT, and the November 2026 accounting period.
- Added next ongoing official invoice posting packets to tenant backup scope and `pilot.next_ongoing_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Next ongoing receivable panel showing official invoice number, invoice link, period, VAT, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 111: Clinic Next Ongoing Renewal HayHashvapah Payment Collection Packet

Status: shipped in the local prototype on 2026-05-28.

- Added next ongoing renewal payment collection packets that can be created only after the next ongoing official HayHashvapah invoice is fully paid by a receipt.
- Added `/api/pilots/clinic-wellness/next-ongoing-renewal-payment-collections` list and `/api/pilots/clinic-wellness/next-ongoing-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next ongoing payment packets link the official posting checksum, draft packet, acceptance handoff, quote release, quote handoff, ongoing closeout/payment/posting lineage, previous renewal lineage, CRM renewal tasks, paid invoice, payment receipt, AMD amount, 20% VAT, and November 2026 period.
- Added next ongoing payment collection packets to tenant backup scope and `pilot.next_ongoing_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Next ongoing payment panel showing receipt reference, paid date, period, payment id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-payment blocking, payment receipt creation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 112: Clinic Next Ongoing Renewal Closeout Packet

Status: shipped in the local prototype on 2026-05-28.

- Added next ongoing renewal closeout packets that can be created only after paid next ongoing HayHashvapah payment collection evidence exists.
- Added `/api/pilots/clinic-wellness/next-ongoing-renewal-closeouts` list and `/api/pilots/clinic-wellness/next-ongoing-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Next ongoing closeout packets link the payment collection checksum, official posting checksum, draft/acceptance/release/handoff lineage, ongoing closeout/payment/posting lineage, prior renewal lineage, paid invoice, payment receipt, AMD totals, 20% VAT, November 2026 period, and the following recurring ongoing CRM task.
- Added next ongoing closeout packets to tenant backup scope and `pilot.next_ongoing_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Next ongoing closeout panel showing closed date, amount, following due date, following CRM task, checksum, and closeout controls.
- Added API tests proving role rejection, checksum verification, idempotency, auditor metadata visibility, Customer 360 task linkage, backup inclusion, and audit evidence.

## Implemented Slice 113: Clinic Following Ongoing Renewal Quote Handoff

Status: shipped in the local prototype on 2026-05-28.

- Added following ongoing renewal quote handoff packets that can be created only after the next ongoing renewal cycle is closed and the following recurring CRM task exists.
- Added `/api/pilots/clinic-wellness/following-ongoing-renewal-quotes` list and `/api/pilots/clinic-wellness/next-ongoing-renewal-closeouts/:nextOngoingRenewalCloseoutPacketId/following-ongoing-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Following ongoing handoffs create a draft CRM quote and governed `crm.quote.release` approval while keeping the public quote hidden until the approval executes.
- Following ongoing handoff packets link the next ongoing closeout checksum, next ongoing payment/posting/draft/acceptance/release/handoff lineage, prior ongoing and renewal lineage, following ongoing CRM task, AMD monthly amount, and 20% Armenian VAT.
- Added following ongoing quote handoff packets to tenant backup scope and `pilot.following_ongoing_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Following ongoing renewal quote panel showing monthly amount, quote id, following task id, valid-until date, VAT, approval id, status, and controls.
- Added API tests proving support rejection, quote and approval creation, hidden public quote behavior, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 114: Clinic Following Ongoing Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-28.

- Added following ongoing renewal quote release packets that can be created only after the owner executes the governed following ongoing quote release workflow and the public quote is available.
- Added `/api/pilots/clinic-wellness/following-ongoing-renewal-quote-releases` list and `/api/pilots/clinic-wellness/following-ongoing-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Following ongoing release packets prove public quote visibility after approval execution and preserve the following ongoing quote's AMD subtotal, 20% VAT, total, public token, and acceptance URL.
- Following ongoing release packets link the following ongoing quote handoff checksum, next ongoing closeout/payment/posting/draft/acceptance/release/handoff lineage, prior ongoing and renewal lineage, CRM renewal tasks, following ongoing CRM task, quote, and approval.
- Added following ongoing quote release packets to tenant backup scope and `pilot.following_ongoing_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Following ongoing release panel showing public quote status, total, VAT, approval, following task, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 115: Clinic Following Ongoing Renewal Acceptance Handoff Packet

Status: shipped in the local prototype on 2026-05-28.

- Added following ongoing renewal acceptance handoff packets that can be created only after the customer accepts the released following ongoing renewal quote and the HayHashvapah finance approval exists.
- Added `/api/pilots/clinic-wellness/following-ongoing-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/following-ongoing-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following ongoing acceptance handoffs link the following ongoing release checksum, following ongoing quote handoff checksum, next ongoing closeout/payment/posting/draft/acceptance/release/handoff lineage, prior ongoing and renewal lineage, CRM renewal tasks, following ongoing CRM task, accepted quote, quote acceptance, and HayHashvapah finance approval.
- The handoff preserves Armenian accounting context from the accepted public quote, including AMD totals, 20% VAT mode, signer evidence, and the December 2026 accounting period.
- Added following ongoing acceptance handoff packets to tenant backup scope and `pilot.following_ongoing_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Following ongoing acceptance panel showing signer, period, VAT mode, finance approval, status, and handoff controls.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 116: Clinic Following Ongoing Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-28.

- Added following ongoing renewal HayHashvapah draft invoice packets that can be created only after the owner executes the accepted following ongoing quote's governed `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/following-ongoing-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/following-ongoing-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following ongoing draft packets link the acceptance handoff checksum, quote release checksum, quote handoff checksum, next ongoing closeout/payment/posting/draft/acceptance/release lineage, prior ongoing and renewal lineage, following ongoing CRM task, executed workflow run, HayHashvapah draft invoice, AMD totals, 20% VAT, and December 2026 period.
- Added following ongoing draft packets to tenant backup scope and `pilot.following_ongoing_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Following ongoing draft panel showing draft number, period, VAT, subtotal, following task, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-execution blocking, owner approval execution with locked-period reopen, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 117: Clinic Following Ongoing Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-28.

- Added following ongoing renewal official invoice posting packets that can be created only after the HayHashvapah draft invoice is posted into an official receivable.
- Added `/api/pilots/clinic-wellness/following-ongoing-renewal-official-invoices` list and `/api/pilots/clinic-wellness/following-ongoing-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following ongoing official posting packets link the draft packet checksum, acceptance handoff checksum, quote release/handoff checksums, next ongoing closeout/payment/posting lineage, prior ongoing and renewal lineage, following ongoing CRM task, HayHashvapah draft invoice, official invoice, finance invoice link, AMD totals, 20% VAT, and December 2026 period.
- Added following ongoing official posting packets to tenant backup scope and `pilot.following_ongoing_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Following ongoing receivable panel showing official invoice number, invoice link, period, VAT mode, VAT, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 118: Clinic Following Ongoing Renewal Payment Collection Packet

Status: shipped in the local prototype on 2026-05-28.

- Added following ongoing renewal payment collection packets that can be created only after the following ongoing official HayHashvapah invoice is fully paid by a receipt.
- Added `/api/pilots/clinic-wellness/following-ongoing-renewal-payment-collections` list and `/api/pilots/clinic-wellness/following-ongoing-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Following ongoing payment packets link the official posting checksum, draft/acceptance/release/handoff lineage, next ongoing closeout/payment/posting lineage, prior ongoing and renewal lineage, following ongoing CRM task, official invoice, payment receipt, AMD totals, 20% VAT, and December 2026 period.
- Added following ongoing payment collection packets to tenant backup scope and `pilot.following_ongoing_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Following ongoing payment panel showing receipt reference, paid date, period, payment id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-payment blocking, receipt capture, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 119: Clinic Following Ongoing Renewal Closeout Packet

Status: shipped in the local prototype on 2026-05-28.

- Added following ongoing renewal closeout packets that can be created only after the following ongoing official HayHashvapah invoice is fully paid and collected.
- Added `/api/pilots/clinic-wellness/following-ongoing-renewal-closeouts` list and `/api/pilots/clinic-wellness/following-ongoing-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Following ongoing closeout packets link payment collection checksum, official posting checksum, draft/acceptance/release/handoff lineage, next ongoing closeout/payment/posting lineage, prior ongoing and renewal lineage, official invoice, payment receipt, AMD totals, 20% VAT, and December 2026 period.
- Closeout creates an idempotent CRM task for the subsequent recurring ongoing renewal quote cycle with January 2027 due date and Customer 360 visibility.
- Added following ongoing closeouts to tenant backup scope and `pilot.following_ongoing_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Following ongoing closeout panel showing closeout date, amount, subsequent due date, task id, status, controls, and checksum evidence.
- Added API tests proving support/accountant rejection, closeout packet creation, task creation, checksum verification, idempotency, auditor metadata visibility, Customer 360 task visibility, backup inclusion, and audit evidence.

## Implemented Slice 120: Clinic Subsequent Ongoing Renewal Quote Handoff Packet

Status: shipped in the local prototype on 2026-05-28.

- Added subsequent ongoing renewal quote handoff packets that can be created only after the following ongoing renewal cycle is closed and the subsequent recurring CRM task exists.
- Added `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-quotes` list and `/api/pilots/clinic-wellness/following-ongoing-renewal-closeouts/:followingOngoingRenewalCloseoutPacketId/subsequent-ongoing-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Subsequent ongoing handoffs create a draft CRM quote and governed `crm.quote.release` approval while keeping the public quote hidden until owner approval executes.
- Subsequent ongoing handoff packets link the following ongoing closeout checksum, following ongoing payment/posting/draft/acceptance/release/handoff lineage, next ongoing closeout/payment/posting lineage, prior ongoing and renewal lineage, subsequent recurring CRM task, AMD monthly total, and 20% Armenian VAT.
- Added subsequent ongoing quote handoff packets to tenant backup scope and `pilot.subsequent_ongoing_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Subsequent ongoing renewal quote panel showing monthly amount, quote id, subsequent task id, valid-until date, VAT, approval id, status, and controls.
- Added API tests proving support rejection, quote and approval creation, hidden public quote behavior, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 121: Clinic Subsequent Ongoing Renewal Quote Release Packet

Status: shipped in the local prototype on 2026-05-28.

- Added subsequent ongoing renewal quote release packets that can be created only after the owner executes the governed subsequent ongoing quote release workflow and the public quote is available.
- Added `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-quote-releases` list and `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Subsequent ongoing release packets prove public quote visibility after approval execution and preserve the subsequent ongoing quote's AMD subtotal, 20% VAT, total, public token, and acceptance URL.
- Subsequent ongoing release packets link the subsequent ongoing quote handoff checksum, following ongoing closeout/payment/posting/draft/acceptance/release/handoff lineage, next ongoing closeout/payment/posting lineage, prior ongoing and renewal lineage, CRM renewal tasks, subsequent recurring CRM task, quote, and approval.
- Added subsequent ongoing quote release packets to tenant backup scope and `pilot.subsequent_ongoing_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Subsequent ongoing release panel showing public quote status, total, VAT, approval, subsequent task, controls, and checksum evidence.
- Added API tests proving support rejection, pre-approval blocking, public quote visibility after approval execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 122: Clinic Subsequent Ongoing Renewal Acceptance Handoff Packet

Status: shipped in the local prototype on 2026-05-28.

- Added subsequent ongoing renewal acceptance handoff packets that can be created only after the customer accepts the released subsequent ongoing quote and the HayHashvapah finance approval exists.
- Added `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Subsequent ongoing acceptance handoffs link the subsequent ongoing release checksum, subsequent ongoing quote handoff checksum, following ongoing closeout/payment/posting/draft/acceptance/release/handoff lineage, next ongoing and prior ongoing lineage, CRM renewal tasks, subsequent ongoing CRM task, accepted quote, quote acceptance, and HayHashvapah finance approval.
- The handoff preserves Armenian accounting context from the accepted public quote, including AMD totals, 20% VAT mode, signer evidence, and the January 2027 accounting period.
- Added subsequent ongoing acceptance handoff packets to tenant backup scope and `pilot.subsequent_ongoing_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Subsequent ongoing acceptance panel showing signer, period, VAT mode, finance approval, status, and handoff controls.
- Added API tests proving support rejection, pre-acceptance blocking, public quote acceptance, finance approval linkage, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 123: Clinic Subsequent Ongoing Renewal HayHashvapah Draft Invoice Packet

Status: shipped in the local prototype on 2026-05-28.

- Added subsequent ongoing renewal HayHashvapah draft invoice packets that can be created only after the owner executes the accepted subsequent ongoing quote's governed `finance.invoice.propose` approval.
- Added `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Subsequent ongoing draft packets link the acceptance handoff checksum, quote release checksum, quote handoff checksum, following ongoing closeout/payment/posting/draft/acceptance/release lineage, next ongoing and prior ongoing lineage, subsequent ongoing CRM task, executed workflow run, HayHashvapah draft invoice, AMD totals, 20% VAT, and January 2027 period.
- Added subsequent ongoing draft packets to tenant backup scope and `pilot.subsequent_ongoing_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Subsequent ongoing draft panel showing draft number, period, VAT, subtotal, subsequent task, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-execution blocking, owner approval execution with locked-period reopen, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 124: Clinic Subsequent Ongoing Renewal Official HayHashvapah Invoice Posting Packet

Status: shipped in the local prototype on 2026-05-28.

- Added subsequent ongoing renewal official invoice posting packets that can be created only after the HayHashvapah draft invoice is posted into an official receivable.
- Added `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-official-invoices` list and `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Subsequent ongoing official posting packets link the draft packet checksum, acceptance handoff checksum, quote release/handoff checksums, following ongoing closeout/payment/posting/draft/acceptance/release lineage, next ongoing and prior ongoing lineage, subsequent ongoing CRM task, HayHashvapah draft invoice, official invoice, finance invoice link, AMD totals, 20% VAT, and January 2027 period.
- Added subsequent ongoing official posting packets to tenant backup scope and `pilot.subsequent_ongoing_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Subsequent ongoing receivable panel showing official invoice number, invoice link, period, VAT mode, VAT, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-posting blocking, official invoice posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

## Implemented Slice 125: Clinic Subsequent Ongoing Renewal Payment Collection Packet

Status: shipped in the local prototype on 2026-05-28.

- Added subsequent ongoing renewal payment collection packets that can be created only after the subsequent ongoing official HayHashvapah invoice is fully paid by a receipt.
- Added `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-payment-collections` list and `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Subsequent ongoing payment packets link the official posting checksum, draft/acceptance/release/handoff lineage, following ongoing closeout/payment/posting/draft/acceptance/release lineage, next ongoing and prior ongoing lineage, subsequent ongoing CRM task, official invoice, payment receipt, AMD totals, 20% VAT, and January 2027 period.
- Added subsequent ongoing payment collection packets to tenant backup scope and `pilot.subsequent_ongoing_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Subsequent ongoing payment panel showing receipt reference, paid date, period, payment id, status, controls, and checksum evidence.
- Added API tests proving support rejection, pre-payment blocking, receipt capture, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

### Slice 126 - Clinic subsequent ongoing renewal closeout packet

- Added `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-closeouts` list and `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Subsequent ongoing closeout packets link the paid subsequent payment collection checksum, official posting checksum, draft/acceptance/release/handoff lineage, following ongoing closeout/payment/posting lineage, next ongoing and prior ongoing lineage, Armenian VAT period totals, and the newly scheduled next recurring ongoing CRM task.
- Added subsequent ongoing closeout packets to tenant backup scope and `pilot.subsequent_ongoing_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Subsequent ongoing closeout panel showing close date, amount, next due date, next recurring task id, status, controls, and checksum evidence.
- Added API tests proving Support/Accountant rejection, closeout creation, next recurring task scheduling, checksum verification, idempotency, auditor metadata visibility, Customer 360 linkage, backup inclusion, and audit evidence.

### Slice 127 - Clinic next recurring ongoing renewal quote handoff

- Added `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-quotes` list and `/api/pilots/clinic-wellness/subsequent-ongoing-renewal-closeouts/:subsequentOngoingRenewalCloseoutPacketId/next-recurring-ongoing-renewal-quote-handoff` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Next recurring ongoing quote handoffs link the subsequent ongoing closeout checksum, paid subsequent payment collection checksum, official posting/draft/acceptance/release/handoff lineage, prior ongoing lineage, next recurring CRM task, draft quote, workflow approval, AMD totals, and Armenian 20% VAT pricing evidence.
- Added next recurring ongoing quote handoff packets to tenant backup scope and `pilot.next_recurring_ongoing_renewal_quote_handoff.created` suite/audit events.
- Updated the workspace with a Next recurring ongoing quote handoff panel showing quote total, VAT, approval id, task id, status, controls, and hidden-public-quote evidence.
- Added API tests proving Support rejection, quote handoff creation, public quote hiding before approval, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

### Slice 128 - Clinic next recurring ongoing renewal quote release

- Added `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-quote-releases` list and `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-quotes/:handoffId/release-packet` create endpoints with operational read access, Owner/Admin/Salesperson create access, Auditor metadata visibility, and Support rejection.
- Next recurring ongoing release packets can be created only after the owner-approved `crm.quote.release` workflow execution sends the quote and makes the public quote available.
- Release packets link the next recurring quote handoff checksum, subsequent ongoing closeout checksum, paid subsequent payment collection checksum, official posting/draft/acceptance/release/handoff lineage, prior ongoing lineage, next recurring CRM task, quote, approval, public token, acceptance URL, AMD totals, and Armenian 20% VAT.
- Added next recurring ongoing quote release packets to tenant backup scope and `pilot.next_recurring_ongoing_renewal_quote_release.created` suite/audit events.
- Updated the workspace with a Next recurring release panel showing public quote status, total, VAT, approval id, task id, controls, and checksum evidence.
- Added API tests proving Support rejection, pre-approval blocking, public quote visibility after workflow execution, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

### Slice 129 - Clinic next recurring ongoing renewal acceptance handoff

- Added `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-acceptance-handoffs` list and `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-quote-releases/:releaseId/acceptance-handoff` create endpoints with operational read access, Owner/Admin/Salesperson/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next recurring ongoing acceptance handoffs can be created only after the public quote is accepted and the HayHashvapah `finance.invoice.propose` workflow approval exists for the accepted quote.
- Acceptance packets link the public release checksum, next recurring quote handoff checksum, subsequent ongoing closeout/payment/posting/draft/acceptance/release lineage, prior ongoing lineage, next recurring CRM task, quote acceptance evidence, finance approval id, AMD totals, period key, and Armenian 20% VAT mode.
- Added next recurring ongoing acceptance handoff packets to tenant backup scope and `pilot.next_recurring_ongoing_renewal_quote_acceptance_handoff.created` suite/audit events.
- Updated the workspace with a Next recurring acceptance panel showing signer, billing period, VAT mode, finance approval id, status, controls, and checksum-backed invoice handoff evidence.
- Added API tests proving Support rejection, pre-acceptance blocking, accepted public quote handoff creation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

### Slice 130 - Clinic next recurring ongoing renewal HayHashvapah draft invoice

- Added `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-hayhashvapah-drafts` list and `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-acceptance-handoffs/:handoffId/draft-invoice-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next recurring ongoing draft packets can be created only after the owner executes the accepted quote's `finance.invoice.propose` approval and the resulting HayHashvapah draft invoice exists.
- Draft packets link the acceptance handoff checksum, public release checksum, next recurring quote handoff checksum, subsequent ongoing closeout/payment/posting/draft/acceptance/release lineage, next recurring CRM task, workflow run, finance draft invoice, AMD totals, period key, and Armenian 20% VAT mode.
- Added next recurring ongoing HayHashvapah draft packets to tenant backup scope, seeded the `2027-02` locked finance period for reopenable execution proof, and emitted `pilot.next_recurring_ongoing_renewal_hayhashvapah_draft_invoice.created` suite/audit events.
- Updated the workspace with a Next recurring draft panel showing draft number, workflow run, period, VAT mode, VAT/subtotal, task id, status, controls, and checksum-backed posting readiness.
- Added API tests proving Support rejection, pre-execution blocking, period reopen/retry handling, draft packet creation, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

### Slice 131 - Clinic next recurring ongoing renewal official HayHashvapah invoice posting

- Added `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-official-invoices` list and `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-hayhashvapah-drafts/:draftPacketId/posting-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next recurring ongoing official posting packets can be created only after the HayHashvapah draft invoice is posted into an official receivable through the existing Armenian finance period-locked posting flow.
- Posting packets link the draft packet checksum, acceptance handoff checksum, public release checksum, quote handoff checksum, subsequent ongoing closeout/payment/posting/draft/acceptance/release lineage, prior ongoing lineage, next recurring CRM task, draft invoice, official invoice, finance invoice link, AMD totals, period key, and Armenian 20% VAT mode.
- Added next recurring ongoing official posting packets to tenant backup scope and emitted `pilot.next_recurring_ongoing_renewal_hayhashvapah_invoice_posting.created` suite/audit events.
- Updated the workspace with a Next recurring receivable panel showing official invoice number, invoice link, period, VAT mode, VAT, status, controls, and checksum-backed payment-collection readiness.
- Added API tests proving Support rejection, pre-posting blocking, official invoice posting, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

### Slice 132 - Clinic next recurring ongoing renewal payment collection

- Added `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-payment-collections` list and `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-official-invoices/:postingPacketId/payment-packet` create endpoints with operational read access, Owner/Admin/Accountant create access, Auditor metadata visibility, and Support rejection.
- Next recurring ongoing payment packets can be created only after the official HayHashvapah invoice is fully paid by a finance receipt.
- Payment packets link the official posting checksum, draft/acceptance/release/handoff checksums, subsequent ongoing closeout/payment/posting/draft lineage, prior ongoing lineage, next recurring CRM task, official invoice, payment receipt, AMD totals, period key, and Armenian 20% VAT mode.
- Added next recurring ongoing payment collection packets to tenant backup scope and emitted `pilot.next_recurring_ongoing_renewal_hayhashvapah_payment_collection.created` suite/audit events.
- Updated the workspace with a Next recurring payment panel showing receipt reference, paid date, period, payment id, invoice number, status, controls, and checksum-backed closeout readiness.
- Added API tests proving Support rejection, pre-payment blocking, receipt capture, checksum verification, idempotency, auditor metadata visibility, backup inclusion, and audit evidence.

### Slice 133 - Clinic next recurring ongoing renewal closeout

- Added `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-closeouts` list and `/api/pilots/clinic-wellness/next-recurring-ongoing-renewal-payment-collections/:paymentCollectionPacketId/closeout-packet` create endpoints with operational read access, Owner/Admin create access, Auditor metadata visibility, and Support/Accountant rejection.
- Next recurring ongoing closeout packets can be created only after the next recurring HayHashvapah invoice is paid and its payment collection packet exists.
- Closeout packets link the paid next recurring payment checksum, official posting checksum, draft/acceptance/release/handoff lineage, subsequent ongoing closeout/payment/posting lineage, prior ongoing lineage, Armenian VAT period totals, and the newly scheduled following recurring ongoing CRM task.
- Added next recurring ongoing closeout packets to tenant backup scope and emitted `pilot.next_recurring_ongoing_renewal_closeout.created` suite/audit events.
- Updated the workspace with a Next recurring closeout panel showing close date, amount, following due date, following recurring task id, status, controls, and checksum evidence.
- Added API tests proving Support/Accountant rejection, closeout creation, following recurring task scheduling, checksum verification, idempotency, auditor metadata visibility, Customer 360 linkage, backup inclusion, and audit evidence.

### Slice 134 - Professional Legal Source Production Review

- Added the Lawyer demo role with docs/analytics entitlement so legal reviewers can log in separately from owner/admin users.
- Source reviews now preserve reviewer role metadata and allow Owner/Admin maintenance while requiring Accountant review for the tax-code source and Lawyer review for personal-data/e-sign sources.
- The production readiness gate now treats owner/admin source maintenance as insufficient for production sign-off; it passes legal-source gates only when the latest active review comes from the matching professional role.
- The workspace review actions are shown to the relevant professional role: Accountant for VAT/tax source review and Lawyer for e-sign/personal-data source review.
- Added API tests proving professional source-review authorization, Lawyer readiness access, owner-only review not clearing the production gate, auditor write rejection, and least-privilege Lawyer entitlements.

### Slice 135 - Downstream Professional Source Enforcement

- Downstream legal/accounting actions now share the production-readiness source rule instead of checking only `legal_sources.status = active`.
- SRC export packets require Accountant-reviewed VAT/tax source signoff before packet creation, and their payload records the latest reviewer role/name.
- Docs e-sign evidence packets, personal-data requests, export packets, and retention assessments require Lawyer-reviewed source signoff before creation/execution, and their payloads preserve the professional reviewer evidence.
- Copilot citations expose `professionalReviewReady`; proposed SRC/privacy actions remain disabled after owner-only source maintenance and unlock only after matching professional review.
- Added tests proving owner-only active source maintenance still blocks SRC, e-sign, and privacy workflows while Accountant/Lawyer review unlocks them.

### Slice 136 - Copilot Advisory Audit Trail

- Each legal/accounting Copilot answer now emits a `copilot.advisory.generated` suite timeline event and audit event.
- Audit/timeline payloads intentionally store metadata only: Copilot id, intent, customer id, risk/review flags, model policy, source ids, calculation/action keys, source-review readiness, question length, and a SHA-256 question hash.
- Raw user question text and generated answer text are not stored in the audit metadata, keeping sensitive advisory prompts out of durable logs while preserving traceability.
- The Copilot API returns the fresh event list, and the React workspace refreshes the Event bus and Audit panels after a Copilot ask without discarding the visible answer.
- Added tests proving Copilot remains non-mutating while advisory use is traceable through customer timeline and audit records.

### Slice 137 - Copilot Citation Review Evidence

- Copilot source citations now render professional-review evidence in the Armenian UI instead of showing only source title/status/date.
- Ready citations show the matching professional reviewer role/name and latest review timestamp; blocked citations show that professional review is still open and identify the latest non-professional reviewer when present.
- Added tests proving owner-only VAT source maintenance is exposed as not professionally ready, while Accountant review marks the citation ready with reviewer metadata.

### Slice 138 - Copilot Citation Source Links

- Copilot source citations now render a safe external link to the maintained Armenian legal/accounting source URL with a visible host label.
- The UI only renders HTTP(S) source links and keeps them behind an explicit user click, preserving the local/offline default while making cited authority inspectable.
- Added tests proving VAT Copilot citations carry the seeded ARLIS source URL/effective date, preserve the reviewed source URL through owner-maintained and Accountant-reviewed source updates, and reject non-HTTP(S) links in the UI helper.

### Slice 139 - Legal Source Host Stability

- Legal source reviews now keep each maintained Armenian legal/accounting source on its existing source host while still allowing path, query, and version updates.
- Host comparison normalizes case and a leading `www.`, so ARLIS review updates can use either `www.arlis.am` or `arlis.am`, while arbitrary host changes are rejected before updating `legal_sources` or adding review history.
- Added API tests proving reviewed source URLs flow into legal answer citations, same-host updates are accepted, cross-host updates are rejected, and rejected reviews do not advance the stored URL or review count.

### Slice 140 - Legal Source Host Block Audit

- Blocked legal-source host changes now leave a metadata-only governance trail instead of failing silently.
- When a reviewer attempts to move a maintained Armenian legal/accounting source to a different host, the API emits matching `legal.source.review.blocked` suite and audit events before returning `400`.
- The event payload records only the source id, normalized existing host, normalized attempted host, reason, requested status/date, and reviewer role. It deliberately avoids storing the raw rejected URL in durable audit metadata.
- Added API tests proving the blocked attempt is visible in timeline/audit evidence while `legal_sources` and `legal_source_reviews` remain unchanged.

### Slice 141 - Legal Source HTTPS Downgrade Guard

- Maintained Armenian legal/accounting sources that already use HTTPS can no longer be reviewed into HTTP URLs, even when the normalized host stays the same.
- HTTPS downgrade attempts reuse the `legal.source.review.blocked` suite/audit event with `reason: "scheme-downgrade"` and store only source id, normalized hosts, and protocols.
- Downgrade audit payloads deliberately omit the raw rejected URL, title, review note, requested status/date, and reviewer role, keeping rejected review content out of durable evidence.
- Added API tests proving HTTPS-to-HTTP downgrade attempts return `400`, leave `legal_sources` and `legal_source_reviews` unchanged, and keep normal same-host HTTPS review updates working.

### Slice 142 - Legal Source Credentialed URL Guard

- Legal source review URLs that contain username/password userinfo are rejected before mutating `legal_sources` or adding review history, even when the host and HTTPS scheme are otherwise valid.
- Credentialed URL blocks reuse the `legal.source.review.blocked` suite/audit event with `reason: "url-credentials"` and store only source id, normalized hosts, and protocols.
- Credentialed URL audit payloads deliberately omit the raw rejected URL, username/password, title, review note, requested status/date, and reviewer role, keeping secrets and rejected review content out of durable evidence.
- Copilot source links refuse credentialed legacy source URLs, so citations with embedded credentials are never rendered as clickable external links.
- Added API and source-link helper tests proving credentialed review attempts return `400`, leave source state unchanged, avoid secret leakage in suite/audit payloads, and hide credentialed citation links.

### Slice 143 - Audit Reader Gate and Legal Review Note Metadata

- The global `/api/audit` feed is now an explicit audit-reader surface limited to Owner/Admin/Auditor roles; unauthenticated users still receive `401`, while Support, Accountant, and Service Manager users receive `403`.
- The React workspace skips the global audit fetch for non-audit-reader roles, preserving their app workflow access without leaking organization-wide audit details.
- Accepted legal source reviews still preserve the full reviewer note in the canonical `legal_source_reviews` record, but `legal.source.reviewed` suite/audit metadata now stores only `reviewNoteHash` and `reviewNoteLength`.
- Added API and frontend helper tests proving audit feed role gating, accepted legal-source review note non-leakage, Salesperson and Service Manager workflow compatibility, Owner/Admin/Auditor audit-reader access, and non-audit-reader UI audit-fetch suppression.

### Slice 144 - A1 Platform Tenant Resolution Bridge

- Added optional A1 Platform tenant resolution for Studio requests, controlled by `A1_PLATFORM_TENANT_RESOLUTION` and resolved from `product=studio` plus the original request host forwarded as `x-a1-request-host`.
- `/api/health` now exposes only public enabled/resolved/strict tenant flags, while `/api/platform/tenant` is limited to audit-reader roles and returns a redacted tenant summary without database URLs or raw module objects.
- Tenant resolution fails open by default for temporary platform lookup failures, fails closed when `A1_PLATFORM_TENANT_STRICT=1`, respects the existing outbound egress allowlist, caches successful per-host lookups, and always blocks tenant maintenance, tenant disabled, or module disabled platform responses.
- Platform-provided error messages are sanitized before returning to clients, and resolved tenant org ids are checked against authenticated sessions when Platform supplies an org mapping.
- Added tests proving opt-in behavior, real-fetch `x-a1-request-host` propagation to A1 Platform, token propagation, database URL and module-secret redaction, public health redaction, non-strict fail-open behavior, strict fail-closed behavior, egress blocking, disabled tenant/module blocking, sanitized strict errors, per-host cache behavior, and cross-host session replay rejection.

### Slice 145 - Tenant-Bound Public Forms and Quotes

- Public form pages and submissions now honor the resolved A1 Platform tenant org when tenant resolution is enabled.
- Public quote read and acceptance endpoints now scope token lookup by the resolved tenant org instead of relying on token-only lookup under a routed host.
- Tenant/resource mismatches return `404` so public callers cannot distinguish missing resources from resources that belong to another tenant.
- Single-tenant/local behavior is unchanged when Platform tenant resolution is disabled or a non-blocking lookup fails open.
- Added Platform-enabled tests proving wrong-host and unmapped-host form pages/submissions and quote reads/accepts are hidden with generic missing-resource responses, and that blocked form submissions and quote acceptances do not mutate the owning tenant.

### Slice 146 - Authenticated Unmapped Tenant Fail-Closed

- Authenticated Studio routes now reject a resolved A1 Platform tenant that lacks a local org mapping, even outside strict mode, using `403 A1_PLATFORM_TENANT_ORG_UNMAPPED`.
- Non-strict `tenant:null` lookup behavior still fails open for local/single-tenant continuity, matching the existing Platform bridge policy.
- Public form and quote tenant scoping remains separate and continues to hide wrong-host or unmapped-host anonymous resources with generic missing-resource responses.
- Added Platform-enabled tests covering `tenant:null` fail-open and resolved-unmapped tenant rejection on `/api/me`, `/api/suite`, and `/api/platform/tenant`.

### Slice 147 - Unmapped Tenant Login Fail-Closed

- Password login now applies the resolved-tenant org mapping guard after credential verification and before MFA challenge or session creation.
- MFA login verification now runs the same tenant guard after a valid challenge/user is known but before marking the challenge verified, updating the factor, creating a session, or setting a cookie.
- Non-strict `tenant:null` lookup behavior, invalid-credential handling, auth rate limits, disabled/module tenant blocking, and generic public-resource 404 behavior remain unchanged.
- Added Platform-enabled tests proving resolved-unmapped tenants block password login without cookies/sessions, block MFA session issuance without mutating the challenge, and still reject mapped-host session replay on authenticated routes.

### Slice 148 - Platform Auth Failure Fail-Closed

- A1 Platform auth/config failures now remain blocking even when `A1_PLATFORM_TENANT_STRICT` is off, so a bad Platform token cannot silently disable tenant enforcement.
- Temporary lookup failures, generic Platform unavailability, and non-strict `tenant:null` responses still preserve the local-first fail-open path.
- Sanitized client messages now distinguish tenant availability blocks from Platform lookup/auth failures without leaking raw Platform messages, tokens, database URLs, or secrets.
- Added Platform-enabled tests proving non-strict `PLATFORM_AUTH_FAILED` returns sanitized `401`, blocks password login, emits no cookie, and creates no local session.

### Slice 149 - Platform Tenant Auth-Cache Hardening

- A1 Platform `401`/`403` responses now default to `PLATFORM_AUTH_FAILED` even when the response body is missing, malformed, not an object, or carries an unrecognized gateway auth code, preserving fail-closed tenant enforcement outside strict mode.
- Tenant cache keys now include strict-mode state and a short SHA-256 fingerprint of the Platform token, so token rotation or strict-mode changes cannot reuse stale cached tenant/null decisions.
- Raw Platform messages remain sanitized before reaching clients, and token/database/secrets are not exposed in auth failure responses.
- Temporary Platform outages and non-strict `tenant:null` responses still preserve the local-first fail-open path.
- Added Platform-enabled tests proving auth statuses block health/login without cookies or sessions, unrecognized coded auth responses stay sanitized, token changes bypass stale cached tenant decisions, and strict-mode changes bypass stale cached null decisions.

### Slice 150 - Platform Public Resource Lookup-Failure Guard

- Non-strict temporary A1 Platform tenant lookup failures now keep `/api/health` and authenticated local continuity fail-open, but tenant-bound anonymous public resources no longer fall back to unscoped lookup.
- Public form pages/submissions and public quote read/accept endpoints treat lookup failure as an unmapped public-resource tenant and return the same generic `404` shape used for missing or wrong-tenant resources.
- Blocked public form submissions do not create CRM leads, and blocked public quote acceptance leaves the quote in `sent` state.
- Existing opt-in behavior, strict fail-closed behavior, non-strict `tenant:null` authenticated continuity, and wrong-host/unmapped-host generic 404 behavior remain unchanged.
- Added Platform-enabled tests proving health continuity plus generic public-resource 404s and no mutation under temporary Platform lookup failure.

### Slice 151 - Public Evidence Attribution Guard

- Anonymous public form submissions no longer synthesize the human Owner as the creator/actor for generated CRM leads.
- Public form-created CRM leads keep `created_by_user_id` null, `crm.lead.created` suite events keep `actor_user_id` null, and `crm.lead.created` / `forms.submission.received` audit rows keep `user_id` null while preserving org-scoped evidence and CRM routing.
- Public quote acceptance evidence now stores the direct request socket IP; forwarded proxy headers are only a fallback when no direct IP is available, so attacker-controlled `x-forwarded-for` cannot override local evidence.
- Added focused tests proving anonymous public form attribution across lead, audit, and timeline evidence, plus direct-IP storage for unauthenticated quote acceptance.

### Slice 152 - Public Form and Session Edge Guard

- Anonymous public form-page lookups (`GET /f/:id`) are now per-IP rate limited before DB lookup/rendering, so form-id enumeration receives `429` while a fresh IP can still load a published form.
- The public form-page lookup throttle is enforced even when tunnel/reverse-proxy traffic reaches Fastify as loopback, while existing local-operator loopback exemptions remain in place for auth/setup and public quote acceptance flows.
- Bearer-authenticated `/api/logout` now revokes the bearer token, matching cookie-session logout semantics.
- `getUserBySession` carries `mfa_verified`, and privileged Owner/Admin sessions created before MFA activation are rejected once an active MFA factor exists unless the session was completed through MFA.
- Added focused tests for public form-page enumeration throttling, loopback/tunnel form-page throttling, stale pre-MFA privileged session rejection, bearer logout revocation, plus public quote regression coverage to keep unrelated quote acceptances from sharing one loopback bucket.

### Slice 153 - Trusted Proxy Public Client Guard

- Added explicit opt-in public client IP resolution for tunnel/reverse-proxy deployments through `ARMOSPHERA_ONE_PUBLIC_TRUSTED_PROXY_IPS` plus `ARMOSPHERA_ONE_PUBLIC_CLIENT_IP_HEADER`.
- Forwarded headers are ignored by default and only honored when the direct peer is configured as trusted; supported headers are `cf-connecting-ip`, `x-real-ip`, and sanitized single-value `x-forwarded-for`.
- Multi-value or malformed `x-forwarded-for` falls back to the direct trusted proxy IP but uses a non-exempt proxy rate-limit bucket, so spoofed left-most values cannot bypass login/public throttles.
- Auth login/MFA, public form page/submit, and public quote read/accept limits use the trusted public client identity; public form submissions and quote acceptance evidence store the resolved evidence IP only when trust is explicitly configured.
- Added parser, auth, public form, and public quote regression tests covering untrusted spoofed headers, trusted loopback proxy clients, malformed XFF, and evidence behavior.

### Slice 154 - Public Loopback API Throttle Guard

- Public form submissions and public quote read/accept endpoints now use the non-loopback-exempt public limiter, matching the already-hardened `/f/:id` rendered form page.
- Loopback traffic remains exempt for local operator login/setup flows, but anonymous public API traffic that arrives through a tunnel or reverse proxy as `127.0.0.1` now receives bounded bursts followed by `429`.
- Document signing consent evidence now uses the same explicit trusted-proxy public client identity resolver as public quote and form evidence, while untrusted forwarded headers remain ignored.
- Long clinic workflow tests now simulate separate public quote buyers with distinct public IPs instead of relying on one shared loopback client, keeping production throttling strict without making fixtures brittle.
- Added regression tests for loopback public form-submit spam, loopback public quote token enumeration, loopback public quote accept attempts, and trusted/untrusted document signature evidence.

### Slice 155 - Platform Tenant-Null Public Resource Guard

- Successful A1 Platform `tenant:null` responses now keep authenticated Studio continuity fail-open outside strict mode, but no longer let anonymous tenant-bound public resources fall back to unscoped local lookup.
- Public form pages/submissions and public quote read/accept endpoints treat `tenant:null` as an unmapped public-resource tenant and return the same generic `404` shape used for missing, wrong-host, unmapped-host, and lookup-failure resources.
- Blocked public form submissions do not create CRM leads, and blocked public quote acceptance leaves the quote in `sent` state.
- Existing local/single-tenant behavior remains unchanged when Platform tenant resolution is disabled, and authenticated `/api/me` still works for non-strict `tenant:null` continuity.
- Added Platform-enabled tests proving health continuity plus generic public-resource `404`s and no mutation under successful `tenant:null` lookup.

### Slice 156 - Webhook Credentialed URL Guard

- Outbound webhook endpoint URLs containing username/password userinfo are now rejected before mutation, preventing credentialed targets from being persisted, listed, delivered to, or included in backup/restore context.
- Rejection uses the existing invalid-URL path and keeps the full credentialed URL and password out of the response body.
- Added a regression test proving the rejected URL is absent from the webhook endpoint list and database table after the failed create attempt.

### Slice 157 - Evidence Packet Reader Guard

- Signature evidence packets, privacy export packets, privacy retention assessments, and finance SRC exports now support formatter-level `includePayload` controls for broad list/suite reads.
- Full signature/privacy evidence payloads, checksums, and source keys are visible only to Owner/Admin/Lawyer/Auditor roles; full finance SRC evidence is visible only to Owner/Admin/Accountant/Auditor roles.
- Unsupported authenticated roles still receive stable packet summaries, but `payload`, `checksum`, and `sourceKey` are nulled so broad `/api/suite`, `/api/docs/signature-packets`, `/api/privacy/requests`, and `/api/finance/src-exports` reads do not leak customer tax IDs, signer evidence, source keys, or packet internals.
- Added route-level regression coverage with seeded sentinel evidence proving Support receives redacted summaries while Lawyer/Accountant users retain their permitted packet payload access.

### Slice 158 - Event Feed Payload Reader Guard

- Suite timeline reads now support role-aware payload inclusion through `eventFeedOptions(user)`.
- `/api/events`, event-returning mutation responses, and `/api/suite` redact sensitive event payload keys for non-audit roles while preserving stable operational identifiers such as quote numbers.
- Owner/Admin/Auditor still receive full timeline payload evidence for review and audit workflows.
- Unoptioned internal event-feed reads now default to redacted payloads, so forgotten call-site options fail closed instead of exposing raw timeline payloads.
- Added regression coverage proving Support cannot read quote acceptance signer email/name/total from customer event feeds, `/api/suite`, or a service-case mutation response, while Owner retains the full payload on explicitly full-access event reads.
- Customer 360 intentionally fetches full timeline payloads before applying its own role policy, preserving Owner/Admin full-customer360 evidence while Support still receives redacted timeline payloads.

### Slice 159 - Forms Submission Detail Reader Guard

- Authenticated Forms list/detail routes now use a dedicated `requireFormsReader` gate instead of plain authentication.
- Campaign-enabled roles and existing forms-writer roles, including Service Manager, can read form definitions and submissions; the read-only Auditor keeps explicit review access; Support is blocked from private intake submissions because Support lacks Campaigns access.
- Public published-form submission remains unauthenticated, rate-limited, key-whitelisted, and unchanged.
- Added regression coverage proving Support receives `403` and no submitted email/message content, while Salesperson, Service Manager, and Auditor can still read the submitted form detail.

### Slice 160 - Integration Connector Credential Guard

- Integration connector configuration now rejects endpoint URLs containing username/password userinfo before the connector row is inserted or updated.
- Endpoint URLs are validated on the raw trimmed value before the persisted 260-character limit is applied, so long credentialed URLs cannot hide userinfo past truncation.
- The rejection path uses a sanitized `400` response that does not echo the full credentialed URL or password material.
- Failed connector configuration leaves list responses, secret fingerprints, and persisted connector rows unchanged, so credentialed endpoints cannot leak through connector inventory or backup-scoped connector data.
- Legacy unsafe endpoint values already present in storage are hidden from connector list and health-check responses; the health check reports a missing endpoint instead of echoing stored credentials or truncated credential fragments.
- Added regression coverage for WhatsApp Business configuration proving raw and long credentialed URLs plus submitted secret fingerprints are absent after rejection, and legacy stored unsafe endpoint URLs are not surfaced by list or health-check APIs.

### Slice 161 - Copilot Launcher Route

- The Legal & Accounting Copilot is now a first-class launcher app, seeded with priority 3 between CRM/Finance and the remaining Suite modules.
- Existing local databases receive the Copilot app and least-privilege role assignments on reopen without requiring a fresh seed.
- Workspace app selection now follows `/app/<id>` routes, pushes history when a user opens another app, and respects browser back/forward navigation.
- App panels expose stable in-page anchors for launcher navigation; `/app/copilot` renders the Copilot panel as the active workspace.
- Added regression coverage for fresh and existing database app entitlements, plus rendered Playwright proof for Copilot to Finance route switching and back navigation.
