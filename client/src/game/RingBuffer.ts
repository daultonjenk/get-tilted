/**
 * Fixed-capacity ring buffer with O(1) push, shift, and index access.
 * Replaces Array usage in hot loops where shift()/splice() cause O(n) overhead.
 */
export class RingBuffer<T> {
  private buf: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array<T | undefined>(capacity);
  }

  get length(): number {
    return this.count;
  }

  /** Append to the end. If at capacity, evicts the oldest entry (returns it). */
  push(item: T): T | undefined {
    let evicted: T | undefined;
    if (this.count === this.capacity) {
      evicted = this.buf[this.head];
      this.buf[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }
    this.buf[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    return evicted;
  }

  /** Remove and return the oldest entry. O(1). */
  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.buf[this.head];
    this.buf[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item;
  }

  /** Read by logical index (0 = oldest, length-1 = newest). */
  at(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return this.buf[(this.head + index) % this.capacity];
  }

  /** Remove element at logical index. O(n) in worst case but used rarely (violation cleanup). */
  removeAt(index: number): void {
    if (index < 0 || index >= this.count) return;
    // Shift elements after the removed index toward the head
    for (let i = index; i < this.count - 1; i++) {
      const dst = (this.head + i) % this.capacity;
      const src = (this.head + i + 1) % this.capacity;
      this.buf[dst] = this.buf[src];
    }
    this.count--;
    this.tail = (this.head + this.count) % this.capacity;
    this.buf[this.tail] = undefined;
  }

  /** Reset the buffer, clearing all entries. */
  clear(): void {
    for (let i = 0; i < this.count; i++) {
      this.buf[(this.head + i) % this.capacity] = undefined;
    }
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}
