import { buildDigitRows, digitsWidth, GLYPH_HEIGHT } from "./blockDigits";
import { menuText } from "./keys";
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

// Printed once, at the top of the display, as the first row of the region. It is
// now the widest thing in the display, so it is what the width gate is set by.
// Written by the key table rather than spelled out here, so the menu cannot name
// a key the handler does not answer to.
const HINT_TEXT = menuText();

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

function colorFor(isRunning: boolean) {
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

// The whole block digit display, top to bottom: the keys, a blank row, the
// timer, a blank row, any other timers, and a blank row under them. This is the
// entire layout, so whoever writes it does not have to know how the display is
// put together, only that it is a list of rows.
export function renderRegion(current: TimerSnapshot, others: TimerSnapshot[]) {
    return [
        renderHint(),
        // The gap between the keys and the timer. The keys are a menu, not part of
        // the timer, and a timer butting up against a menu reads as part of it.
        "",
        ...renderDigits(current),
        // The gap between the timer and whatever is under it. This is the padding
        // that can be seen: there is content above it and content below it. It
        // stays directly under the timer however many other timers are running,
        // so pressing n for a new one never takes the padding away.
        "",
        ...others.map((snapshot) => renderListedTimer(snapshot)),
        // A blank row under the display, so it is not flush against whatever the
        // terminal has below it.
        "",
    ];
}

// The width the display needs at this elapsed time. A row that wraps takes a
// second line the cursor arithmetic does not know about, so the gate has to
// cover every row the display draws: the digits, which grow a column per extra
// hour digit, and the menu, which is wider than the timer ever gets now that it
// names the key that switches display. The menu wins today at every elapsed
// time, but the digits stay in the max so a shorter menu cannot quietly let them
// wrap, which is what the gate is for.
export function digitsRequiredWidth(milliseconds: number) {
    const time = millisecondsToPrettyDuration(milliseconds);
    return Math.max(digitsWidth(time) + PADDING, hintWidth());
}

export function hintWidth() {
    return INDENT.length + HINT_TEXT.length;
}

// The keys, the gap under them, five rows of digits, the gap under the timer,
// one row per listed timer, and the blank row under them. The redraw moves up
// this many rows to get back to where it started, and every one of them has to
// fit, otherwise the write scrolls the screen and the redraw lands somewhere the
// cursor arithmetic cannot describe.
export function digitsHeight(listedTimers: number) {
    return GLYPH_HEIGHT + listedTimers + 4;
}

// The single line of elapsed time. Same colour rule as the block digits, so the
// same stopped timer is not orange in one display and grey in the other.
export function renderPlainLine(snapshot: TimerSnapshot) {
    return foreground(
        colorFor(snapshot.isRunning),
        millisecondsToPrettyDuration(snapshot.milliseconds),
    );
}
