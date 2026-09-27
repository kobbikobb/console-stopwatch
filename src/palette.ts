const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;

// Hand-picked 6x6x6 colour-cube indices, darkest to lightest.
export const WARM_RAMP = [94, 130, 166, 202, 208, 214, 220, 226, 231];

export const HOT_RAMP = [52, 88, 124, 160, 196, 202];

export const CALM_RAMP = [59, 66, 73, 79, 102, 108, 145, 152, 159];

export const FRAME_COLOR = 240;
export const TITLE_COLOR = 214;
export const LABEL_COLOR = 245;

const SWEEP_PERIOD_MILLISECONDS = 2600;
const SWEEP_BAND_COLUMNS = 14;
const SWEEP_WIDTH = 6;
const DIM_FLOOR = 0.34;

export function rampFor(milliseconds: number, isRunning: boolean) {
    if (!isRunning) {
        return CALM_RAMP;
    }
    if (milliseconds >= HOUR_IN_MILLISECONDS) {
        return HOT_RAMP;
    }
    return WARM_RAMP;
}

export function rampColorAt(ramp: number[], intensity: number) {
    const clamped = Math.max(0, Math.min(1, intensity));
    const index = Math.round(clamped * (ramp.length - 1));
    return ramp[index];
}

// A gaussian bump travelling left to right, once per sweep period.
export function shimmerIntensity(
    column: number,
    totalColumns: number,
    now: number,
) {
    const travel = totalColumns + SWEEP_BAND_COLUMNS;
    const head =
        ((now % SWEEP_PERIOD_MILLISECONDS) / SWEEP_PERIOD_MILLISECONDS) *
        travel;
    const distance = column - head;
    const glow = Math.exp(
        -(distance * distance) / (2 * SWEEP_WIDTH * SWEEP_WIDTH),
    );
    return DIM_FLOOR + (1 - DIM_FLOOR) * glow;
}

// Stretches the dim floor onto the start of the ramp so no entry is dead.
function contrast(intensity: number) {
    return (intensity - DIM_FLOOR) / (1 - DIM_FLOOR);
}

export function colorAt(
    column: number,
    totalColumns: number,
    now: number,
    ramp: number[],
) {
    return rampColorAt(
        ramp,
        contrast(shimmerIntensity(column, totalColumns, now)),
    );
}
