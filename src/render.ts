import { buildDigitRows, digitsWidth, GLYPH_HEIGHT } from "./blockDigits";
import { millisecondsToPrettyDuration } from "./timeUtils";

export type TimerSnapshot = {
    milliseconds: number;
    isRunning: boolean;
};

const RESET = "\x1b[0m";

// The colour the original single line used, so a running stopwatch looks the
// same as it always has.
const RUNNING_COLOR = 214;
const PAUSED_COLOR = 244;

const RUNNING_MARKER = "▶";
const PAUSED_MARKER = "⏸";
const LISTED_TIMER_COLOR = 244;

function foreground(color: number, text: string) {
    return `\x1b[38;5;${color}m${text}${RESET}`;
}

export function colorFor(isRunning: boolean) {
    return isRunning ? RUNNING_COLOR : PAUSED_COLOR;
}

export function renderDigits(snapshot: TimerSnapshot) {
    // The colour opens once per row rather than once per block, so each row is
    // one escape-wrapped string. An empty coloured string would reset itself
    // before any glyph was drawn.
    const color = `\x1b[38;5;${colorFor(snapshot.isRunning)}m`;
    return buildDigitRows(
        millisecondsToPrettyDuration(snapshot.milliseconds),
    ).map((row) => `${color}${row}${RESET}`);
}

export function renderListedTimer(snapshot: TimerSnapshot) {
    const marker = snapshot.isRunning ? RUNNING_MARKER : PAUSED_MARKER;
    return `  ${foreground(LISTED_TIMER_COLOR, marker)} ${foreground(
        LISTED_TIMER_COLOR,
        millisecondsToPrettyDuration(snapshot.milliseconds),
    )}`;
}

// The width the digits need at this elapsed time. An hour past 99 grows a
// column, so this cannot be a constant.
export function digitsRequiredWidth(milliseconds: number) {
    return digitsWidth(millisecondsToPrettyDuration(milliseconds));
}

// Five rows of digits, plus one row per listed timer. The redraw moves up
// this many rows to get back to where it started, and every one of them has to
// fit, otherwise the write scrolls the screen and the redraw lands somewhere
// the cursor arithmetic cannot describe.
export function digitsHeight(listedTimers: number) {
    return GLYPH_HEIGHT + listedTimers;
}

// Unchanged from the original output, used when the terminal is too small for
// the digits.
export function renderPlainLine(milliseconds: number) {
    return foreground(
        RUNNING_COLOR,
        millisecondsToPrettyDuration(milliseconds),
    );
}
