/**
 * Keyboard — runtime registry.
 *
 * The registry owns the live set of registered shortcuts and
 * dispatches incoming keydown events to the first matching
 * handler. There is one global listener; the registry is the
 * only thing that touches `window.addEventListener("keydown")`.
 *
 * Architecture:
 *   - `registerShortcut(entry)` adds the entry; returns an
 *     `unregister` function so callers can scope registrations
 *     to a component's lifecycle. This is the only public API
 *     that mutates state.
 *   - `unregisterShortcut(id, scope, chord)` removes a previously
 *     registered entry by the same composite key.
 *   - `setActiveScope(scope)` makes a feature scope "current" —
 *     the registry prefers handlers in the active scope over
 *     `global` handlers.
 *   - `dispatch(event)` is the listener callback. Returns the
 *     entry that fired (or null) so the listener can decide
 *     whether to `preventDefault`.
 *
 * The registry is a singleton: there is only one active
 * AppLayout at a time, and the singleton simplifies the listener
 * ownership (the KeyHandler component is just a mount-point).
 *
 * Why a singleton:
 *   - The global keydown listener needs exactly one owner.
 *   - Tests can reset the registry between runs via
 *     `__resetKeyboardRegistryForTests()` (exported below).
 *   - Multiple AppLayouts (impossible in practice, but…)
 *     would otherwise double-fire every chord.
 */
import { matchesEvent, parseChord } from "./grammar";
import type {
  Chord,
  FeatureScope,
  KeymapEntry,
  ParsedChord,
} from "./schemas";

/** Composite key for a registration. Two entries with the same
 *  (scope, chord, id) are treated as the same registration. */
function compositeKey(scope: FeatureScope, chord: Chord, id: string): string {
  return `${scope}::${chord}::${id}`;
}

interface Registered {
  entry: KeymapEntry;
  parsed: ParsedChord;
}

/** Internal store. `Map<compositeKey, Registered>` keeps
 *  registrations O(1) by composite key, and the `Set` of
 *  scopes walks naturally. */
const store: Map<string, Registered> = new Map();
let activeScope: FeatureScope = "global";
let listenerInstalled = false;
let listenerRef: ((e: KeyboardEvent) => void) | null = null;

/** Install the global keydown listener if it isn't already. */
function ensureListener(): void {
  if (listenerInstalled) return;
  if (typeof window === "undefined") return; // SSR guard
  listenerRef = (e: KeyboardEvent) => {
    dispatch(e);
  };
  window.addEventListener("keydown", listenerRef, { capture: true });
  listenerInstalled = true;
}

/** Tear down the global listener. Only used by tests. */
function removeListener(): void {
  if (!listenerInstalled) return;
  if (typeof window === "undefined" || !listenerRef) return;
  window.removeEventListener("keydown", listenerRef, { capture: true });
  listenerInstalled = false;
  listenerRef = null;
}

/** Register a shortcut. Returns an unregister function. If an
 *  entry with the same composite key already exists, it is
 *  replaced (the new handler wins). */
export function registerShortcut(entry: KeymapEntry): () => void {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("registerShortcut: entry must be an object");
  }
  if (typeof entry.handler !== "function") {
    throw new TypeError("registerShortcut: entry.handler must be a function");
  }
  if (entry.enabled === false) {
    // Disabled at registration time. Still record it so the
    // cheatsheet can render the entry, but mark it inactive.
  }
  const parsed = parseChord(entry.chord);
  const key = compositeKey(entry.scope, entry.chord, entry.id);
  store.set(key, { entry, parsed });
  ensureListener();
  return () => {
    const cur = store.get(key);
    if (cur && cur.entry === entry) store.delete(key);
  };
}

/** Remove a previously-registered shortcut by composite key. */
export function unregisterShortcut(
  id: string,
  scope: FeatureScope,
  chord: Chord,
): boolean {
  const key = compositeKey(scope, chord, id);
  return store.delete(key);
}

/** Set the currently-active feature scope. Handlers in this
 *  scope (and `global`) are considered. Other scopes are
 *  ignored until the active scope changes. */
export function setActiveScope(scope: FeatureScope): void {
  activeScope = scope;
}

/** Read the currently-active scope. */
export function getActiveScope(): FeatureScope {
  return activeScope;
}

/** Dispatch a keydown event. Returns the entry that fired, or
 *  null if no handler matched. The caller can use the return
 *  value to decide whether to `preventDefault`. */
export function dispatch(event: KeyboardEvent): KeymapEntry | null {
  // Walk the registry. We prefer the active scope first, then
  // `global`, then anything else. The first match wins.
  const candidates: Registered[] = [];
  for (const reg of store.values()) {
    if (reg.entry.enabled === false) continue;
    if (reg.entry.scope === activeScope || reg.entry.scope === "global") {
      candidates.push(reg);
    }
  }
  // Sort so that the *active* scope beats `global` and any
  // other active-scope entry. Within the same scope, first-
  // registered wins (Map iteration order is insertion order).
  candidates.sort((a, b) => {
    if (a.entry.scope === b.entry.scope) return 0;
    if (a.entry.scope === activeScope) return -1;
    return 1;
  });
  for (const reg of candidates) {
    if (matchesEvent(event, reg.parsed)) {
      try {
        reg.entry.handler(event);
      } catch (err: unknown) {
        // Surface the error to the console so the developer
        // sees the failing handler, but never let one bad
        // handler kill the entire dispatch chain.
        // eslint-disable-next-line no-console -- intentional: dev-visible
        console.error("[keyboard] handler threw:", err);
      }
      return reg.entry;
    }
  }
  return null;
}

/** Read-only view of the registered entries, for the
 *  cheatsheet. Sorted by (groupId, chord) so the cheatsheet
 *  renders in a stable order without re-sorting. */
export function listEntries(): ReadonlyArray<KeymapEntry> {
  return Array.from(store.values())
    .map((r) => r.entry)
    .slice()
    .sort((a, b) => {
      if (a.groupId === b.groupId) return a.chord.localeCompare(b.chord);
      return a.groupId.localeCompare(b.groupId);
    });
}

/** Test-only: reset the entire registry. Production code
 *  should never call this — it exists so the vitest unit tests
 *  can start from a known state. */
export function __resetKeyboardRegistryForTests(): void {
  store.clear();
  activeScope = "global";
  removeListener();
}
