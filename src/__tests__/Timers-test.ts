import { Timers } from '../Timers';

describe('Timers', () => {
    it('should get one timer by default', () => {
        const timers = new Timers();

        const result = timers.getCurrentTimer();

        expect(result).not.toBe(null);
        expect(result.isRunning()).toBe(false);
        expect(timers.getIndex()).toBe(0);
    });
    it('should add timer', () => {
        const timers = new Timers();

        timers.addTimer();

        const currentTimer = timers.getCurrentTimer();
        expect(currentTimer).not.toBe(null);
        expect(currentTimer.isRunning()).toBe(false);
        expect(timers.getIndex()).toBe(1);
    });
    it('should start current timer', () => {
        const timers = new Timers();

        timers.startCurrentTimer();

        expect(timers.getCurrentTimer().isRunning()).toBe(true);
    });
});
