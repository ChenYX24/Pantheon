/** What TerminalReplay needs from xterm, so the ordering can be tested in node. */
export interface ReplayTerminal {
  write(data: Uint8Array, callback: () => void): void
  reset(): void
  resize(cols: number, rows: number): void
}

interface OutputJob {
  kind: 'output'
  data: Uint8Array
  replay: boolean
  /** Which snapshot this belongs to. See restart. */
  generation: number
}

interface ResizeJob {
  kind: 'resize'
  cols: number
  rows: number
  applied: () => void
}

type Job = OutputJob | ResizeJob

type Schedule = (callback: () => void) => number
type Cancel = (handle: number) => void

/**
 * Keeps replay parsing ordered while yielding between chunks.
 *
 * xterm's write callback means that parsing finished, not that the browser had
 * a chance to paint. A mobile browser can therefore receive every 64 KiB
 * frame and process them in one long task, leaving the terminal blank until
 * the tail arrives. A frame boundary between replay writes lets the first
 * rows paint without changing the byte order or interleaving live output.
 */
export class TerminalReplay {
  private queue: Job[] = []
  private active = false
  private activeReplay = false
  private yieldHandle: number | null = null
  private resetBeforeReplay = false
  private disposed = false
  private generation = 0

  constructor(
    private readonly term: ReplayTerminal,
    private readonly schedule: Schedule = (callback) => requestAnimationFrame(callback),
    private readonly cancel: Cancel = (handle) => cancelAnimationFrame(handle),
    private readonly onReplayDone?: () => void,
    /**
     * Bytes of snapshot xterm has finished parsing, reported per chunk.
     *
     * This is what the load bar measures. Counting bytes as they *arrived*
     * put 68% on the bar the moment the network was done, and then held it
     * there for the part that actually took the time: on a fast link the
     * parse is most of the wait, and it had four percent of the bar.
     */
    private readonly onReplayParsed?: (bytes: number) => void,
  ) {}

  /**
   * Whether the snapshot is still being put on screen.
   *
   * Queued chunks count as well as the one being parsed. In the frame between
   * two of them nothing is parsing, but the terminal is still showing a screen
   * from minutes ago, and input sent then answers something that is not there.
   */
  get replaying(): boolean {
    return this.activeReplay || this.queue.some((job) => job.kind === 'output' && job.replay)
  }

  enqueue(data: Uint8Array, replay: boolean): void {
    if (this.disposed) return
    this.queue.push({ kind: 'output', data, replay, generation: this.generation })
    this.drain()
  }

  /**
   * Size notifications share the output order. xterm.write parses later, but
   * resize is synchronous: resizing directly makes queued cursor movements
   * and line wraps run against a grid the producer was not using yet.
   */
  resize(cols: number, rows: number, applied: () => void): void {
    if (this.disposed) return
    this.queue.push({ kind: 'resize', cols, rows, applied })
    this.drain()
  }

  /** Drop queued output after a reconnect and reset before the next snapshot. */
  restart(): void {
    // The chunk xterm is parsing right now still finishes, and still calls
    // back. It belongs to the snapshot being thrown away, so its bytes must
    // not be counted toward the one that replaces it.
    this.generation++
    this.queue = []
    this.resetBeforeReplay = true
    // A yield still pending would hold the new snapshot back a frame, behind
    // bytes that were just thrown away.
    if (this.yieldHandle !== null) {
      this.cancel(this.yieldHandle)
      this.yieldHandle = null
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.yieldHandle !== null) this.cancel(this.yieldHandle)
  }

  private drain(): void {
    if (this.disposed || this.active || this.yieldHandle !== null) return
    let job = this.queue.shift()
    while (job?.kind === 'resize') {
      this.term.resize(job.cols, job.rows)
      job.applied()
      if (this.disposed) return
      job = this.queue.shift()
    }
    if (!job) return
    const output = job

    this.active = true
    this.activeReplay = output.replay
    if (output.replay && this.resetBeforeReplay) {
      this.resetBeforeReplay = false
      this.term.reset()
    }
    this.term.write(output.data, () => {
      // The callback can arrive after dispose(), and nothing may be scheduled
      // against a terminal that no longer exists.
      if (this.disposed) return
      this.active = false
      this.activeReplay = false
      if (output.replay && output.generation === this.generation) this.onReplayParsed?.(output.data.byteLength)
      if (output.replay && output.generation === this.generation
        && !this.queue.some((queued) => queued.kind === 'output' && queued.replay)) {
        this.onReplayDone?.()
      }
      if (this.queue.length === 0) return

      // Only replay chunks need a paint boundary. Live output should stay
      // responsive once the snapshot has been consumed.
      if (output.replay && this.queue[0].kind === 'output' && this.queue[0].replay) {
        this.yieldHandle = this.schedule(() => {
          this.yieldHandle = null
          this.drain()
        })
      } else {
        this.drain()
      }
    })
  }
}
