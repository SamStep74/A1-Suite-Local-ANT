/**
 * KeyHandler — global keydown listener + default keymap mount.
 *
 * Mounts once at the AppLayout level. Reads the DEFAULT_KEYMAP
 * and registers the actual handler implementations on a
 * useEffect, so SSR is safe (no listeners at render time on
 * the server) and hot-reload doesn't double-register.
 *
 * The handlers close over the parent's `setPaletteOpen`,
 * `setAskAiOpen`, `setAppLauncherOpen` callbacks — passed as
 * props. The parent owns the open state so the AppLayout's
 * `<AskCommandPalette>`, `<AskAiPanel>`, and `<AppLauncher>`
 * continue to be the single source of truth (this matches the
 * 10.5 ask-ai pattern in `AppLayout`).
 *
 * The "open cheatsheet" chord is owned locally: the KeyHandler
 * holds a piece of `cheatsheetOpen` state of its own. This is
 * a deliberate single-source-of-truth tradeoff: the cheatsheet
 * doesn't have any other UI presence, so a local boolean is
 * simpler than threading a fifth prop into AppLayout.
 *
 * Lingui: this component owns the registry. The 12+ user-facing
 * strings live in `ShortcutCheatsheet.tsx` (the visible UI), not
 * here. The "press ?" hint in this file is also wrapped in
 * `<Trans>` for the audit gate.
 */
import { Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { setActiveScope, registerShortcut } from "../../lib/keyboard";
import { DEFAULT_KEYMAP } from "../../lib/keyboard/shortcuts";
import { ShortcutCheatsheet } from "./ShortcutCheatsheet";

export interface KeyHandlerProps {
  onOpenCommandPalette: () => void;
  onOpenAskAi: () => void;
  onOpenAppLauncher: () => void;
  /**
   * Optional: when provided, a "go to triage inbox" handler is
   * registered. Routes that own navigation pass this in. We
   * keep the navigation entries optional because not every
   * AppLayout consumer has TanStack Router in scope.
   */
  onGoTriage?: () => void;
  onGoFinance?: () => void;
  onGoHome?: () => void;
}

export function KeyHandler({
  onOpenCommandPalette,
  onOpenAskAi,
  onOpenAppLauncher,
  onGoTriage,
  onGoFinance,
  onGoHome,
}: KeyHandlerProps) {
  // Single piece of state owned by KeyHandler: the cheatsheet
  // visibility. The actual <dialog> lives in <ShortcutCheatsheet>.
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);

  // Active scope is always "global" at the AppLayout level;
  // routes can call setActiveScope() if they want to scope
  // their own entries. We set it on mount so subsequent
  // registrations land in the right scope.
  useEffect(() => {
    setActiveScope("global");
  }, []);

  // Register the default keymap. The unregister fn from each
  // registration is collected and called on unmount; this is
  // hot-reload safe because React 19 strict-mode double-mount
  // runs the cleanup once, and we re-register on the second
  // mount.
  useEffect(() => {
    const unregisters: Array<() => void> = [];
    // We register one entry at a time so the handler closures
    // can refer to the props directly. (We could put them in
    // an object and spread, but the indirection isn't worth
    // the bytes for ~5 entries.)
    unregisters.push(
      registerShortcut({
        id: "default.open-cheatsheet",
        groupId: "help",
        scope: "global",
        chord: "?",
        description: "Show keyboard shortcuts",
        handler: (e) => {
          // Don't intercept if the user is typing in an input
          // (so they can type a literal "?" in a search box).
          const target = e.target as HTMLElement | null;
          if (
            target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.isContentEditable)
          ) {
            return;
          }
          e.preventDefault();
          setCheatsheetOpen((v) => !v);
        },
      }),
    );
    unregisters.push(
      registerShortcut({
        id: "default.close-panel",
        groupId: "panels",
        scope: "global",
        chord: "escape",
        description: "Close the open panel or dialog",
        handler: () => {
          // The cheatsheet is the only panel we own from here;
          // other panels (palette, ask-ai, app-launcher) are
          // managed by their own inline ESC handlers in
          // AppLayout, so we only close ourselves.
          setCheatsheetOpen(false);
        },
      }),
    );
    unregisters.push(
      registerShortcut({
        id: "default.open-command-palette",
        groupId: "panels",
        scope: "global",
        chord: "mod+k",
        description: "Open the command palette",
        handler: (e) => {
          e.preventDefault();
          onOpenCommandPalette();
        },
      }),
    );
    unregisters.push(
      registerShortcut({
        id: "default.open-ask-ai",
        groupId: "panels",
        scope: "global",
        chord: "mod+i",
        description: "Open the Ask AI panel",
        handler: (e) => {
          e.preventDefault();
          onOpenAskAi();
        },
      }),
    );
    unregisters.push(
      registerShortcut({
        id: "default.open-app-launcher",
        groupId: "panels",
        scope: "global",
        chord: "mod+o",
        description: "Open the app launcher",
        handler: (e) => {
          e.preventDefault();
          onOpenAppLauncher();
        },
      }),
    );
    if (onGoHome) {
      unregisters.push(
        registerShortcut({
          id: "default.go-home",
          groupId: "navigation",
          scope: "global",
          chord: "h",
          description: "Go to the home dashboard (press g then h)",
          handler: (e) => {
            // Two-key chord: only fire when "g" was pressed
            // within the last ~1s. We register a single-key
            // chord on "h" so the grammar stays simple; the
            // pending-state lives in `window.__kbd_pendingG`.
            if (window.__kbd_pendingG) {
              window.__kbd_pendingG = false;
              e.preventDefault();
              onGoHome();
            }
            // If "g" wasn't pending, swallow the "h" press so
            // it doesn't fall through to a list-navigation
            // chord elsewhere (the cheatsheet still teaches
            // the user to press "g then h" together).
          },
        }),
      );
    }
    if (onGoFinance) {
      unregisters.push(
        registerShortcut({
          id: "default.go-finance",
          groupId: "navigation",
          scope: "global",
          chord: "f",
          description: "Go to the finance app (press g then f)",
          handler: (e) => {
            if (window.__kbd_pendingG) {
              window.__kbd_pendingG = false;
              e.preventDefault();
              onGoFinance();
            }
          },
        }),
      );
    }
    if (onGoTriage) {
      unregisters.push(
        registerShortcut({
          id: "default.go-triage",
          groupId: "navigation",
          scope: "global",
          chord: "t",
          description: "Go to the triage inbox (press g then t)",
          handler: (e) => {
            if (window.__kbd_pendingG) {
              window.__kbd_pendingG = false;
              e.preventDefault();
              onGoTriage();
            }
          },
        }),
      );
    }
    // Register the "g" key as a *separate* entry that sets
    // the pending flag. We do NOT navigate on plain "g" —
    // it just arms the next keypress. The cheatsheet shows
    // the chord as "G then H/F/T" so the user knows.
    unregisters.push(
      registerShortcut({
        id: "default.g-prefix",
        groupId: "navigation",
        scope: "global",
        chord: "g",
        description: "Arm the navigation chord (press g then h, f, or t)",
        handler: () => {
          window.__kbd_pendingG = true;
          window.setTimeout(() => {
            window.__kbd_pendingG = false;
          }, 1000);
        },
      }),
    );
    return () => {
      // Unregister all on unmount / hot-reload.
      for (const u of unregisters) u();
    };
    // We deliberately omit the handler props from the deps
    // array: the parent re-renders frequently, and we want
    // the listeners stable. The handlers close over the
    // initial values; if the parent wants a *new* callback
    // identity, it can remount the KeyHandler via a `key`
    // prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The component is otherwise renderless. The cheatsheet is
  // the only visible artefact, and it manages its own DOM.
  return (
    <>
      <p className="sr-only" data-testid="keyboard-grammar-handler">
        <Trans>Press ? to show keyboard shortcuts</Trans>
      </p>
      <ShortcutCheatsheet
        open={cheatsheetOpen}
        onOpenChange={setCheatsheetOpen}
        entries={DEFAULT_KEYMAP}
      />
    </>
  );
}

// Module-level state for two-key chord detection. We attach to
// `window` so the closure inside the registered handler can
// read it without re-binding on every registration. The
// KeyHandler is the only writer.
declare global {
  interface Window {
    __kbd_pendingG?: boolean;
  }
}
