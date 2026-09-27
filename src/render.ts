import {
    buildTimeMatrix,
    GLYPH_HEIGHT,
    isBlinkingColonsOpen,
    matrixWidth,
} from "./bigFont";
import {
    colorAt,
    FRAME_COLOR,
    LABEL_COLOR,
    TITLE_COLOR,
    rampFor,
} from "./palette";
import { millisecondsToPrettyDuration } from "./timeUtils";

export type TimerSnapshot = {
    milliseconds: number;
    isRunning: boolean;
};

export type FrameState = {
    current: TimerSnapshot;
    others: TimerSnapshot[];
    now: number;
};

const RESET = "\x1b[0m";

const HORIZONTAL_PADDING = 2;
const CANONICAL_TIME = "00:00:00.00";

const TITLE = "stopwatch";

const RUNNING_MARKER = "▶";
const PAUSED_MARKER = "⏸";
const RUNNING_MARKER_COLOR = 71;
const PAUSED_MARKER_COLOR = 244;
const LISTED_TIMER_COLOR = 244;

export const MIN_INNER_WIDTH =
    matrixWidth(CANONICAL_TIME) + HORIZONTAL_PADDING * 2;

const LEGEND = ["r reset", "n new", "␣ pause", "esc quit"] as const;

const HINT_TEXT = LEGEND.join("  ·  ");

function foreground(color: number, text: string) {
    return `\x1b[38;5;${color}m${text}${RESET}`;
}

function visibleLength(text: string) {
    return [...text].length;
}

// Paints one row of cells, emitting a colour escape only when the colour
// changes so the shimmer stays cheap at 20 frames per second.
function paint(chars: string[], colorFor: (column: number) => number) {
    let out = "";
    let openColor: number | null = null;

    for (let column = 0; column < chars.length; column++) {
        const character = chars[column];
        if (character === " ") {
            if (openColor !== null) {
                out += RESET;
                openColor = null;
            }
            out += " ";
            continue;
        }
        const color = colorFor(column);
        if (color !== openColor) {
            out += `\x1b[38;5;${color}m`;
            openColor = color;
        }
        out += character;
    }

    if (openColor !== null) {
        out += RESET;
    }
    return out;
}

function timeRows(
    milliseconds: number,
    isRunning: boolean,
    now: number,
    innerWidth: number,
) {
    const matrix = buildTimeMatrix(millisecondsToPrettyDuration(milliseconds));
    if (!isBlinkingColonsOpen(now)) {
        for (const column of matrix.colonColumns) {
            for (const row of matrix.rows) {
                row[column] = " ";
            }
        }
    }

    const ramp = rampFor(milliseconds, isRunning);
    const content = matrix.rows[0].length;
    const available = innerWidth - HORIZONTAL_PADDING * 2;
    const leading = Math.max(0, Math.floor((available - content) / 2));
    const trailing = Math.max(0, available - content - leading);
    const blank = " ".repeat(HORIZONTAL_PADDING);

    return matrix.rows.map((row) => {
        const cells = [...Array.from({ length: leading }, () => " "), ...row];
        const shimmered = paint(cells, (column) =>
            colorAt(column, content, now, ramp),
        );
        return `${foreground(FRAME_COLOR, "│")}${blank}${shimmered}${" ".repeat(
            trailing,
        )}${blank}${foreground(FRAME_COLOR, "│")}`;
    });
}

function captionBorder(
    left: string,
    right: string,
    label: string,
    innerWidth: number,
) {
    const available = innerWidth - 1;
    const fitted =
        visibleLength(label) > available
            ? [...label].slice(0, Math.max(0, available - 1)).join("") + "…"
            : label;
    const dashes = Math.max(1, innerWidth - visibleLength(fitted) - 1);
    return `${foreground(FRAME_COLOR, left)}${foreground(
        LABEL_COLOR,
        fitted,
    )}${foreground(FRAME_COLOR, "─".repeat(dashes) + right)}`;
}

function blankBorderRow(innerWidth: number) {
    return `${foreground(FRAME_COLOR, "│")}${" ".repeat(
        innerWidth,
    )}${foreground(FRAME_COLOR, "│")}`;
}

function listedTimerRow(snapshot: TimerSnapshot) {
    const marker = snapshot.isRunning ? RUNNING_MARKER : PAUSED_MARKER;
    const markerColor = snapshot.isRunning
        ? RUNNING_MARKER_COLOR
        : PAUSED_MARKER_COLOR;
    const elapsed = millisecondsToPrettyDuration(snapshot.milliseconds);
    return `  ${foreground(markerColor, marker)} ${foreground(
        LISTED_TIMER_COLOR,
        elapsed,
    )}`;
}

export function renderBigFrame(state: FrameState): string[] {
    const { current, others, now } = state;
    const innerWidth = Math.max(
        MIN_INNER_WIDTH,
        matrixWidth(millisecondsToPrettyDuration(current.milliseconds)) +
            HORIZONTAL_PADDING * 2,
    );

    return [
        captionBorder("╭─", "╮", ` ${TITLE} `, innerWidth),
        blankBorderRow(innerWidth),
        ...timeRows(current.milliseconds, current.isRunning, now, innerWidth),
        blankBorderRow(innerWidth),
        captionBorder("╰─", "╯", ` ${HINT_TEXT} `, innerWidth),
        ...others.map(listedTimerRow),
    ];
}

// Unchanged from the pre-animation output, used when the terminal cannot draw
// the frame.
export function renderPlainLine(milliseconds: number) {
    return foreground(TITLE_COLOR, millisecondsToPrettyDuration(milliseconds));
}

export function bigFrameRequiredWidth(milliseconds: number) {
    return (
        matrixWidth(millisecondsToPrettyDuration(milliseconds)) +
        HORIZONTAL_PADDING * 2 +
        2
    );
}

// Two borders and two blank rows around the digits, plus one row per listed
// timer. The frame is only safe to draw when the terminal is at least this
// tall, otherwise the write scrolls the screen and the redraw can no longer
// land on the same rows.
export function bigFrameHeight(listedTimers: number) {
    return 4 + GLYPH_HEIGHT + listedTimers;
}
