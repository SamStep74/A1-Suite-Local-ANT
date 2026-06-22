import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  ExternalLink,
  Map as MapIcon,
  MapPin,
  Navigation,
  PlayCircle,
  Route as RouteIcon,
  Send,
} from "lucide-react";
import { getJson, postJson } from "../../../lib/api/client";
import {
  ServiceFieldVisitsResponseSchema,
  UpdateServiceFieldVisitTechnicianLocationInputSchema,
  UpdateServiceFieldVisitTechnicianLocationResponseSchema,
  type ServiceFieldVisit,
  type ServiceFieldVisitTechnicianLocation,
  type ServiceFieldVisitTechnicianStatus,
} from "../../../lib/api/schemas";
import { cn } from "../../../lib/utils/cn";
import {
  TECHNICIAN_VISIT_ACTIONS,
  canApplyTechnicianStatus,
  createQueuedTechnicianVisitStatusUpdate,
  isTerminalVisitStatus,
  normalizeVisitStatus,
  persistQueuedTechnicianVisitStatusUpdates,
  readQueuedTechnicianVisitStatusUpdates,
  sendTechnicianVisitStatusUpdate,
  shouldQueueTechnicianVisitStatusError,
  type QueuedTechnicianVisitStatusUpdate,
  type TechnicianVisitMutationInput,
  type TechnicianVisitSubmitResult,
} from "./-technician-visit-queue";

// This worker must not edit routeTree.gen.ts; the parent route-generation pass
// will add this file route to TanStack's generated route map.
export const Route = createFileRoute("/app/desk/dispatch")({
  component: DeskDispatch,
});

const VISIT_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const FIELD_VISIT_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  scheduled: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-blue)_15%,transparent)]",
    fg: "text-[var(--color-tag-blue)]",
  },
  "en-route": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-orange)_15%,transparent)]",
    fg: "text-[var(--color-tag-orange)]",
  },
  "in-progress": {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-violet)_15%,transparent)]",
    fg: "text-[var(--color-tag-violet)]",
  },
  completed: {
    bg: "bg-[color-mix(in_srgb,var(--color-tag-green)_15%,transparent)]",
    fg: "text-[var(--color-tag-green)]",
  },
  cancelled: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
  },
  default: {
    bg: "bg-[var(--color-surface-soft)]",
    fg: "text-[var(--color-muted)]",
  },
};

type DispatchNavigationLink = {
  label: "Map" | "Navigation";
  href: string;
};

type GpsCaptureState = "idle" | "pending" | "locked" | "unsupported" | "error";

function DeskDispatch() {
  const qc = useQueryClient();
  const visitsQuery = useQuery({
    queryKey: ["service", "my-field-visits"],
    queryFn: () => getJson("/api/service/my-field-visits", ServiceFieldVisitsResponseSchema),
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30_000,
  });
  const visits = visitsQuery.data?.visits ?? [];
  const sortedVisits = useMemo(() => sortVisitsByWindow(visits), [visits]);
  const focusedVisit = useMemo(() => findFocusedVisit(sortedVisits), [sortedVisits]);
  const routeVisits = focusedVisit
    ? sortedVisits.filter((visit) => visit.id !== focusedVisit.id)
    : sortedVisits;
  const activeCount = sortedVisits.filter((visit) => !isTerminalVisitStatus(visit.status)).length;
  const focusLabel = focusedVisit && isCurrentVisitStatus(focusedVisit.status) ? "Active visit" : "Next visit";

  const [queuedUpdates, setQueuedUpdates] = useState<QueuedTechnicianVisitStatusUpdate[]>(() =>
    readQueuedTechnicianVisitStatusUpdates(),
  );
  const pendingCount = queuedUpdates.length;
  const queuedCountByVisitId = useMemo(() => {
    const map = new Map<string, number>();
    for (const update of queuedUpdates) {
      map.set(update.visitId, (map.get(update.visitId) ?? 0) + 1);
    }
    return map;
  }, [queuedUpdates]);

  const invalidateVisitQueries = () => {
    void qc.invalidateQueries({ queryKey: ["service", "console"] });
    void qc.invalidateQueries({ queryKey: ["service", "field-visits"] });
    void qc.invalidateQueries({ queryKey: ["service", "my-field-visits"] });
  };

  const setPersistedQueuedUpdates = (
    updater:
      | QueuedTechnicianVisitStatusUpdate[]
      | ((current: QueuedTechnicianVisitStatusUpdate[]) => QueuedTechnicianVisitStatusUpdate[]),
  ) => {
    setQueuedUpdates((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return persistQueuedTechnicianVisitStatusUpdates(next);
    });
  };

  const submitTechnicianStatus = async (
    input: TechnicianVisitMutationInput,
  ): Promise<TechnicianVisitSubmitResult> => {
    const update = createQueuedTechnicianVisitStatusUpdate(input);
    try {
      await sendTechnicianVisitStatusUpdate(update);
      invalidateVisitQueries();
      return { queued: false };
    } catch (error) {
      if (!shouldQueueTechnicianVisitStatusError(error)) throw error;
      setPersistedQueuedUpdates((current) => [...current, update]);
      return { queued: true };
    }
  };

  const syncQueueMut = useMutation({
    mutationFn: async () => {
      const storageQueue = readQueuedTechnicianVisitStatusUpdates();
      const queue = storageQueue.length > 0 || queuedUpdates.length === 0 ? storageQueue : queuedUpdates;
      const kept: QueuedTechnicianVisitStatusUpdate[] = [];
      let syncedCount = 0;

      for (const update of queue) {
        try {
          await sendTechnicianVisitStatusUpdate(update);
          syncedCount += 1;
        } catch {
          kept.push(update);
        }
      }

      return {
        queue: persistQueuedTechnicianVisitStatusUpdates(kept),
        syncedCount,
      };
    },
    onSuccess: ({ queue, syncedCount }) => {
      setQueuedUpdates(queue);
      if (syncedCount > 0) invalidateVisitQueries();
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 [data-density=compact]:p-2 [data-density=spacious]:p-5 sm:p-4">
      <header className="space-y-3 border-b border-[var(--color-line)] pb-3">
        <Link
          to="/app/desk"
          search={{ status: "all", createTicket: null }}
          className="inline-flex items-center gap-1 text-[var(--text-sm)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Desk
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--color-surface-soft)] text-[var(--color-brand)]">
              <Navigation className="size-5" aria-hidden />
            </span>
            <div>
              <h1 className="text-[var(--text-xl)] font-semibold text-[var(--color-ink)]">
                Technician Dispatch
              </h1>
              <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
                Mobile route board
              </p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <dl className="grid w-full grid-cols-3 gap-2 text-left sm:min-w-64 sm:text-right">
              <DispatchMetric label="Assigned" value={visitsQuery.isLoading ? "..." : String(sortedVisits.length)} />
              <DispatchMetric label="Active" value={visitsQuery.isLoading ? "..." : String(activeCount)} />
              <DispatchMetric label="Pending" value={String(pendingCount)} />
            </dl>
            {pendingCount > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 font-medium text-[var(--color-muted)]">
                  Pending sync
                </span>
                <button
                  type="button"
                  disabled={syncQueueMut.isPending}
                  onClick={() => syncQueueMut.mutate()}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2 font-medium",
                    syncQueueMut.isPending
                      ? "bg-[var(--color-surface-soft)] text-[var(--color-muted)] opacity-60"
                      : "bg-[var(--color-brand)] text-white hover:opacity-90",
                  )}
                >
                  <Send className="size-3" aria-hidden />
                  {syncQueueMut.isPending ? "Syncing" : "Sync now"}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {visitsQuery.isLoading ? (
        <p className="py-8 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          Loading assigned visits...
        </p>
      ) : visitsQuery.isError ? (
        <p className="rounded-[var(--radius-lg)] border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-[var(--text-sm)] text-[var(--color-muted)]">
          Assigned visits are unavailable.
        </p>
      ) : sortedVisits.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-5 text-center text-[var(--text-sm)] text-[var(--color-muted)]">
          No assigned field visits.
        </p>
      ) : (
        <>
          {focusedVisit && (
            <section aria-label={focusLabel} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  {focusLabel}
                </h2>
                <span className="font-mono text-[11px] text-[var(--color-muted)]">
                  {formatVisitWindow(focusedVisit.scheduledStartAt, focusedVisit.scheduledEndAt)}
                </span>
              </div>
              <DispatchVisitCard
                visit={focusedVisit}
                emphasized
                queuedCount={queuedCountByVisitId.get(focusedVisit.id) ?? 0}
                syncing={syncQueueMut.isPending}
                onStatusSubmit={submitTechnicianStatus}
              />
            </section>
          )}

          {routeVisits.length > 0 && (
            <section aria-label="Assigned route" className="space-y-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                Assigned route
              </h2>
              <ul className="space-y-2">
                {routeVisits.map((visit) => (
                  <li key={visit.id}>
                    <DispatchVisitCard
                      visit={visit}
                      queuedCount={queuedCountByVisitId.get(visit.id) ?? 0}
                      syncing={syncQueueMut.isPending}
                      onStatusSubmit={submitTechnicianStatus}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function DispatchVisitCard({
  visit,
  emphasized,
  queuedCount,
  syncing,
  onStatusSubmit,
}: {
  visit: ServiceFieldVisit;
  emphasized?: boolean;
  queuedCount: number;
  syncing?: boolean;
  onStatusSubmit: (input: TechnicianVisitMutationInput) => Promise<TechnicianVisitSubmitResult>;
}) {
  const qc = useQueryClient();
  const [worksheetSummary, setWorksheetSummary] = useState(visit.worksheetSummary);
  const [pendingStatus, setPendingStatus] = useState<ServiceFieldVisitTechnicianStatus | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [gpsState, setGpsState] = useState<GpsCaptureState>("idle");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [capturedLocation, setCapturedLocation] = useState<ServiceFieldVisitTechnicianLocation | null>(null);
  const normalizedStatus = normalizeVisitStatus(visit.status);
  const statusTone = FIELD_VISIT_STATUS_TONE[normalizedStatus] ?? FIELD_VISIT_STATUS_TONE.default;
  const caseLabel = visit.caseNumber ?? visit.subject ?? visit.caseId;
  const customerLabel = visit.customerName ?? visit.customerId;
  const terminal = isTerminalVisitStatus(visit.status);
  const isSubmitting = pendingStatus != null;
  const routeLine = getDispatchRouteLine(visit);
  const navigationLinks = getDispatchNavigationLinks(visit);
  const latestLocation = capturedLocation ?? visit.technicianLocation ?? null;
  const isCapturingGps = gpsState === "pending";

  useEffect(() => {
    setWorksheetSummary(visit.worksheetSummary);
  }, [visit.id, visit.worksheetSummary]);

  useEffect(() => {
    setCapturedLocation(null);
    setGpsState("idle");
    setGpsError(null);
  }, [visit.id]);

  const submitStatus = async (status: ServiceFieldVisitTechnicianStatus) => {
    setPendingStatus(status);
    setSubmitError(null);
    try {
      await onStatusSubmit({
        visitId: visit.id,
        status,
        worksheetSummary,
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Update failed");
    } finally {
      setPendingStatus(null);
    }
  };

  const captureGps = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsState("unsupported");
      setGpsError("GPS unavailable");
      return;
    }

    setGpsState("pending");
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const capturedAt = Number.isFinite(position.timestamp)
          ? new Date(position.timestamp).toISOString()
          : new Date().toISOString();
        const payload = UpdateServiceFieldVisitTechnicianLocationInputSchema.parse({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          ...(typeof position.coords.accuracy === "number"
            ? { accuracyMeters: position.coords.accuracy }
            : {}),
          capturedAt,
          source: "browser-geolocation",
          idempotencyKey: generateTechnicianLocationIdempotencyKey(visit.id),
        });

        postJson(
          `/api/service/field-visits/${visit.id}/technician-location`,
          payload,
          UpdateServiceFieldVisitTechnicianLocationResponseSchema,
        )
          .then((response) => {
            const responseLocation = response.visit?.technicianLocation ?? null;
            setCapturedLocation(
              responseLocation ?? {
                latitude: payload.latitude,
                longitude: payload.longitude,
                capturedAt: payload.capturedAt ?? capturedAt,
                source: payload.source,
                ...(payload.accuracyMeters !== undefined ? { accuracyMeters: payload.accuracyMeters } : {}),
              },
            );
            setGpsState("locked");
            setGpsError(null);
            void qc.invalidateQueries({ queryKey: ["service", "console"] });
            void qc.invalidateQueries({ queryKey: ["service", "field-visits"] });
            void qc.invalidateQueries({ queryKey: ["service", "my-field-visits"] });
          })
          .catch((error) => {
            setGpsState("error");
            setGpsError(error instanceof Error ? error.message : "GPS capture failed");
          });
      },
      (error) => {
        setGpsState("error");
        setGpsError(getGpsPositionErrorMessage(error));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30_000,
        timeout: 15_000,
      },
    );
  };

  return (
    <article
      className={cn(
        "rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-3",
        emphasized
          ? "border-[var(--color-brand)] shadow-sm"
          : "border-[var(--color-line)]",
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-[var(--text-sm)] font-semibold text-[var(--color-ink)]">
                {caseLabel}
              </span>
              <span
                className={cn(
                  "rounded-[var(--radius-sm)] px-1.5 py-0.5",
                  "text-[10px] font-semibold uppercase tracking-wider",
                  statusTone.bg,
                  statusTone.fg,
                )}
              >
                {visit.status}
              </span>
              {queuedCount > 0 && (
                <span className="rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                  Queued{queuedCount > 1 ? ` ${queuedCount}` : ""}
                </span>
              )}
            </div>
            {visit.subject && visit.subject !== caseLabel && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--color-muted)]">
                {visit.subject}
              </p>
            )}
            <p className="mt-1 line-clamp-1 text-[11px] text-[var(--color-muted)]">
              {customerLabel}
            </p>
          </div>
          <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-surface-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-muted)]">
            {formatVisitWindow(visit.scheduledStartAt, visit.scheduledEndAt)}
          </span>
        </div>

        <div className="grid gap-1.5 text-[11px] text-[var(--color-muted)]">
          <p className="flex items-center gap-1.5">
            <RouteIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-1">{routeLine}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="line-clamp-1">{visit.location}</span>
          </p>
          <p className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            <span>{formatVisitWindow(visit.scheduledStartAt, visit.scheduledEndAt)}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {navigationLinks.map((link) => (
            <a
              key={`${link.label}:${link.href}`}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-line)] px-2 text-[11px] font-medium text-[var(--color-ink)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
            >
              {link.label === "Map" ? (
                <MapIcon className="size-3" aria-hidden />
              ) : (
                <Navigation className="size-3" aria-hidden />
              )}
              {link.label}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button
            type="button"
            disabled={terminal || isSubmitting || syncing || isCapturingGps}
            onClick={captureGps}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-[var(--radius-md)] px-2 font-medium",
              terminal || isSubmitting || syncing || isCapturingGps
                ? "bg-[var(--color-surface-soft)] text-[var(--color-muted)] opacity-60"
                : "bg-[var(--color-ink)] text-white hover:opacity-90",
            )}
          >
            <MapPin className="size-3" aria-hidden />
            {isCapturingGps ? "Locking GPS" : gpsState === "locked" ? "GPS locked" : "Capture GPS"}
          </button>
          {latestLocation && <TechnicianLocationEvidence location={latestLocation} />}
        </div>
        {gpsError && (
          <p className="text-[11px] text-[var(--color-ruby)]">
            {gpsError}
          </p>
        )}

        <p className="flex items-start gap-1.5 text-[11px] text-[var(--color-ink)]">
          <ClipboardCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--color-muted)]" aria-hidden />
          <span className="line-clamp-2">{visit.worksheetSummary || "Worksheet pending"}</span>
        </p>

        <label>
          <span className="sr-only">Worksheet summary for {caseLabel}</span>
          <textarea
            value={worksheetSummary}
            onChange={(event) => setWorksheetSummary(event.target.value)}
            disabled={terminal || isSubmitting || syncing}
            rows={2}
            className={cn(
              "h-14 w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-line)]",
              "bg-[var(--color-surface)] px-2 py-1 text-[11px] text-[var(--color-ink)]",
              "placeholder:text-[var(--color-muted)] disabled:bg-[var(--color-surface-soft)]",
            )}
            placeholder="Worksheet summary"
          />
        </label>

        <div className="flex flex-wrap gap-1">
          {TECHNICIAN_VISIT_ACTIONS.map((action) => {
            const disabled =
              isSubmitting ||
              syncing ||
              queuedCount > 0 ||
              !canApplyTechnicianStatus(visit.status, action.status);
            return (
              <button
                key={action.status}
                type="button"
                disabled={disabled}
                onClick={() => void submitStatus(action.status)}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-[var(--radius-md)] px-2",
                  "text-[11px] font-medium",
                  disabled
                    ? "bg-[var(--color-surface-soft)] text-[var(--color-muted)] opacity-60"
                    : "bg-[var(--color-brand)] text-white hover:opacity-90",
                )}
              >
                <TechnicianActionIcon status={action.status} />
                {pendingStatus === action.status ? "Saving" : action.label}
              </button>
            );
          })}
        </div>
        {submitError && (
          <p className="text-[11px] text-[var(--color-ruby)]">
            {submitError}
          </p>
        )}
      </div>
    </article>
  );
}

function TechnicianLocationEvidence({ location }: { location: ServiceFieldVisitTechnicianLocation }) {
  const accuracyLabel = formatAccuracyMeters(location.accuracyMeters);
  const capturedAtLabel = formatCapturedAt(location.capturedAt);
  const mapHref = getTechnicianLocationMapUrl(location);

  return (
    <span className="inline-flex min-h-7 flex-wrap items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-soft)] px-2 py-1 text-[var(--color-muted)]">
      <span className="font-medium text-[var(--color-ink)]">GPS</span>
      <span className="font-mono">{formatCoordinate(location.latitude)}, {formatCoordinate(location.longitude)}</span>
      {accuracyLabel && <span>accuracy {accuracyLabel}</span>}
      <span>captured {capturedAtLabel}</span>
      {mapHref && (
        <a
          href={mapHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-[var(--color-brand)] hover:underline"
        >
          GPS map
          <ExternalLink className="size-3" aria-hidden />
        </a>
      )}
    </span>
  );
}

function DispatchMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
        {label}
      </dt>
      <dd className="font-mono text-[var(--text-sm)] text-[var(--color-ink)]">
        {value}
      </dd>
    </div>
  );
}

function TechnicianActionIcon({ status }: { status: ServiceFieldVisitTechnicianStatus }) {
  if (status === "en-route") return <Navigation className="size-3" aria-hidden />;
  if (status === "in-progress") return <PlayCircle className="size-3" aria-hidden />;
  return <CheckCircle2 className="size-3" aria-hidden />;
}

function sortVisitsByWindow(visits: ServiceFieldVisit[]): ServiceFieldVisit[] {
  return [...visits].sort((a, b) => {
    const aTime = Date.parse(a.scheduledStartAt);
    const bTime = Date.parse(b.scheduledStartAt);
    const safeA = Number.isNaN(aTime) ? Number.MAX_SAFE_INTEGER : aTime;
    const safeB = Number.isNaN(bTime) ? Number.MAX_SAFE_INTEGER : bTime;
    return safeA - safeB;
  });
}

function findFocusedVisit(visits: ServiceFieldVisit[]): ServiceFieldVisit | undefined {
  return (
    visits.find((visit) => isCurrentVisitStatus(visit.status)) ??
    visits.find((visit) => !isTerminalVisitStatus(visit.status)) ??
    visits[0]
  );
}

function isCurrentVisitStatus(status: string): boolean {
  const normalized = normalizeVisitStatus(status);
  return normalized === "en-route" || normalized === "in-progress";
}

function getDispatchRouteLine(visit: ServiceFieldVisit): string {
  const routeLine = visit.dispatchNavigation?.routeLine?.trim();
  if (routeLine) return routeLine;
  return visit.location;
}

function getDispatchNavigationLinks(visit: ServiceFieldVisit): DispatchNavigationLink[] {
  const navigation = visit.dispatchNavigation ?? undefined;
  const mapHref =
    firstNonEmpty(
      navigation?.mapUrl,
      navigation?.googleMapsUrl,
      navigation?.appleMapsUrl,
    ) ?? createMapSearchUrl(visit.location);
  const navigationHref =
    firstNonEmpty(
      navigation?.navigationUrl,
      navigation?.directionsUrl,
      navigation?.wazeUrl,
    ) ?? createDirectionsUrl(visit.location);

  const links: DispatchNavigationLink[] = [];
  if (mapHref) links.push({ label: "Map", href: mapHref });
  if (navigationHref && navigationHref !== mapHref) {
    links.push({ label: "Navigation", href: navigationHref });
  }
  return links;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function createMapSearchUrl(location: string): string | undefined {
  const query = location.trim();
  if (!query) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function createCoordinateMapSearchUrl(latitude: number, longitude: number): string | undefined {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function getTechnicianLocationMapUrl(location: ServiceFieldVisitTechnicianLocation): string | undefined {
  return sanitizeExternalMapUrl(location.mapUrl) ?? createCoordinateMapSearchUrl(location.latitude, location.longitude);
}

function sanitizeExternalMapUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

function createDirectionsUrl(location: string): string | undefined {
  const query = location.trim();
  if (!query) return undefined;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

function formatVisitWindow(startAt: string, endAt: string): string {
  const start = formatVisitDateTime(startAt);
  const end = formatVisitDateTime(endAt);

  if (start && end) return `${start} - ${end}`;
  return start || end || "Unscheduled";
}

function formatVisitDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value.trim();
  return VISIT_TIME_FORMATTER.format(new Date(timestamp));
}

function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : String(value);
}

function formatAccuracyMeters(value: number | null | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 10) return `${value.toFixed(1)} m`;
  return `${Math.round(value)} m`;
}

function formatCapturedAt(value: string): string {
  const parsed = formatVisitDateTime(value);
  return parsed || value;
}

function generateTechnicianLocationIdempotencyKey(visitId: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `desk-visit:${visitId}:technician-location:${Date.now()}:${random}`.slice(0, 200);
}

function getGpsPositionErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "GPS permission denied";
  if (error.code === error.POSITION_UNAVAILABLE) return "GPS position unavailable";
  if (error.code === error.TIMEOUT) return "GPS timeout";
  return error.message || "GPS capture failed";
}
