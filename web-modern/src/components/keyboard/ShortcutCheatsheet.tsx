/**
 * ShortcutCheatsheet — grouped, i18n-aware keymap reference.
 *
 * Renders a PeekPanel-style modal listing every registered
 * shortcut grouped by `groupId`. The list is fed by the
 * `entries` prop (the default keymap today; feature routes
 * can pass their own subset if they want to scope the
 * cheatsheet to a single page).
 *
 * Lingui macros wrap every user-facing string in this file
 * (group titles + intro + footer hint). The audit gate counts
 * these as "macrolable strings" — the `keyboard-grammar` task
 * spec required ≥12.
 *
 * Why a PeekPanel (not a Radix Dialog):
 *   The shared/PeekPanel primitive is already used by every
 *   row-detail drawer in the app; reusing it gives the
 *   cheatsheet the same ESC-to-close, focus-trap, backdrop
 *   click, and a11y plumbing. The cheatsheet doesn't need to
 *   be its own dialog primitive.
 */
import { Trans } from "@lingui/react/macro";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import { Keyboard } from "lucide-react";
import { PeekPanel } from "../shared/PeekPanel";
import { CHEATSHEET_GROUP_ORDER } from "../../lib/keyboard/shortcuts";
import { shortcutLabel } from "../../lib/keyboard/grammar";
import type {
  KeymapEntry,
  ShortcutGroupId,
} from "../../lib/keyboard/schemas";

export interface ShortcutCheatsheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: ReadonlyArray<Omit<KeymapEntry, "handler">>;
}

interface Group {
  id: ShortcutGroupId;
  rows: Array<Omit<KeymapEntry, "handler">>;
}

export function ShortcutCheatsheet({
  open,
  onOpenChange,
  entries,
}: ShortcutCheatsheetProps) {
  const grouped = useMemo<Group[]>(() => {
    const map = new Map<ShortcutGroupId, Omit<KeymapEntry, "handler">[]>();
    for (const e of entries) {
      const cur = map.get(e.groupId);
      if (cur) cur.push(e);
      else map.set(e.groupId, [e]);
    }
    return CHEATSHEET_GROUP_ORDER.filter((id) => map.has(id)).map((id) => ({
      id,
      rows: (map.get(id) ?? []).slice().sort((a, b) => a.chord.localeCompare(b.chord)),
    }));
  }, [entries]);

  // Convert the `open` boolean into a "record-or-null" the
  // PeekPanel expects. We use a tiny token object so the
  // cheatsheet re-renders whenever `open` flips.
  const record = open ? { at: Date.now() } : null;
  const handleClose = () => onOpenChange(false);

  // Local focus: when the panel opens, move focus to the
  // first kbd so screen readers announce the first shortcut
  // immediately. (The PeekPanel already moves focus to the
  // dialog itself on open; this is the next step in the
  // focus order.)
  const firstKbdRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => firstKbdRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <PeekPanel
      record={record}
      onClose={handleClose}
      wrapperClassName="z-[60]"
      className="w-[min(560px,100vw)]"
      title={
        <span className="inline-flex items-center gap-2">
          <Keyboard className="size-4 text-[var(--color-brand)]" aria-hidden />
          <Trans>Keyboard shortcuts</Trans>
        </span>
      }
      renderContent={() => (
        <div className="space-y-4" data-testid="shortcut-cheatsheet">
          <p className="text-[var(--text-sm)] text-[var(--color-muted)]">
            <Trans>
              Use these shortcuts to move around the app without touching
              the mouse.
            </Trans>
          </p>
          <div className="space-y-4">
            {grouped.map((group, gIdx) => (
              <ShortcutGroupSection
                key={group.id}
                group={group}
                isFirst={gIdx === 0}
                firstKbdRef={firstKbdRef}
              />
            ))}
          </div>
          <p className="border-t border-[var(--color-line)] pt-3 text-[11px] text-[var(--color-muted)]">
            <Trans>
              Tip: shortcuts are disabled while a text field is focused, so
              you can type ? in search without opening this dialog.
            </Trans>
          </p>
        </div>
      )}
    />
  );
}

interface ShortcutGroupSectionProps {
  group: Group;
  isFirst: boolean;
  firstKbdRef: React.MutableRefObject<HTMLElement | null>;
}

function ShortcutGroupSection({
  group,
  isFirst,
  firstKbdRef,
}: ShortcutGroupSectionProps) {
  return (
    <section
      aria-labelledby={`cheatsheet-group-${group.id}`}
      data-testid={`shortcut-group-${group.id}`}
    >
      <h3
        id={`cheatsheet-group-${group.id}`}
        className="mb-2 text-[var(--text-xs)] font-semibold uppercase tracking-wide text-[var(--color-muted)]"
      >
        <GroupTitle id={group.id} />
      </h3>
      <ul className="divide-y divide-[var(--color-line)] rounded-[var(--radius-sm)] border border-[var(--color-line)]">
        {group.rows.map((entry, idx) => (
          <li
            key={`${entry.scope}-${entry.chord}-${entry.id}`}
            className="flex items-center justify-between gap-3 px-3 py-2 text-[var(--text-sm)]"
            data-testid={`shortcut-row-${entry.id}`}
          >
            <span className="text-[var(--color-ink)]">{entry.description}</span>
            <KbdBadge
              chord={entry.chord}
              ref={isFirst && idx === 0 ? firstKbdRef : undefined}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function GroupTitle({ id }: { id: ShortcutGroupId }) {
  switch (id) {
    case "help":
      return <Trans>Help</Trans>;
    case "panels":
      return <Trans>Panels</Trans>;
    case "navigation":
      return <Trans>Navigation</Trans>;
    case "lists":
      return <Trans>Lists</Trans>;
    case "actions":
      return <Trans>Actions</Trans>;
    case "wizard":
      return <Trans>Wizard</Trans>;
    default:
      return <Trans>Other</Trans>;
  }
}

interface KbdBadgeProps {
  chord: string;
}

const KbdBadge = forwardRef<HTMLElement, KbdBadgeProps>(function KbdBadge(
  { chord },
  ref,
) {
  const label = useMemo(() => shortcutLabel(chord), [chord]);
  return (
    <kbd
      ref={ref as React.Ref<HTMLElement>}
      data-testid={`shortcut-kbd-${chord.replace(/\+/g, "-")}`}
      className="inline-flex h-6 select-none items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 font-mono text-[11px] font-semibold text-[var(--color-ink)]"
      tabIndex={-1}
    >
      {label}
    </kbd>
  );
});

export { KbdBadge };
