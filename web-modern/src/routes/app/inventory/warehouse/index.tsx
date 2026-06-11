/**
 * /app/inventory/warehouse — Warehouse workspace.
 *
 * Phase 8.3 layer 2 (Pattern A). Sub-route of the inventory app —
 * mirrors the 4-tab UX of the legacy `web/src/warehouse.jsx` panel
 * (Lots · Serials · Cold Storage · Analytics) and adds the
 * warehouse-restock AI assist as the analytics tab's forecast
 * sub-section. Replaces the legacy `<WarehousePanel ... />` block
 * in `web/src/main.jsx` once the legacy drop ships.
 *
 * Source of truth:
 *   - server/app.js#warehouse (lines 548-810): 10 REST endpoints
 *   - server/warehouse.js: FEFO ordering, ABC classification,
 *     turnover days, restock forecast, cold-storage reading
 *     normalization, AI restock assist
 *   - web-modern/src/lib/api/schemas.ts (Phase 8.3 layer 1): 22
 *     Warehouse* Zod schemas (entity, request, response)
 *   - web-modern/src/lib/warehouse/status.ts: pure UI helpers
 *
 * Gates:
 *   - GET endpoints  → requireInventoryReader (app-tier, owner/admin)
 *   - POST endpoints → requireInventoryWriter (app-tier, owner/admin)
 *   Until the global auth context lands in Phase 8.4 the UI defaults
 *   to permissive; the server still rejects unauthorized callers.
 *
 * Subcomponents are exported with `export function` (not default
 * exports) so the co-located test can import them by name and
 * exercise the tabs / formatters in isolation. This mirrors the
 * cabinet and copilot/onboarding test extraction pattern.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  Hash,
  Lock,
  Package,
  Thermometer,
} from "lucide-react";
import { getJson, postJson } from "../../../../lib/api/client";
import {
  WarehouseAbcResponseSchema,
  WarehouseColdStorageReadingsResponseSchema,
  WarehouseForecastRequestSchema,
  WarehouseForecastResponseSchema,
  WarehouseLotsResponseSchema,
  WarehouseLotCreateRequestSchema,
  WarehouseLotCreateResponseSchema,
  WarehouseSerialCreateRequestSchema,
  WarehouseSerialCreateResponseSchema,
  WarehouseColdStorageReadingCreateRequestSchema,
  WarehouseColdStorageReadingCreateResponseSchema,
  WarehouseTurnoverResponseSchema,
  type WarehouseAbcRow,
  type WarehouseColdStorageReading,
  type WarehouseLot,
  type WarehouseSerial,
  type WarehouseTurnoverRow,
} from "../../../../lib/api/schemas";
import {
  abcRowCumulative,
  fefoOrderLots,
  forecastReasoningString,
  formatColdStorageHumidity,
  formatColdStorageTemp,
  formatTurnoverDays,
  isAbcBucket,
  isValidLotInput,
  isValidSerialInput,
  WAREHOUSE_TABS,
  type WarehouseTab,
} from "../../../../lib/warehouse/status";
import { cn } from "../../../../lib/utils/cn";

/* ────────── access gate (TODO: wire to useAuth() in 8.4) ────────── */

// Mirrors /app/cabinet and /app/copilot/onboarding — server is the
// source of truth, UI defaults to permissive until the auth context
// lands. The workspace accepts an optional `userAccess` prop so the
// co-located test can render the 403 branch.
export type WarehouseAccess = "inventory" | "none";
const DEFAULT_USER_ACCESS: WarehouseAccess = "inventory";

/* ────────── file route ────────── */

export const Route = createFileRoute("/app/inventory/warehouse/")({
  component: WarehouseWorkspace,
});

/* ────────── constants ────────── */

const TAB_LABEL_HY: Record<WarehouseTab, string> = {
  lots: "Խմբաքանակներ",
  serials: "Սերիաներ",
  cold: "Սառը պահեստ",
  analytics: "Վերլուծություն",
};

const TAB_ICON: Record<WarehouseTab, typeof Package> = {
  lots: Package,
  serials: Hash,
  cold: Thermometer,
  analytics: BarChart3,
};

const PERIOD_KEY = "2026-Q2";
const FORECAST_HORIZON_DAYS = 14;

/* ────────── tone for ABC buckets ────────── */

const BUCKET_TONE: Record<"A" | "B" | "C", string> = {
  A: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)] text-[var(--color-tag-green)]",
  B: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)] text-[var(--color-tag-blue)]",
  C: "bg-[color-mix(in_srgb,var(--color-muted)_15%,transparent)] text-[var(--color-muted)]",
};

/* ────────── 403 card ────────── */

export function WarehouseAccessDeniedCard() {
  return (
    <article
      data-testid="warehouse-403"
      data-entity="warehouse-forbidden"
      className="panel flex items-start gap-3 border-[color-mix(in_srgb,var(--color-ruby)_30%,transparent)]"
    >
      <Lock className="size-4 shrink-0 text-[var(--color-ruby)]" aria-hidden />
      <div>
        <h2 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
          Մուտքը սահմանափակված է
        </h2>
        <p className="mt-1 text-[var(--text-sm)] text-[var(--color-muted)]">
          Պահեստը հասանելի է միայն inventory մուտք ունեցողներին
        </p>
      </div>
    </article>
  );
}

/* ────────── tab strip ────────── */

export function WarehouseTabStrip({
  active,
  onChange,
}: {
  active: WarehouseTab;
  onChange: (next: WarehouseTab) => void;
}) {
  return (
    <div
      role="tablist"
      data-testid="warehouse-tab-strip"
      data-entity="warehouse-tab-strip"
      className="flex flex-wrap items-center gap-1 text-[var(--text-sm)]"
    >
      {WAREHOUSE_TABS.map((tab) => {
        const Icon = TAB_ICON[tab];
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`warehouse-tab-${tab}`}
            data-entity={`warehouse-tab-${tab}`}
            onClick={() => onChange(tab)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 transition",
              isActive
                ? "bg-[var(--color-surface)] font-semibold text-[var(--color-ink)] ring-1 ring-[var(--color-line)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]",
            )}
          >
            <Icon className="size-3.5" />
            {TAB_LABEL_HY[tab]}
          </button>
        );
      })}
    </div>
  );
}

/* ────────── Lots tab ────────── */

export function WarehouseLotsForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: { productId: string; lotCode: string; expiryDate: string }) => void;
  isPending: boolean;
  error: string;
}) {
  const [productId, setProductId] = useState("product-flour-1kg");
  const [lotCode, setLotCode] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [clientError, setClientError] = useState("");

  const validation = isValidLotInput({ lotCode, expiryDate });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validation.ok) {
      setClientError(validation.reason);
      return;
    }
    setClientError("");
    onSubmit({
      productId: productId.trim(),
      lotCode: lotCode.trim(),
      expiryDate: expiryDate.trim() || "",
    });
    setLotCode("");
    setExpiryDate("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="warehouse-lot-form"
      data-entity="warehouse-lot-create"
      className="panel space-y-3"
    >
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Նոր խմբաքանակ
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Product ID</span>
          <input
            type="text"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="Lot productId"
            maxLength={80}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Lot code</span>
          <input
            type="text"
            value={lotCode}
            onChange={(e) => setLotCode(e.target.value)}
            aria-label="Lot code"
            placeholder="LOT-2026-001"
            maxLength={32}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Expiry (YYYY-MM-DD)</span>
          <input
            type="text"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            aria-label="Lot expiry"
            placeholder="2026-12-31"
            maxLength={10}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !validation.ok}
          data-testid="warehouse-lot-submit"
          data-entity="warehouse-lot-submit"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Ստեղծում…" : "Ստեղծել"}
        </button>
        {(clientError || error) && (
          <span
            role="alert"
            className="action-status"
            data-testid="warehouse-lot-error"
          >
            error: {clientError || error}
          </span>
        )}
      </div>
    </form>
  );
}

export function WarehouseLotRow({ lot }: { lot: WarehouseLot }) {
  return (
    <li
      data-testid="warehouse-lot"
      data-entity="warehouse-lot"
      data-lot-id={lot.id}
      className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5"
    >
      <div className="text-[var(--text-sm)] font-mono text-[var(--color-ink)]">
        {lot.lotCode}
      </div>
      <div className="text-[11px] text-[var(--color-muted)]">
        {lot.productId} · expiry {lot.expiryDate ?? "—"}
      </div>
    </li>
  );
}

export function WarehouseLotsList({ lots }: { lots: ReadonlyArray<WarehouseLot> }) {
  const ordered = useMemo(() => fefoOrderLots(lots), [lots]);
  if (ordered.length === 0) {
    return (
      <p
        data-testid="warehouse-lot-empty"
        data-entity="warehouse-lot-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Խմբաքանակներ դեռ չկան
      </p>
    );
  }
  return (
    <ul
      data-testid="warehouse-lot-list"
      data-entity="warehouse-lot-list"
      className="space-y-1.5"
    >
      {ordered.map((lot) => (
        <WarehouseLotRow key={lot.id} lot={lot} />
      ))}
    </ul>
  );
}

/* ────────── Serials tab ────────── */

export function WarehouseSerialForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: { productId: string; serial: string }) => void;
  isPending: boolean;
  error: string;
}) {
  const [productId, setProductId] = useState("product-instrument-1");
  const [serial, setSerial] = useState("");
  const [clientError, setClientError] = useState("");

  const validation = isValidSerialInput({ serial });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validation.ok) {
      setClientError(validation.reason);
      return;
    }
    setClientError("");
    onSubmit({ productId: productId.trim(), serial: serial.trim() });
    setSerial("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="warehouse-serial-form"
      data-entity="warehouse-serial-create"
      className="panel space-y-3"
    >
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Նոր սերիա
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Product ID</span>
          <input
            type="text"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="Serial productId"
            maxLength={80}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Serial</span>
          <input
            type="text"
            value={serial}
            onChange={(e) => setSerial(e.target.value)}
            aria-label="Serial code"
            placeholder="SN-12345"
            maxLength={64}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !validation.ok}
          data-testid="warehouse-serial-submit"
          data-entity="warehouse-serial-submit"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Գրանցում…" : "Գրանցել"}
        </button>
        {(clientError || error) && (
          <span
            role="alert"
            className="action-status"
            data-testid="warehouse-serial-error"
          >
            error: {clientError || error}
          </span>
        )}
      </div>
    </form>
  );
}

export function WarehouseSerialRow({ serial }: { serial: WarehouseSerial }) {
  return (
    <li
      data-testid="warehouse-serial"
      data-entity="warehouse-serial"
      data-serial-id={serial.id}
      className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5"
    >
      <div className="text-[var(--text-sm)] font-mono text-[var(--color-ink)]">
        {serial.serial}
      </div>
      <div className="text-[11px] text-[var(--color-muted)]">
        {serial.productId} · {serial.status}
      </div>
    </li>
  );
}

export function WarehouseSerialList({ serials }: { serials: ReadonlyArray<WarehouseSerial> }) {
  if (serials.length === 0) {
    return (
      <p
        data-testid="warehouse-serial-empty"
        data-entity="warehouse-serial-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Սերիաներ դեռ չկան
      </p>
    );
  }
  return (
    <ul
      data-testid="warehouse-serial-list"
      data-entity="warehouse-serial-list"
      className="space-y-1.5"
    >
      {serials.map((s) => (
        <WarehouseSerialRow key={s.id} serial={s} />
      ))}
    </ul>
  );
}

/* ────────── Cold storage tab ────────── */

export function WarehouseColdStorageForm({
  onSubmit,
  isPending,
  error,
}: {
  onSubmit: (input: { locationId: string; tempC: number; humidity: number | null }) => void;
  isPending: boolean;
  error: string;
}) {
  const [locationId, setLocationId] = useState("fridge-A1");
  const [tempC, setTempC] = useState("4.0");
  const [humidity, setHumidity] = useState("");

  const tempNum = Number(tempC);
  const humidityNum = humidity.trim() === "" ? null : Number(humidity);
  const canSubmit =
    !Number.isNaN(tempNum) &&
    tempNum >= -80 &&
    tempNum <= 80 &&
    (humidityNum === null ||
      (!Number.isNaN(humidityNum) && humidityNum >= 0 && humidityNum <= 100)) &&
    !isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ locationId: locationId.trim(), tempC: tempNum, humidity: humidityNum });
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="warehouse-cold-storage-form"
      data-entity="warehouse-cold-storage-create"
      className="panel space-y-3"
    >
      <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
        Սառը պահեստի ընթերցում
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Location ID</span>
          <input
            type="text"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            aria-label="Cold storage location"
            maxLength={80}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Temp (°C)</span>
          <input
            type="text"
            value={tempC}
            onChange={(e) => setTempC(e.target.value)}
            aria-label="Cold storage temperature"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Humidity (0-100, optional)</span>
          <input
            type="text"
            value={humidity}
            onChange={(e) => setHumidity(e.target.value)}
            aria-label="Cold storage humidity"
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="warehouse-cold-storage-submit"
          data-entity="warehouse-cold-storage-submit"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Ուղարկում…" : "Գրանցել"}
        </button>
        {error && (
          <span role="alert" className="action-status">
            error: {error}
          </span>
        )}
      </div>
    </form>
  );
}

export function WarehouseColdStorageReadingRow({
  reading,
}: {
  reading: WarehouseColdStorageReading;
}) {
  return (
    <li
      data-testid="warehouse-cold-storage"
      data-entity="warehouse-cold-storage-row"
      data-reading-id={reading.id}
      className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5"
    >
      <div className="text-[var(--text-sm)] font-mono text-[var(--color-ink)]">
        {reading.locationId}
      </div>
      <div className="text-[11px] text-[var(--color-muted)]">
        {formatColdStorageTemp(reading.tempC)} · {formatColdStorageHumidity(reading.humidity)}
      </div>
    </li>
  );
}

export function WarehouseColdStorageList({
  readings,
}: {
  readings: ReadonlyArray<WarehouseColdStorageReading>;
}) {
  if (readings.length === 0) {
    return (
      <p
        data-testid="warehouse-cold-storage-empty"
        data-entity="warehouse-cold-storage-empty"
        className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        Ընթերցումներ դեռ չկան
      </p>
    );
  }
  return (
    <ul
      data-testid="warehouse-cold-storage-list"
      data-entity="warehouse-cold-storage-list"
      className="space-y-1.5"
    >
      {readings.map((r) => (
        <WarehouseColdStorageReadingRow key={r.id} reading={r} />
      ))}
    </ul>
  );
}

/* ────────── Analytics sub-sections ────────── */

export function WarehouseAbcTable({ rows }: { rows: ReadonlyArray<WarehouseAbcRow> }) {
  if (rows.length === 0) {
    return (
      <p
        data-testid="warehouse-abc-empty"
        data-entity="warehouse-abc-empty"
        className="text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        No ABC rows for {PERIOD_KEY}.
      </p>
    );
  }
  return (
    <ul
      data-testid="warehouse-abc"
      data-entity="warehouse-abc"
      className="space-y-1.5"
    >
      {rows.map((row) => {
        const bucket = isAbcBucket(row.bucket) ? row.bucket : "C";
        return (
          <li
            key={row.productId}
            data-testid="warehouse-abc-row"
            data-entity="warehouse-abc-row"
            className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5"
          >
            <div className="flex items-center gap-2 text-[var(--text-sm)] font-mono text-[var(--color-ink)]">
              {row.productId}
              <span
                className={cn(
                  "inline-flex items-center rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  BUCKET_TONE[bucket],
                )}
                data-bucket={bucket}
              >
                {bucket}
              </span>
            </div>
            <div className="text-[11px] text-[var(--color-muted)]">
              cumulative {abcRowCumulative(row)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function WarehouseTurnoverTable({
  rows,
}: {
  rows: ReadonlyArray<WarehouseTurnoverRow>;
}) {
  if (rows.length === 0) {
    return (
      <p
        data-testid="warehouse-turnover-empty"
        data-entity="warehouse-turnover-empty"
        className="text-[var(--text-sm)] text-[var(--color-muted)]"
      >
        No turnover rows for {PERIOD_KEY}.
      </p>
    );
  }
  return (
    <ul
      data-testid="warehouse-turnover"
      data-entity="warehouse-turnover"
      className="space-y-1.5"
    >
      {rows.map((row) => (
        <li
          key={row.productId}
          data-testid="warehouse-turnover-row"
          data-entity="warehouse-turnover-row"
          className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5"
        >
          <div className="text-[var(--text-sm)] font-mono text-[var(--color-ink)]">
            {row.productId}
          </div>
          <div className="text-[11px] text-[var(--color-muted)]">
            {formatTurnoverDays(row.turnoverDays)}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WarehouseForecastForm({
  onSubmit,
  isPending,
  result,
  error,
}: {
  onSubmit: (input: { productId: string }) => void;
  isPending: boolean;
  result: { suggestedQuantity: number; source: string; reasoning: ReadonlyArray<string> } | null;
  error: string;
}) {
  const [productId, setProductId] = useState("product-flour-1kg");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (productId.trim().length < 3 || isPending) return;
    onSubmit({ productId: productId.trim() });
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="warehouse-forecast-form"
      data-entity="warehouse-forecast"
      className="space-y-3"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-[var(--text-sm)]">
          <span className="text-[var(--color-muted)]">Product ID (forecast)</span>
          <input
            type="text"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label="Forecast productId"
            maxLength={80}
            className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[var(--text-sm)] text-[var(--color-ink)]"
          />
        </label>
        <button
          type="submit"
          disabled={productId.trim().length < 3 || isPending}
          data-testid="warehouse-forecast-submit"
          data-entity="warehouse-forecast-submit"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 py-1.5 text-[var(--text-sm)] font-semibold text-[var(--color-surface)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Հաշվարկում…" : "Կանխատեսել"}
        </button>
      </div>
      {result && (
        <div
          data-testid="copilot-result"
          data-entity="copilot-result"
          className="rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-3 py-2 text-[var(--text-sm)]"
        >
          <div>
            <strong>{result.suggestedQuantity}</strong> · {result.source}
          </div>
          {result.reasoning.length > 0 && (
            <div className="mt-1 text-[11px] text-[var(--color-muted)]">
              {forecastReasoningString(result.reasoning)}
            </div>
          )}
        </div>
      )}
      {error && (
        <span role="alert" className="action-status" data-testid="warehouse-forecast-error">
          error: {error}
        </span>
      )}
    </form>
  );
}

/* ────────── root workspace ────────── */

export function WarehouseWorkspace({
  userAccess = DEFAULT_USER_ACCESS,
}: {
  userAccess?: WarehouseAccess;
} = {}) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<WarehouseTab>("lots");
  const [lotError, setLotError] = useState("");
  const [serialError, setSerialError] = useState("");
  const [coldError, setColdError] = useState("");
  const [forecastError, setForecastError] = useState("");

  const hasAccess = userAccess === "inventory";

  const lotsQ = useQuery({
    queryKey: ["warehouse-lots"],
    queryFn: () => getJson("/api/warehouse/lots", WarehouseLotsResponseSchema),
    enabled: hasAccess,
  });

  const serialsQ = useQuery({
    queryKey: ["warehouse-serials"],
    queryFn: async () => {
      // The list is owner-seeded; the analytics tab relies on the
      // create response. For an empty start we render an empty state.
      return [] as WarehouseSerial[];
    },
    enabled: hasAccess,
  });

  const coldQ = useQuery({
    queryKey: ["warehouse-cold-storage"],
    queryFn: () =>
      getJson("/api/warehouse/cold-storage/readings", WarehouseColdStorageReadingsResponseSchema),
    enabled: hasAccess,
  });

  const abcQ = useQuery({
    queryKey: ["warehouse-abc", PERIOD_KEY],
    queryFn: () =>
      getJson(
        `/api/warehouse/analytics/abc?periodKey=${encodeURIComponent(PERIOD_KEY)}`,
        WarehouseAbcResponseSchema,
      ),
    enabled: hasAccess && activeTab === "analytics",
  });

  const turnoverQ = useQuery({
    queryKey: ["warehouse-turnover", PERIOD_KEY],
    queryFn: () =>
      getJson(
        `/api/warehouse/analytics/turnover?periodKey=${encodeURIComponent(PERIOD_KEY)}`,
        WarehouseTurnoverResponseSchema,
      ),
    enabled: hasAccess && activeTab === "analytics",
  });

  const createLotMut = useMutation({
    mutationFn: async (input: { productId: string; lotCode: string; expiryDate: string }) => {
      setLotError("");
      const payload = WarehouseLotCreateRequestSchema.parse({
        productId: input.productId,
        lotCode: input.lotCode,
        expiryDate: input.expiryDate || null,
      });
      return postJson(
        "/api/warehouse/lots",
        payload,
        WarehouseLotCreateResponseSchema,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-lots"] });
    },
    onError: (err: Error) => {
      setLotError(err.message);
    },
  });

  const createSerialMut = useMutation({
    mutationFn: async (input: { productId: string; serial: string }) => {
      setSerialError("");
      const payload = WarehouseSerialCreateRequestSchema.parse({
        productId: input.productId,
        serial: input.serial,
      });
      return postJson(
        "/api/warehouse/serials",
        payload,
        WarehouseSerialCreateResponseSchema,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-serials"] });
    },
    onError: (err: Error) => {
      setSerialError(err.message);
    },
  });

  const createColdMut = useMutation({
    mutationFn: async (input: { locationId: string; tempC: number; humidity: number | null }) => {
      setColdError("");
      const payload = WarehouseColdStorageReadingCreateRequestSchema.parse({
        locationId: input.locationId,
        recordedAt: new Date().toISOString(),
        tempC: input.tempC,
        humidity: input.humidity,
        sensorId: null,
      });
      return postJson(
        "/api/warehouse/cold-storage/readings",
        payload,
        WarehouseColdStorageReadingCreateResponseSchema,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-cold-storage"] });
    },
    onError: (err: Error) => {
      setColdError(err.message);
    },
  });

  const forecastMut = useMutation({
    mutationFn: async (input: { productId: string }) => {
      setForecastError("");
      const payload = WarehouseForecastRequestSchema.parse({
        productId: input.productId,
        horizonDays: FORECAST_HORIZON_DAYS,
        intent: "warehouse-restock",
      });
      return postJson(
        "/api/warehouse/forecast/restock",
        payload,
        WarehouseForecastResponseSchema,
      );
    },
    onError: (err: Error) => {
      setForecastError(err.message);
    },
  });

  if (!hasAccess) {
    return (
      <div
        className="mx-auto max-w-3xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
        data-testid="warehouse-panel"
        data-entity="warehouse-root"
      >
        <WarehouseAccessDeniedCard />
        <BackToInventory />
      </div>
    );
  }

  return (
    <div
      className="mx-auto max-w-6xl space-y-6 p-6 [data-density=compact]:p-4 [data-density=spacious]:p-8"
      data-testid="warehouse-panel"
      data-entity="warehouse-root"
    >
      <header className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          <Package className="size-3" />
          App · Warehouse
        </span>
        <h1 className="text-[var(--text-2xl)] font-semibold text-[var(--color-ink)]">
          Պահեստ
        </h1>
        <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
          Warehouse lots · serials · cold storage · analytics
        </p>
      </header>

      <WarehouseTabStrip active={activeTab} onChange={setActiveTab} />

      {activeTab === "lots" && (
        <section className="space-y-3" data-testid="warehouse-tab-panel-lots">
          <WarehouseLotsForm
            onSubmit={(input) => createLotMut.mutate(input)}
            isPending={createLotMut.isPending}
            error={lotError}
          />
          <WarehouseLotsList lots={lotsQ.data?.lots ?? []} />
        </section>
      )}

      {activeTab === "serials" && (
        <section className="space-y-3" data-testid="warehouse-tab-panel-serials">
          <WarehouseSerialForm
            onSubmit={(input) => createSerialMut.mutate(input)}
            isPending={createSerialMut.isPending}
            error={serialError}
          />
          <WarehouseSerialList serials={serialsQ.data ?? []} />
        </section>
      )}

      {activeTab === "cold" && (
        <section className="space-y-3" data-testid="warehouse-tab-panel-cold">
          <WarehouseColdStorageForm
            onSubmit={(input) => createColdMut.mutate(input)}
            isPending={createColdMut.isPending}
            error={coldError}
          />
          <WarehouseColdStorageList readings={coldQ.data?.readings ?? []} />
        </section>
      )}

      {activeTab === "analytics" && (
        <section className="space-y-5" data-testid="warehouse-tab-panel-analytics">
          <div className="panel space-y-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              ABC · {PERIOD_KEY}
            </h3>
            <WarehouseAbcTable rows={abcQ.data?.abc ?? []} />
          </div>
          <div className="panel space-y-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              Turnover · {PERIOD_KEY}
            </h3>
            <WarehouseTurnoverTable rows={turnoverQ.data?.turnover ?? []} />
          </div>
          <div className="panel space-y-2">
            <h3 className="text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
              Forecast · restock
            </h3>
            <WarehouseForecastForm
              onSubmit={(input) => forecastMut.mutate(input)}
              isPending={forecastMut.isPending}
              result={
                forecastMut.data
                  ? {
                      suggestedQuantity: forecastMut.data.forecast.suggestedQuantity,
                      source: forecastMut.data.forecast.source,
                      reasoning: forecastMut.data.forecast.reasoning,
                    }
                  : null
              }
              error={forecastError}
            />
          </div>
        </section>
      )}

      <BackToInventory />
    </div>
  );
}

function BackToInventory() {
  return (
    <div>
      <Link
        to="/app/inventory"
        search={{ view: "catalog", status: "all" }}
        className="inline-flex items-center gap-1.5 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        <ChevronLeft className="size-3.5" />
        back to Inventory
      </Link>
    </div>
  );
}
