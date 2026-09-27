import { Timers } from "../Timers";

describe("Timers", () => {
    it("should get one timer by default", () => {
        const timers = new Timers();

        const result = timers.getCurrentTimer();

        expect(result).not.toBe(null);
        expect(result.isRunning()).toBe(false);
        expect(timers.getIndex()).toBe(0);
    });
    it("should add timer", () => {
        const timers = new Timers();

        timers.addTimer();

        const currentTimer = timers.getCurrentTimer();
        expect(currentTimer).not.toBe(null);
        expect(currentTimer.isRunning()).toBe(false);
        expect(timers.getIndex()).toBe(1);
    });
    it("should start current timer", () => {
        const timers = new Timers();

        timers.startCurrentTimer();

        expect(timers.getCurrentTimer().isRunning()).toBe(true);
    });
    it("should list the other timers", () => {
        const timers = new Timers();

        expect(timers.getOtherTimers()).toHaveLength(0);

        timers.addTimerAfterCurrent();
        timers.addTimerAfterCurrent();

        expect(timers.getOtherTimers()).toHaveLength(2);
        expect(timers.getOtherTimers()).not.toContain(timers.getCurrentTimer());
    });
    it("should move the index up and down", () => {
        const timers = new Timers();
        timers.addTimer();

        timers.moveUp();
        expect(timers.getIndex()).toBe(0);
        expect(timers.getOtherTimers()).toHaveLength(1);

        timers.moveDown();
        expect(timers.getIndex()).toBe(1);
        expect(timers.getOtherTimers()).toHaveLength(1);
    });
    it("should not move past the ends", () => {
        const timers = new Timers();

        timers.moveUp();
        expect(timers.getIndex()).toBe(0);

        timers.moveDown();
        expect(timers.getIndex()).toBe(0);
    });
    it("should not move the cursor when moving the index", () => {
        const timers = new Timers();
        timers.addTimer();
        const originalMoveCursor = process.stdout.moveCursor;
        const moveCursor = jest.fn();
        process.stdout.moveCursor = moveCursor;

        try {
            timers.moveUp();
            timers.moveDown();
        } finally {
            // Leaving the fake in place would leak into every later test file
            // sharing this worker.
            process.stdout.moveCursor = originalMoveCursor;
        }

        expect(moveCursor).not.toHaveBeenCalled();
    });
});
