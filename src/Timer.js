// @ts-nocheck

export class Timer {
  constructor() {
    this.intervals = [];
    this.current = null;
  }

  start(targetDate = new Date()) {
    if (this.current === null) {
      this.current = {
        started: targetDate,
        ended: null
      };
      this.intervals.push(this.current);
    }
  }

  stop(targetDate = new Date()) {
    if (this.current !== null) {
      (this.current.ended = targetDate), (this.current = null);
    }
  }

  toggle() {
    if (this.current === null) {
      this.start();
    } else {
      this.stop();
    }
  }

  isRunning() {
    return this.current !== null;
  }

  reset() {
    const wasRunning = this.isRunning();
    this.intervals = [];
    this.current = null;
    if (wasRunning) {
      this.start();
    }
  }

  getMilliseconds(targetDate = new Date()) {
    let milliseconds = 0;
    for (let i = 0; i < this.intervals.length; i++) {
      const interval = this.intervals[i];
      milliseconds += (interval.ended || targetDate) - interval.started;
    }
    return milliseconds;
  }
}
