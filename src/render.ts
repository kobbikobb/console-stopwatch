import { buildDigitRows, digitsWidth } from "./blockDigits";
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
//
// The number of rows is not kept beside these. It is their length, asked of the
// layout rather than counted out of it a second time, so a gap added to one and
// forgotten in the other cannot leave a gate answering for a display that does
// not exist.
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

// The plain line's display, as rows: the ones printed once above the line, and
// the ones it owns and redraws in place. Assembled here for the same reason the
// block digits are, so where the gaps go is a question this module answers once
// for both displays rather than something a caller places by hand.
//
// `region` is whether the line is a display in its own right - rows it owns and
// a redraw can travel back up to - or a single row the cursor is left on, which
// is the only thing a terminal that cannot move its cursor can redraw. When it is
// one, the line gets the blank row under it that the block digits end with,
// and the keys above it get the gap under them that the digits put under their
// menu, so the two are not two different rhythms. When it is not, neither gap
// exists: there is nowhere to put one that a redraw could take back.
//
// `menuFits` is whether the keys can be printed on one row. Nothing is left
// above the line when they cannot, rather than a menu that took a second row
// the line knows nothing about.
//
// `rows` is the height the terminal reports, so the other timers can be listed
// under the line on one display as well as the other. It is a measurement rather
// than a terminal because the layout is not allowed to know what it is drawn on,
// and undefined when the terminal has not reported one - which is left to list
// them all, the same way an unknown width is left to print the menu.
export function renderLine(
    snapshot: TimerSnapshot,
    others: TimerSnapshot[],
    options: { region: boolean; menuFits: boolean; rows?: number },
) {
    const above = !options.menuFits
        ? []
        : options.region
          ? [renderHint(), ""]
          : [renderHint()];

    // The rows the display takes with nothing listed under it: the line, and the
    // blank row under it. Counted off the rows themselves rather than out of a
    // number kept beside them, so a row added to the display is a row the
    // fitting below has heard about.
    const bare = options.region
        ? [renderPlainLine(snapshot), ""]
        : [renderPlainLine(snapshot)];

    // A listed timer is a row of the display, so a terminal with no rows to spare
    // gets the line on its own rather than a display that scrolls a row every
    // frame. The rows that are there either way come off the top first - the menu
    // above the line, the line and its blank row, and the row the cursor parks on
    // - and what is left is what the listed timers get. A display that is not a
    // region owns one row and can redraw no other, so nothing is listed on it.
    const taken = above.length + bare.length + 1 + 1;
    const spare =
        typeof options.rows === "number"
            ? Math.max(0, Math.min(others.length, options.rows - taken))
            : others.length;
    const listed = options.region ? others.slice(0, spare) : [];

    return {
        // The gap under the keys belongs to the keys, so there is no gap at all
        // when they are not printed. Anything else would be a blank row above the
        // line that nothing put there, and the line would be a row lower than the
        // rows it owns, which is the thing a redraw cannot measure itself from.
        above,
        // The same rhythm the block digits have at their scale: the timer, the gap
        // under it, the other timers, and the blank row the display ends with.
        // With nothing listed the gap and the blank row are one row, which is why
        // `bare` is already the display with none listed - a listed timer opens
        // the gap the digits keep under their timer rather than taking the blank
        // row that display ends with away.
        rows:
            listed.length === 0
                ? bare
                : [bare[0], "", ...listed.map(renderListedTimer), ""],
    };
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

// The single line of elapsed time. Same colour rule as the block digits, so the
// same stopped timer is not orange in one display and grey in the other. Inset by
// the same padding as every other row, because it is a row of a display rather
// than a line on its own: the listed timers under it are indented, and a line
// flush against the edge with the rows under it stepped in reads as two displays
// rather than one. The display it belongs to is renderLine above, which is what
// decides whether it is a row of a region or a row of its own.
export function renderPlainLine(snapshot: TimerSnapshot) {
    return `${INDENT}${foreground(
        colorFor(snapshot.isRunning),
        millisecondsToPrettyDuration(snapshot.milliseconds),
    )}`;
}
