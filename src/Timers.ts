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
        return timer;
    }

    getOtherTimers() {
        return this.timers.filter((_timer, index) => index !== this.index);
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

    // The redraw loop owns the cursor, so switching only moves the index.
    moveDown() {
        if (this.index < this.timers.length - 1) {
            this.index++;
        }
    }

    moveUp() {
        if (this.index > 0) {
            this.index--;
        }
    }
}
