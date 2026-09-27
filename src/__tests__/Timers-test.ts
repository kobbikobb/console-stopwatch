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

    it("should not move the cursor when changing timer", () => {
        // The display is redrawn from the top of its own region, so anything
        // that moves the cursor here would push it out of place.
        const moveCursor = jest.fn();
        process.stdout.moveCursor = moveCursor as unknown as (
            x: number,
            y: number,
        ) => boolean;
        const timers = new Timers();
        timers.addTimer();

        timers.moveUp();
        timers.moveDown();
        timers.moveUp();
        timers.moveUp();

        expect(moveCursor).not.toHaveBeenCalled();
    });

    describe("getOtherTimers", () => {
        it("should be empty with one timer", () => {
            const timers = new Timers();

            expect(timers.getOtherTimers()).toEqual([]);
        });

        it("should be the timers that are not current", () => {
            const timers = new Timers();
            const first = timers.getCurrentTimer();
            timers.addTimer();
            const second = timers.getCurrentTimer();

            expect(timers.getOtherTimers()).toEqual([first]);
            expect(timers.getOtherTimers()).not.toContain(second);
        });

        it("should follow the current timer as it moves", () => {
            const timers = new Timers();
            const first = timers.getCurrentTimer();
            timers.addTimer();
            const second = timers.getCurrentTimer();
            timers.addTimer();
            const third = timers.getCurrentTimer();

            expect(timers.getOtherTimers()).toEqual([first, second]);
            timers.moveUp();
            expect(timers.getOtherTimers()).toEqual([first, third]);
            timers.moveUp();
            expect(timers.getOtherTimers()).toEqual([second, third]);
        });
    });

    describe("moving between timers", () => {
        it("should not move past the first timer", () => {
            const timers = new Timers();
            const first = timers.getCurrentTimer();

            timers.moveUp();

            expect(timers.getCurrentTimer()).toBe(first);
        });

        it("should not move past the last timer", () => {
            const timers = new Timers();
            timers.addTimer();
            const last = timers.getCurrentTimer();

            timers.moveDown();

            expect(timers.getCurrentTimer()).toBe(last);
        });

        it("should move down and back up", () => {
            const timers = new Timers();
            const first = timers.getCurrentTimer();
            timers.addTimer();

            timers.moveUp();
            expect(timers.getCurrentTimer()).toBe(first);
            timers.moveDown();
            expect(timers.getCurrentTimer()).not.toBe(first);
        });
    });
});
