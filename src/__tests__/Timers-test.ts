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

    it("should only change which timer is current", () => {
        // Moving is a change of the index and nothing else. The display is
        // redrawn from the top of its own region, so a move that touched a timer
        // - one added, started or stopped - would leave the rows on the screen
        // describing something that is no longer true.
        const timers = new Timers();
        timers.startCurrentTimer();
        // The timer a new one is added after becomes the current one, so the two
        // are named from there and not from the order they were made in.
        timers.addTimer();
        timers.startCurrentTimer();
        const second = timers.getCurrentTimer();
        const first = timers.getOtherTimers()[0];

        timers.moveUp();
        timers.moveDown();
        timers.moveUp();
        timers.moveUp();

        expect(timers.getIndex()).toBe(0);
        expect(timers.getCurrentTimer()).toBe(first);
        expect(timers.getOtherTimers()).toEqual([second]);
        expect([first.isRunning(), second.isRunning()]).toEqual([true, true]);
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
