/**
 * state.ts — localStorage-backed state for the close checklist.
 *
 * Storage shape:
 *   key:    `a1:close:<periodId>:<stepId>`
 *   value:  JSON-stringified `CloseStepState`
 *
 * Why per-step keys (one per `<periodId, stepId>`) instead of one
 * big blob per period?
 *   - Granular writes: marking a single step done doesn't
 *     re-serialize the whole list.
 *   - Schema migration: when we add a new step to the seed, the
 *     new step simply has no key yet (we treat absence as
 *     `pending`), so old clients pick up the new step without a
 *     migration. (See `readStepState`.)
 *   - E2e tests can clear a single key to reset one step.
 *
 * Why not `localStorage` via a `useSyncExternalStore`? — we'll
 * wrap it that way in the route, but the storage primitives
 * themselves are pure functions. Tests can pass a mock storage
 * (see `state.test.ts`).
 *
 * All functions are SSR-safe: they check `typeof window` and
 * short-circuit to a no-op on the server. The route guards its
 * own rendering behind `I18nProvider`'s "ready" gate, but defensive
 * checks here mean `state.ts` can be imported by an
 * `I18nProvider`-less test without crashing.
 */
import {
  CloseStepStateSchema,
  type CloseStep,
  type CloseStepState,
  type CloseStepStatus,
  type ClosePeriod,
  type CloseSummary,
  isCountedAsDone,
  isTerminalStatus,
} from "./schemas";
import { CHECKLIST_STEPS, sortSteps } from "./checklist";

/* ────────── storage abstraction ────────── */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Iterate all keys with a given prefix. Used to enumerate
   *  every step in a period when the seed grows. */
  keysWithPrefix(prefix: string): readonly string[];
}

/** `window.localStorage` shim — the production impl. */
export const localStorageAdapter = (): KeyValueStorage => {
  if (typeof window === "undefined" || !window.localStorage) {
    // SSR / Node test (without jsdom `localStorage`): return a
    // in-memory shim so the test runs without throwing.
    return inMemoryStorage();
  }
  const ls = window.localStorage;
  return {
    getItem: (k) => ls.getItem(k),
    setItem: (k, v) => ls.setItem(k, v),
    removeItem: (k) => ls.removeItem(k),
    keysWithPrefix: (prefix) => {
      const out: string[] = [];
      for (let i = 0; i < ls.length; i += 1) {
        const key = ls.key(i);
        if (key && key.startsWith(prefix)) out.push(key);
      }
      return out;
    },
  };
};

/** In-memory shim used by tests and SSR. */
export const inMemoryStorage = (): KeyValueStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    keysWithPrefix: (prefix) => {
      const out: string[] = [];
      for (const k of map.keys()) {
        if (k.startsWith(prefix)) out.push(k);
      }
      return out;
    },
  };
};

/* ────────── key helpers ────────── */

export const STORAGE_PREFIX = "a1:close:";

/** Build the storage key for a single step. */
export const stepKey = (
  periodId: string,
  stepId: string,
): string => `${STORAGE_PREFIX}${periodId}:${stepId}`;

/** Build the prefix that captures all steps in a period. */
export const periodPrefix = (periodId: string): string =>
  `${STORAGE_PREFIX}${periodId}:`;

/* ────────── read / write ────────── */

/** Read a single step's state. Returns a `pending` default if
 *  the key is missing or the stored value doesn't parse. */
export const readStepState = (
  storage: KeyValueStorage,
  periodId: string,
  step: CloseStep,
): CloseStepState => {
  const raw = storage.getItem(stepKey(periodId, step.id));
  if (raw == null) {
    return { stepId: step.id, status: "pending" };
  }
  try {
    const parsed = CloseStepStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) {
      // Belt-and-suspenders: ensure the persisted `stepId` matches
      // the one in the key. A user who manually edits localStorage
      // can put a wrong id; we treat that as missing.
      if (parsed.data.stepId === step.id) {
        return parsed.data;
      }
    }
  } catch {
    // fall through to the default
  }
  return { stepId: step.id, status: "pending" };
};

/** Write a single step's state. */
export const writeStepState = (
  storage: KeyValueStorage,
  periodId: string,
  state: CloseStepState,
): void => {
  const key = stepKey(periodId, state.stepId);
  storage.setItem(key, JSON.stringify(state));
};

/** Reset a single step to `pending` (used by the "Undo" toast). */
export const clearStepState = (
  storage: KeyValueStorage,
  periodId: string,
  stepId: string,
): void => {
  storage.removeItem(stepKey(periodId, stepId));
};

/* ────────── batch operations (used by BulkActionBar) ────────── */

export const setStatusForSteps = (
  storage: KeyValueStorage,
  periodId: string,
  stepIds: readonly string[],
  status: CloseStepStatus,
  note?: string,
): readonly CloseStepState[] => {
  const now = new Date().toISOString();
  const out: CloseStepState[] = [];
  for (const id of stepIds) {
    const state: CloseStepState = {
      stepId: id,
      status,
      updatedAt: now,
      ...(note !== undefined ? { note } : {}),
    };
    writeStepState(storage, periodId, state);
    out.push(state);
  }
  return out;
};

/** A merged row: the canonical step + the user's per-period state.
 *  Carries `id` at the top level (the step id) so the table
 *  primitive can use it as the selection key without unwrapping. */
export interface CloseRow {
  id: string;
  step: CloseStep;
  state: CloseStepState;
}

/** Read every step in the canonical seed, merged with whatever
 *  state we have in storage. Missing keys are `pending`. The
 *  result is sorted into the seed's canonical order. */
export const readPeriodState = (
  storage: KeyValueStorage,
  period: ClosePeriod,
): readonly CloseRow[] => {
  const rows: CloseRow[] = CHECKLIST_STEPS.map((step) => ({
    id: step.id,
    step,
    state: readStepState(storage, period.id, step),
  }));
  return sortSteps(rows);
};

/* ────────── summary ────────── */

export const summarize = (
  rows: readonly { state: CloseStepState }[],
): CloseSummary => {
  const total = rows.length;
  let done = 0;
  let blocked = 0;
  let skipped = 0;
  for (const r of rows) {
    if (r.state.status === "done") done += 1;
    else if (r.state.status === "blocked") blocked += 1;
    else if (r.state.status === "skipped") skipped += 1;
  }
  const pending = total - done - blocked - skipped;
  return {
    total,
    done,
    blocked,
    skipped,
    pending,
    doneRatio: total === 0 ? 0 : done / total,
  };
};

/* ────────── re-exports for convenience ────────── */

export { isTerminalStatus, isCountedAsDone };
