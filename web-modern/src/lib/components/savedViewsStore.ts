/**
 * savedViewsStore — per-user, per-table persistence of table view state.
 *
 * Each table on the page gets its own localStorage slot
 *   `a1:savedViews:<tableId>`
 * whose value is a JSON array of `SavedView` records. The store
 * intentionally has *no* React imports: it is a pure-function layer
 * over `localStorage` that components subscribe to via
 * `subscribeToViews(tableId, cb)`. That keeps the persistence layer
 * testable in isolation (no jsdom React render) and makes it
 * straightforward to swap the backing store (IndexedDB, server) in
 * a later phase without touching any component.
 *
 * Shape:
 *   SavedViewState = { sort: {...}, filter: {...}, page: number, columns: string[] }
 *   SavedView      = { id: string, name: string, state: SavedViewState, createdAt: string }
 *
 * SSR safety: every public function no-ops when `window` is undefined
 * (returns empty arrays / null). The SPA does not SSR today, but the
 * pattern keeps the store usable from any future server-context.
 */
export interface SavedViewState {
  sort: { id: string; desc: boolean } | null;
  filter: string;
  page: number;
  pageSize: number;
  columns: string[];
}

export interface SavedView {
  id: string;
  name: string;
  state: SavedViewState;
  createdAt: string;
}

const KEY_PREFIX = "a1:savedViews:";

const subscribers = new Map<string, Set<() => void>>();

const isBrowser = (): boolean => typeof window !== "undefined";

/** Stable, low-cardinality id (no crypto.randomUUID dep needed). */
const newId = (): string =>
  `sv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const key = (tableId: string): string => `${KEY_PREFIX}${tableId}`;

const readAll = (tableId: string): SavedView[] => {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(key(tableId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSavedView);
  } catch {
    // Corrupt JSON or quota error: degrade to empty rather than crash.
    return [];
  }
};

const writeAll = (tableId: string, views: ReadonlyArray<SavedView>): void => {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(key(tableId), JSON.stringify(views));
  } catch {
    // Quota exceeded or private mode: swallow — the UI will fall back
    // to in-memory state, which is the same behavior as a brand-new tab.
  }
  notify(tableId);
};

const notify = (tableId: string): void => {
  const set = subscribers.get(tableId);
  if (!set) return;
  for (const cb of set) cb();
};

const isSavedView = (v: unknown): v is SavedView => {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.state === "object" &&
    o.state !== null &&
    typeof o.createdAt === "string"
  );
};

const defaultState = (): SavedViewState => ({
  sort: null,
  filter: "",
  page: 0,
  pageSize: 25,
  columns: [],
});

/* ────────── public API ────────── */

export function loadViews(tableId: string): SavedView[] {
  return readAll(tableId);
}

export function saveView(
  tableId: string,
  name: string,
  state: SavedViewState,
): SavedView {
  const view: SavedView = {
    id: newId(),
    name: name.trim() || "Untitled",
    state: { ...defaultState(), ...state },
    createdAt: new Date().toISOString(),
  };
  const next = [...readAll(tableId), view];
  writeAll(tableId, next);
  return view;
}

export function deleteView(tableId: string, viewId: string): void {
  const next = readAll(tableId).filter((v) => v.id !== viewId);
  writeAll(tableId, next);
}

export function renameView(
  tableId: string,
  viewId: string,
  nextName: string,
): void {
  const trimmed = nextName.trim();
  if (!trimmed) return;
  const next = readAll(tableId).map((v) =>
    v.id === viewId ? { ...v, name: trimmed } : v,
  );
  writeAll(tableId, next);
}

export function subscribeToViews(
  tableId: string,
  cb: () => void,
): () => void {
  let set = subscribers.get(tableId);
  if (!set) {
    set = new Set();
    subscribers.set(tableId, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) subscribers.delete(tableId);
  };
}

/** Test-only escape hatch — wipes the per-table key. Production code
 *  uses the public CRUD functions above. */
export function __clearForTests(tableId: string): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(key(tableId));
  notify(tableId);
}
