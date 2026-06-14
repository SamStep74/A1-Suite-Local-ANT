/**
 * lib/keyboard — public surface for the cross-feature keymap.
 *
 * Importers (route authors, the AppLayout shell, tests) should
 * pull from this barrel and never reach into the individual
 * files. Adding a new shortcut surface = adding to the schema
 * union + the `DEFAULT_KEYMAP` + the cheatsheet Trans macro.
 */
export {
  ChordSchema,
  FeatureScopeSchema,
  KeymapEntryBaseSchema,
  ModifierSchema,
  ShortcutGroupIdSchema,
  type Chord,
  type FeatureScope,
  type KeymapEntry,
  type Modifier,
  type ParsedChord,
  type ShortcutGroupId,
} from "./schemas";
export {
  ChordParseError,
  PLATFORM_IS_MAC,
  canonicaliseKey,
  matchesEvent,
  parseChord,
  shortcutLabel,
} from "./grammar";
export {
  __resetKeyboardRegistryForTests,
  dispatch,
  getActiveScope,
  listEntries,
  registerShortcut,
  setActiveScope,
  unregisterShortcut,
} from "./registry";
export { CHEATSHEET_GROUP_ORDER, DEFAULT_KEYMAP } from "./shortcuts";
