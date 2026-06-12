/**
 * panel-helpers.ts — co-panel-specific helpers for the Compliance
 * production-readiness surface (Phase 8.10 layer 2).
 *
 * Why a sibling file: the cross-cutting helpers in `./status.ts` are
 * owned by Worker 1 (the schemas+helpers branch, merged to
 * `ant/main` as part of the layer-1 commit). Worker 1 deliberately
 * scoped those helpers to the data layer — they take primitive
 * scalars (`status: "ready"|"blocked"`, `pass: boolean`,
 * `reviewRequired: boolean`) so they are reusable from any future
 * surface (email digests, webhooks, etc.) without dragging the
 * full readiness object shape.
 *
 * The co-panel, by contrast, is a render-layer component. It works
 * directly off `ProductionReadinessReadiness` (the parsed payload
 * the route hands it) and needs the *Armenian-first* status copy
 * for the top-right pill and the meta-row review flag — which are
 * UI concerns, not data concerns. To avoid touching Worker 1's
 * `./status.ts` (and risking a re-merge conflict on a file Worker 1
 * is the canonical owner of), the Armenian wrappers live here.
 *
 * Public surface:
 *  - formatProductionStatusLabelHy → Armenian H2 copy for the
 *    status pill ("Պատրաստ է" / "Արգելափակված է").
 *  - formatProductionReviewFlagArm → Armenian copy for the
 *    meta-row review flag ("Արտադրական պատրաստ" /
 *    "Վերանայում է պահանջվում"), e2e contract.
 */
import type { ProductionReadinessReadiness } from "../api/schemas";

/**
 * Armenian label for the top-of-panel status pill. Mirrors the
 * English copy in `status.ts#formatProductionStatusLabel` so the
 * pill renders "Պատրաստ է (Ready)" / "Արգելափակված է (Blocked)".
 * The Armenian-first bilingual style matches the rest of the
 * modern shell (see the cabinet + cfo routes).
 */
export function formatProductionStatusLabelHy(
  readiness: Pick<ProductionReadinessReadiness, "status">,
): "Պատրաստ է" | "Արգելափակված է" {
  return readiness.status === "ready" ? "Պատրաստ է" : "Արգելափակված է";
}

/**
 * Armenian copy for the right-hand span of the meta row (the
 * operator's at-a-glance verdict). Mirrors the English copy in
 * `status.ts#formatProductionReviewFlag` but renders in Armenian
 * so the e2e spec (which asserts the Armenian label) and the
 * Armenian-first bilingual style of the modern shell both pass.
 *
 *   - reviewRequired: true  → "Վերանայում է պահանջվում"
 *     (review required)
 *   - reviewRequired: false → "Արտադրական պատրաստ"
 *     (production-ready)
 */
export function formatProductionReviewFlagArm(
  readiness: Pick<ProductionReadinessReadiness, "reviewRequired">,
): "Արտադրական պատրաստ" | "Վերանայում է պահանջվում" {
  return readiness.reviewRequired
    ? "Վերանայում է պահանջվում"
    : "Արտադրական պատրաստ";
}
