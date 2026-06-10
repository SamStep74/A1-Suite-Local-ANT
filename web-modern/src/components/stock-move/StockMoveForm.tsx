/**
 * StockMoveForm — inline form for POST /api/inventory/moves.
 *
 * Used at /app/inventory/moves for manual stock entries, and as the
 * mutation target for the Inventory Risk Agent's "replenish"
 * suggestion. The form pre-fills when given an `initial` payload
 * (the agent suggestion) so the user can review and tweak before
 * approving.
 *
 * The mutation posts to /api/inventory/moves, then invalidates the
 * relevant TanStack Query keys (stock, moves) so the lists refresh.
 */

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { postJson } from "../../lib/api/client";
import {
  CreateStockMoveInputSchema,
  CreateStockMoveResponseSchema,
  StockMoveType,
  type CreateStockMoveInput,
  type CreateStockMoveResponse,
  type StockLocation,
} from "../../lib/api/schemas";
import { Button } from "../ui/Button";
import { cn } from "../../lib/utils/cn";
import { money } from "../../lib/utils/money";

export interface StockMoveFormProps {
  /** Pre-fill (used by the Inventory Risk Agent). */
  initial?: Partial<CreateStockMoveInput> & { unitCost?: number };
  /** Catalog item id, optional — when present we lock the form to that item. */
  catalogItemId?: string;
  /** All known locations, for the source/destination pickers. */
  locations: ReadonlyArray<StockLocation>;
  /** Hide the catalog item field (when the parent already shows the item). */
  hideCatalogItem?: boolean;
  /** Optional className. */
  className?: string;
  /** Fires after a successful submit. */
  onSuccess?: (move: CreateStockMoveResponse["move"]) => void;
}

export function StockMoveForm({
  initial,
  catalogItemId,
  locations,
  hideCatalogItem,
  className,
  onSuccess,
}: StockMoveFormProps) {
  const queryClient = useQueryClient();
  const [itemId, setItemId] = useState(initial?.catalogItemId ?? catalogItemId ?? "");
  const [moveType, setMoveType] = useState<CreateStockMoveInput["moveType"]>(
    initial?.moveType ?? "receipt",
  );
  const [sourceId, setSourceId] = useState(initial?.sourceLocationId ?? "");
  const [destId, setDestId] = useState(initial?.destinationLocationId ?? "");
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [unitCost, setUnitCost] = useState(
    initial?.unitCost != null ? String(initial.unitCost) : "",
  );
  const [reason, setReason] = useState(initial?.reason ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [error, setError] = useState<string | null>(null);

  const submitMut = useMutation({
    mutationFn: async () => {
      // Build a candidate and validate client-side so the user sees
      // field-level errors instead of a generic 400.
      const candidate = {
        catalogItemId: itemId,
        sourceLocationId: sourceId || undefined,
        destinationLocationId: destId || undefined,
        moveType,
        quantity: Number(quantity),
        unitCost: unitCost === "" ? undefined : Number(unitCost),
        reason: reason || undefined,
        reference: reference || undefined,
      };
      const parsed = CreateStockMoveInputSchema.safeParse(candidate);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      }
      return postJson("/api/inventory/moves", parsed.data, CreateStockMoveResponseSchema);
    },
    onSuccess: (data) => {
      setError(null);
      // Invalidate stock + moves so lists refresh
      queryClient.invalidateQueries({ queryKey: ["stock"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-moves"] });
      onSuccess?.(data.move);
      // Reset only the volatile fields, keep the user's location
      // choice so they can post the next move quickly.
      setQuantity("1");
      setReason("");
      setReference("");
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Failed to post move");
    },
  });

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submitMut.mutate();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3",
        className,
      )}
    >
      <h3 className="text-[var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        New stock move
      </h3>

      {!hideCatalogItem && (
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Catalog item ID</span>
          <input
            type="text"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            required
            placeholder="ci-…"
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          />
        </label>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Move type</span>
          <select
            value={moveType}
            onChange={(e) =>
              setMoveType(
                StockMoveType.parse(
                  e.target.value as CreateStockMoveInput["moveType"],
                ),
              )
            }
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
          >
            {StockMoveType.options.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Quantity</span>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] tabular-nums"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Source (optional)</span>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
          >
            <option value="">— none —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Destination</span>
          <select
            value={destId}
            onChange={(e) => setDestId(e.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
          >
            <option value="">— none —</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Unit cost (optional)</span>
          <input
            type="number"
            min={0}
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            placeholder={money(0)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)] tabular-nums"
          />
        </label>

        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Reference (optional)</span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="PO-2026-007"
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[var(--text-sm)]">
        <span className="text-[var(--color-muted)]">Reason (optional)</span>
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Vendor delivery"
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-base)]"
        />
      </label>

      {error && (
        <p role="alert" className="text-[var(--text-sm)] text-[var(--color-ruby,#b23a48)]">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          leadingIcon={<Plus className="size-3.5" />}
          loading={submitMut.isPending}
        >
          Post move
        </Button>
      </div>
    </form>
  );
}
