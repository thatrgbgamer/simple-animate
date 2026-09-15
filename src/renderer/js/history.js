/**
 * Undo/redo.
 *
 * Two kinds of state are tracked:
 *   - pixels: an ImageData snapshot bound to a specific frame canvas
 *   - doc:    the frame list / size / fps / background (canvases by reference,
 *             which is correct because pixel edits are tracked separately)
 *
 * Each entry stores the state *before* an action. Undo captures the current
 * state into the redo stack first, so one snapshot per action is enough.
 */

const DEFAULT_LIMIT = 40;
const BYTE_BUDGET = 320 * 1024 * 1024;

export class History {
  constructor({ limit = DEFAULT_LIMIT, onChange = () => {} } = {}) {
    this.limit = limit;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange(this);
  }

  /**
   * @param {{label: string, capture: () => any, restore: (state: any) => void, state?: any}} entry
   * `state` is the pre-action snapshot; when omitted it is captured now.
   */
  push(entry) {
    const record = {
      label: entry.label || 'edit',
      capture: entry.capture,
      restore: entry.restore,
      state: 'state' in entry ? entry.state : entry.capture()
    };
    this.undoStack.push(record);
    this.redoStack = [];
    this.trim();
    this.onChange(this);
  }

  undo() {
    const record = this.undoStack.pop();
    if (!record) return false;
    const current = record.capture();
    record.restore(record.state);
    this.redoStack.push({ ...record, state: current });
    this.onChange(this);
    return true;
  }

  redo() {
    const record = this.redoStack.pop();
    if (!record) return false;
    const current = record.capture();
    record.restore(record.state);
    this.undoStack.push({ ...record, state: current });
    this.onChange(this);
    return true;
  }

  trim() {
    while (this.undoStack.length > this.limit) this.undoStack.shift();

    // Full-frame ImageData snapshots are big; keep the stack inside a budget.
    let bytes = 0;
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      bytes += estimateBytes(this.undoStack[i].state);
      if (bytes > BYTE_BUDGET && i > 0) {
        this.undoStack.splice(0, i);
        break;
      }
    }
  }
}

function estimateBytes(state) {
  if (!state) return 0;
  if (state.imageData) return state.imageData.data.length;
  if (state.frames) return state.frames.length * 8;
  return 64;
}
