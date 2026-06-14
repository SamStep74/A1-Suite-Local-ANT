/**
 * components/keyboard — barrel exports.
 *
 * The keyboard-grammar surface ships as two co-located
 * components: `KeyHandler` (the global keydown listener +
 * default-keymap registrant) and `ShortcutCheatsheet` (the
 * visible cheatsheet dialog). The barrel is the only public
 * surface — route authors and tests should never reach into
 * the individual files.
 */
export { KeyHandler, type KeyHandlerProps } from "./KeyHandler";
export {
  ShortcutCheatsheet,
  KbdBadge,
  type ShortcutCheatsheetProps,
} from "./ShortcutCheatsheet";
