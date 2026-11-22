/** Shared motion presets, so every popup and dialog opens and closes the same way. */
const spring = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;
export const anim = {
  /** small menus and popovers */
  pop: { initial: { opacity: 0, scale: 0.96, y: -6 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.98, transition: { duration: 0.1 } }, transition: spring },
  /** dialogs in the middle of the screen */
  sheet: { initial: { opacity: 0, scale: 0.95, y: 14 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.12 } }, transition: spring },
  /** dimmed backdrops */
  fade: { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.16 } },
} as const;
