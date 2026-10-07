/** The part of an undo entry this reads; the command store's entries fit it. */
interface UndoEntryLike {
  command: { type: string }
}

const MAX_CHANGES_SHOWN = 8

/**
 * The user's own edits since the agent's last pass: the undo entries after the
 * last `EXTERNAL_CHANGE` (every entry when no pass has landed), newest first.
 */
export function changesSincePass<T extends UndoEntryLike>(
  undoStack: readonly T[],
  max = MAX_CHANGES_SHOWN,
): T[] {
  let start = 0
  for (let i = undoStack.length - 1; i >= 0; i--) {
    if (undoStack[i]!.command.type === 'EXTERNAL_CHANGE') {
      start = i + 1
      break
    }
  }
  return undoStack.slice(start).reverse().slice(0, max)
}
