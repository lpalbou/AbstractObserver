// Batched append buffer for ledger stream records (hooks P3, observer lane).
//
// WHY: the run view used to do `set_records((prev) => [...prev, one])` per
// ledger event — a full array copy per record, O(N²) cumulative, plus one
// pass of every records-derived useMemo per event. At replay time (attaching
// to a long ledger, 200-record pages) and at resident scale (~5k events/day,
// the fleet DONE bar) that degrades the tab measurably — the exact class the
// entity view's foldUpToIndex wave fixed (2026-07-09 scale contracts).
//
// SHAPE: push() collects into a pending list and schedules ONE flush through
// the injected scheduler; the flush hands the whole batch to on_flush (the
// caller does a single `prev.concat(batch)` state update). reset() bumps a
// generation so an already-scheduled stale flush from a previous run/source
// can never leak records into the new one.
export class RecordBuffer<T> {
  private pending: T[] = [];
  private scheduled = false;
  private generation = 0;

  constructor(
    private readonly schedule: (flush: () => void) => void,
    private readonly on_flush: (items: T[]) => void,
  ) {}

  push(item: T): void {
    this.pending.push(item);
    if (this.scheduled) return;
    this.scheduled = true;
    const gen = this.generation;
    this.schedule(() => {
      // A reset() between schedule and fire invalidates this flush entirely:
      // it must not touch the new generation's pending list or flag.
      if (gen !== this.generation) return;
      this.scheduled = false;
      const items = this.pending;
      this.pending = [];
      if (items.length) this.on_flush(items);
    });
  }

  /** Drop pending items and invalidate any scheduled flush (run switch). */
  reset(): void {
    this.generation += 1;
    this.pending = [];
    this.scheduled = false;
  }

  /** Test/diagnostic surface: how many items await the next flush. */
  pending_count(): number {
    return this.pending.length;
  }
}
