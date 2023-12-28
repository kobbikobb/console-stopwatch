import { Timer } from "./Timer";

export class Timers {
  private timers: Timer[];
  private index: number;

  constructor() {
    this.timers = [new Timer()];
    this.index = 0;
  }

  getIndex() {
    return this.index;
  }

  getCurrentTimer() {
    return this.timers[this.index];
  }

  addTimer() {
    const timer = new Timer();
    this.timers.push(timer);
    this.index = this.timers.length - 1;
    console.log(""); // To add a line for the timer to be displayd
    return timer;
  }

  startCurrentTimer() {
    const timer = this.getCurrentTimer();
    timer.start();
  }

  stopCurrentTimer() {
    const timer = this.getCurrentTimer();
    timer.stop();
  }

  resetCurrentTimer() {
    this.getCurrentTimer().reset();
  }

  toggleCurrentTimer() {
    this.getCurrentTimer().toggle();
  }

  addTimerAfterCurrent() {
    const timer = this.getCurrentTimer();
    const wasRunnig = timer.isRunning();
    timer.stop();
    this.addTimer();
    if (wasRunnig) {
      this.startCurrentTimer();
    }
  }

  moveDown() {
    if (this.index < this.timers.length - 1) {
      this.index++;
      process.stdout.moveCursor(0, +1);
    }
  }

  moveUp() {
    if (this.index > 0) {
      this.index--;
      process.stdout.moveCursor(0, -1);
    }
  }
}
