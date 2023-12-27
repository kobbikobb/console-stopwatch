import { Timer } from '../Timer';

describe('Timer', () => {
    it('should be 0 milliseconds when never started', () => {
        const timer = new Timer();
        const result = timer.getMilliseconds();
        expect(result).toBe(0);
    });

    it('should have seconds after started', () => {
        const startDate = new Date('2008-01-01 00:00:00.000');
        const currentDate = new Date('2008-01-01 00:01:00.000');
        const timer = new Timer();

        timer.start(startDate);

        const result = timer.getMilliseconds(currentDate);
        expect(result).toBe(60 * 1000);
    });

    it('should have seconds after starting and stopping and starting', () => {
        const startDate = new Date('2008-01-01 00:00:00.000');
        const stopDate = new Date('2008-01-01 00:01:00.000');
        const secondStartDate = new Date('2008-01-01 00:58:00.000');
        const currentDate = new Date('2008-01-01 00:59:00.000');
        const timer = new Timer();

        timer.start(startDate);
        timer.stop(stopDate);
        timer.start(secondStartDate);

        const result = timer.getMilliseconds(currentDate);

        expect(result).toBe(60 * 1000 * 2);
    });
});
