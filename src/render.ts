import { buildDigitRows, digitsWidth, GLYPH_HEIGHT } from "./blockDigits";
import { millisecondsToPrettyDuration } from "./timeUtils";

export type TimerSnapshot = {
    milliseconds: number;
    isRunning: boolean;
};

const RESET = "\x1b[0m";

// Everything in the display is inset by this many columns, so nothing sits
// against the edge of the terminal.
export const PADDING = 2;

const INDENT = " ".repeat(PADDING);

// Printed once, under the timer, as the last row of the region. It has to be
// narrower than the digits, or the gate below would be set by the hint rather
// than by the time.
export const HINT_TEXT =
    "r reset \u00b7 n new \u00b7 \u2423 pause \u00b7 esc quit";

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
    ).map((row) => `${INDENT}${color}${row}${RESET}`);
}

export function renderListedTimer(snapshot: TimerSnapshot) {
    const marker = snapshot.isRunning ? RUNNING_MARKER : PAUSED_MARKER;
    return `${INDENT}${foreground(LISTED_TIMER_COLOR, marker)} ${foreground(
        LISTED_TIMER_COLOR,
        millisecondsToPrettyDuration(snapshot.milliseconds),
    )}`;
}

export function renderHint() {
    return `${INDENT}${foreground(LISTED_TIMER_COLOR, HINT_TEXT)}`;
}

// The widest the display gets before the hours run to three digits. A row that
// wraps takes a second line the cursor arithmetic does not know about, so the
// gate has to cover it: the digits grow by four columns when the first hour
// appears, and a stopwatch that dropped to the plain line at that point would
// look broken. One column of headroom is cheaper than that. A hint wider than
// this is a bug, and blockDigits-test says so.
const WIDTH_WITH_HOURS = digitsWidth("00:00:00.00") + PADDING;

// The width the display needs at this elapsed time. Past 99 hours the hours
// themselves grow a column, so this cannot be a constant.
export function digitsRequiredWidth(milliseconds: number) {
    const time = millisecondsToPrettyDuration(milliseconds);
    return Math.max(digitsWidth(time) + PADDING, WIDTH_WITH_HOURS);
}

export function hintWidth() {
    return INDENT.length + HINT_TEXT.length;
}

// Five rows of digits, one per listed timer, and the hint. The redraw moves up
// this many rows to get back to where it started, and every one of them has to
// fit, otherwise the write scrolls the screen and the redraw lands somewhere
// the cursor arithmetic cannot describe.
export function digitsHeight(listedTimers: number) {
    return GLYPH_HEIGHT + listedTimers + 1;
}

// Unchanged from the original output, used when the terminal is too small for
// the digits.
export function renderPlainLine(milliseconds: number) {
    return foreground(
        RUNNING_COLOR,
        millisecondsToPrettyDuration(milliseconds),
    );
}
