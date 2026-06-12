/**
 * SavedViews — dropdown that pairs with DataTable's toolbar.
 *
 * Lives inside a `DataTable` toolbar slot (via `renderToolbar`).
 * Owns the save / load / rename / delete flow against the pure
 * `savedViewsStore`, and pushes a `DataTableState` snapshot back up
 * to the parent when the user picks a saved view.
 *
 * The component is intentionally narrow: it knows nothing about the
 * table's columns, only the `DataTableState` shape. Column- or
 * domain-specific state (filters that depend on the schema) should
 * be carried inside the global filter or column filters and saved
 * verbatim — the store round-trips the whole object.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { BookmarkPlus, ChevronDown, Pencil, Trash2 } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/utils/cn";
import {
  type SavedView,
  type SavedViewState,
  deleteView as storeDelete,
  loadViews,
  renameView as storeRename,
  saveView as storeSave,
  subscribeToViews,
} from "../../lib/components/savedViewsStore";

export interface SavedViewsProps {
  tableId: string;
  /** Current table state — used both as the snapshot to save and the
   *  payload to push when a saved view is picked. */
  state: SavedViewState;
  onLoad: (state: SavedViewState) => void;
  /** Optional render slot for an extra button (e.g. "Reset"). */
  renderExtra?: () => ReactNode;
  className?: string;
}

const snapshot = (state: SavedViewState): SavedViewState => ({
  sort: state.sort ? { ...state.sort } : null,
  filter: state.filter,
  page: state.page,
  pageSize: state.pageSize,
  columns: [...state.columns],
});

export function SavedViews({ tableId, state, onLoad, renderExtra, className }: SavedViewsProps) {
  const { t } = useLingui();
  const [views, setViews] = useState<SavedView[]>(() => loadViews(tableId));
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [newName, setNewName] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();

  useEffect(() => {
    const off = subscribeToViews(tableId, () => setViews(loadViews(tableId)));
    return off;
  }, [tableId]);

  // Click-outside / Escape close the menu
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    storeSave(tableId, newName, snapshot(state));
    setNewName("");
    setShowSaveForm(false);
  };

  const handleLoad = (v: SavedView) => {
    onLoad(v.state);
    setOpen(false);
  };

  const handleRenameSubmit = (id: string) => {
    if (!draftName.trim()) return;
    storeRename(tableId, id, draftName);
    setRenamingId(null);
    setDraftName("");
  };

  const handleDelete = (id: string) => {
    storeDelete(tableId, id);
    if (renamingId === id) {
      setRenamingId(null);
      setDraftName("");
    }
  };

  const startRename = (v: SavedView) => {
    setRenamingId(v.id);
    setDraftName(v.name);
  };

  const onNewNameChange = (e: ChangeEvent<HTMLInputElement>) => setNewName(e.target.value);
  const onDraftChange = (e: ChangeEvent<HTMLInputElement>) => setDraftName(e.target.value);

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        data-testid="saved-views-trigger"
        className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)] text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
      >
        <BookmarkPlus className="size-3.5" />
        <Trans>Views</Trans>
        <ChevronDown className="size-3" />
      </button>

      {renderExtra?.()}

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t`Saved views`}
          data-testid="saved-views-menu"
          className="absolute right-0 top-9 z-30 w-72 rounded-[var(--radius-md)] border border-[var(--color-line)] bg-[var(--color-surface)] p-2 shadow-lg"
        >
          {views.length === 0 && (
            <p className="px-2 py-3 text-center text-[var(--text-xs)] text-[var(--color-muted)]">
              <Trans>No saved views yet</Trans>
            </p>
          )}

          {views.length > 0 && (
            <ul className="max-h-56 space-y-0.5 overflow-y-auto">
              {views.map((v) => (
                <li
                  key={v.id}
                  data-testid={`saved-view-row-${v.id}`}
                  className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-1 hover:bg-[var(--color-surface-soft)]"
                >
                  {renamingId === v.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRenameSubmit(v.id);
                      }}
                      className="flex flex-1 items-center gap-1"
                    >
                      <input
                        autoFocus
                        type="text"
                        value={draftName}
                        onChange={onDraftChange}
                        aria-label={t`Rename view`}
                        className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
                      />
                      <button
                        type="submit"
                        className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-xs)] hover:bg-[var(--color-surface-soft)]"
                        data-testid="saved-view-rename-confirm"
                      >
                        <Trans>Save</Trans>
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => handleLoad(v)}
                        data-testid={`saved-view-load-${v.id}`}
                        className="flex-1 truncate text-left text-[var(--text-sm)] text-[var(--color-ink)]"
                        title={v.name}
                      >
                        {v.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => startRename(v)}
                        aria-label={t`Rename view`}
                        data-testid={`saved-view-rename-${v.id}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted)] hover:bg-[var(--color-line)] hover:text-[var(--color-ink)]"
                      >
                        <Pencil className="size-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(v.id)}
                        aria-label={t`Delete view`}
                        data-testid={`saved-view-delete-${v.id}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-muted)] hover:bg-[var(--color-line)] hover:text-[var(--color-ruby)]"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 border-t border-[var(--color-line)] pt-2">
            {showSaveForm ? (
              <form onSubmit={handleSave} className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={onNewNameChange}
                  placeholder={t`Name this view`}
                  aria-label={t`View name`}
                  data-testid="saved-view-name-input"
                  className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-sm)]"
                />
                <button
                  type="submit"
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-xs)] hover:bg-[var(--color-surface-soft)]"
                  data-testid="saved-view-save"
                >
                  <Trans>Save</Trans>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowSaveForm(false);
                    setNewName("");
                  }}
                  className="h-7 rounded-[var(--radius-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-xs)] hover:bg-[var(--color-surface-soft)]"
                >
                  <Trans>Cancel</Trans>
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowSaveForm(true)}
                data-testid="saved-view-show-save"
                className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[var(--text-xs)] text-[var(--color-muted)] hover:bg-[var(--color-surface-soft)]"
              >
                <BookmarkPlus className="size-3" />
                <Trans>Save current view</Trans>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
