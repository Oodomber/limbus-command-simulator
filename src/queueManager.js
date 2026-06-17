/**
 * QueueManager — Controls the flow of instructions to the pager window.
 */

class QueueManager {
  constructor() {
    this._queue = [];
    this._current = null;
    this._overlayReady = false;
    this._isAnimating = false;

    // Callbacks set by main process
    this._onShowInstruction = null;
    this._onShowWaiting = null;
    this._onInstructionComplete = null;
    this._onInstructionFail = null;
  }

  setReady(ready) { this._overlayReady = ready; }
  setAnimating(v) { this._isAnimating = v; }

  /**
   * Enqueue instruction(s). Guidance instructions are sent as a batch
   * with navigation. Non-guidance instructions join the queue one by one.
   * @param {Array|Object} instructions
   * @returns {Array} The enqueued instructions
   */
  enqueue(instructions) {
    const list = Array.isArray(instructions) ? instructions : [instructions];

    if (list.length > 0 && list[0].isGuidance) {
      // Guidance batch: send all at once with index/total for navigation
      this._showGuidanceBatch(list);
    } else {
      for (const inst of list) {
        this._queue.push(inst);
      }
      // If nothing currently showing, pop next
      if (!this._current && !this._isAnimating && this._queue.length > 0) {
        this._showNext();
      }
    }

    return list;
  }

  _showGuidanceBatch(batch) {
    if (batch.length === 0) return;
    // Store the batch for navigation
    this._guidanceBatch = batch;
    this._guidanceIndex = 0;
    this._current = batch[0];
    this._isAnimating = true;

    if (this._onShowInstruction) {
      this._onShowInstruction({
        id: batch[0].id,
        text: batch[0].text,
        phase: batch[0].phase,
        isGuidance: true,
        batchIndex: 0,
        batchTotal: batch.length,
      });
    }
  }

  /**
   * Navigate to next guidance instruction in the batch.
   * Returns the instruction or null if at end.
   */
  guidanceNext() {
    if (!this._guidanceBatch || this._guidanceIndex >= this._guidanceBatch.length - 1) return null;
    this._guidanceIndex++;
    const inst = this._guidanceBatch[this._guidanceIndex];
    this._current = inst;
    this._isAnimating = true;
    if (this._onShowInstruction) {
      this._onShowInstruction({
        id: inst.id,
        text: inst.text,
        phase: inst.phase,
        isGuidance: true,
        batchIndex: this._guidanceIndex,
        batchTotal: this._guidanceBatch.length,
      });
    }
    return inst;
  }

  /**
   * Navigate to previous guidance instruction in the batch.
   * Returns the instruction or null if at start.
   */
  guidancePrev() {
    if (!this._guidanceBatch || this._guidanceIndex <= 0) return null;
    this._guidanceIndex--;
    const inst = this._guidanceBatch[this._guidanceIndex];
    this._current = inst;
    this._isAnimating = true;
    if (this._onShowInstruction) {
      this._onShowInstruction({
        id: inst.id,
        text: inst.text,
        phase: inst.phase,
        isGuidance: true,
        batchIndex: this._guidanceIndex,
        batchTotal: this._guidanceBatch.length,
      });
    }
    return inst;
  }

  /**
   * Dismiss the guidance batch (user is done viewing).
   */
  dismissGuidance() {
    this._guidanceBatch = null;
    this._guidanceIndex = 0;
    this._current = null;
    this._isAnimating = false;
    this._showWaiting();
  }

  getGuidanceState() {
    if (!this._guidanceBatch) return null;
    return {
      index: this._guidanceIndex,
      total: this._guidanceBatch.length,
    };
  }

  /**
   * Handle user completing the current instruction.
   * @returns {Object|null} The completed instruction, or null
   */
  handleComplete() {
    return this._handleResult('completed');
  }

  /**
   * Handle user failing the current instruction.
   * @returns {Object|null} The failed instruction, or null
   */
  handleFail() {
    return this._handleResult('failed');
  }

  _handleResult(result) {
    if (!this._current) return null;
    this._current.status = result;
    const completed = this._current;

    // Call callbacks
    if (result === 'completed' && this._onInstructionComplete) {
      this._onInstructionComplete(completed);
    } else if (result === 'failed' && this._onInstructionFail) {
      this._onInstructionFail(completed);
    }

    this._current = null;
    this._isAnimating = false;  // Reset animation flag for next instruction

    if (this._queue.length > 0) {
      this._showNext();
    } else {
      this._showWaiting();
    }

    return completed;
  }

  /**
   * Show an instruction on the overlay. Called internally.
   */
  _showInstruction(inst) {
    this._current = inst;
    this._isAnimating = true;
    if (this._onShowInstruction) {
      this._onShowInstruction({
        id: inst.id,
        text: inst.text,
        phase: inst.phase,
        isGuidance: inst.isGuidance,
      });
    }
  }

  _showNext() {
    if (this._queue.length === 0) {
      this._showWaiting();
      return;
    }
    const next = this._queue.shift();
    this._showInstruction(next);
  }

  _showWaiting() {
    this._current = null;
    this._isAnimating = false;  // Reset so next enqueue works
    if (this._onShowWaiting) {
      this._onShowWaiting();
    }
  }

  /**
   * Notify that typewriter animation has finished on overlay.
   */
  onAnimationDone() {
    this._isAnimating = false;
  }

  /**
   * Force-clear the queue (called on run end).
   */
  clear() {
    this._queue = [];
    this._current = null;
    this._isAnimating = false;
  }

  getState() {
    return {
      current: this._current,
      queueLength: this._queue.length,
      isAnimating: this._isAnimating,
    };
  }

  /** Get the current instruction (if any) */
  getCurrent() {
    return this._current;
  }

  /** Get the pending queue */
  getQueue() {
    return [...this._queue];
  }
}

module.exports = { QueueManager };
