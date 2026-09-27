import {
    CALM_RAMP,
    colorAt,
    HOT_RAMP,
    rampColorAt,
    rampFor,
    shimmerIntensity,
    WARM_RAMP,
} from "../palette";

const HOUR = 60 * 60 * 1000;

describe("palette", () => {
    it("should use the warm ramp while running", () => {
        expect(rampFor(1000, true)).toBe(WARM_RAMP);
    });

    it("should use the calm ramp while paused", () => {
        expect(rampFor(1000, false)).toBe(CALM_RAMP);
    });

    it("should use the hot ramp past an hour", () => {
        expect(rampFor(HOUR, true)).toBe(HOT_RAMP);
    });

    it("should stay calm when paused past an hour", () => {
        expect(rampFor(HOUR, false)).toBe(CALM_RAMP);
    });

    it("should map intensity onto the ends of the ramp", () => {
        expect(rampColorAt(WARM_RAMP, 0)).toBe(WARM_RAMP[0]);
        expect(rampColorAt(WARM_RAMP, 1)).toBe(WARM_RAMP[WARM_RAMP.length - 1]);
    });

    it("should clamp intensity outside zero to one", () => {
        expect(rampColorAt(WARM_RAMP, -5)).toBe(WARM_RAMP[0]);
        expect(rampColorAt(WARM_RAMP, 5)).toBe(WARM_RAMP[WARM_RAMP.length - 1]);
    });

    it("should keep intensity above the dim floor", () => {
        for (let column = 0; column < 53; column++) {
            expect(shimmerIntensity(column, 53, 1300)).toBeGreaterThan(0);
        }
    });

    it("should reach full brightness under the band", () => {
        expect(shimmerIntensity(0, 53, 0)).toBeCloseTo(1);
    });

    it("should sweep the band across the columns", () => {
        const brightest = [0, 1, 2].map((step) => {
            let best = -1;
            for (let column = 0; column < 53; column++) {
                best = Math.max(
                    best,
                    shimmerIntensity(column, 53, step * 1300),
                );
            }
            return best;
        });

        expect(brightest.every((value) => value > 0.99)).toBe(true);
    });

    it("should move the band to the right over time", () => {
        const peakColumn = (now: number) => {
            let best = -1;
            let bestColumn = -1;
            for (let column = 0; column < 53; column++) {
                const intensity = shimmerIntensity(column, 53, now);
                if (intensity > best) {
                    best = intensity;
                    bestColumn = column;
                }
            }
            return bestColumn;
        };

        expect(peakColumn(0)).toBeLessThan(peakColumn(900));
        expect(peakColumn(900)).toBeLessThan(peakColumn(1900));
    });

    it("should reach every colour in the ramp", () => {
        const used = new Set<number>();

        for (let now = 0; now < 2600; now += 20) {
            for (let column = 0; column < 53; column++) {
                used.add(colorAt(column, 53, now, WARM_RAMP));
            }
        }

        expect([...used].sort((a, b) => a - b)).toEqual(
            [...WARM_RAMP].sort((a, b) => a - b),
        );
    });

    it("should repeat the sweep", () => {
        const intensity = (now: number) => shimmerIntensity(10, 53, now);

        expect(intensity(0)).toBeCloseTo(intensity(2600));
    });
});
