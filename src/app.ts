import readline from "readline";
import { Timers } from "./Timers";
import {
    bigFrameHeight,
    bigFrameRequiredWidth,
    renderBigFrame,
    renderPlainLine,
} from "./render";
import { millisecondsToPrettyDuration } from "./timeUtils";

const FRAME_INTERVAL_MILLISECONDS = 50;
const TITLE_INTERVAL_MILLISECONDS = 1000;
const TITLE_PREFIX = "\x1b]0;⏱ ";
const TITLE_SUFFIX = "\x07";
// How long to wait for a terminal to report its size before giving up and
// writing the plain line anyway. Some terminals never report one, and this app
// has always printed something.
const SIZE_WAIT_MILLISECONDS = 1000;

const MENU_LINES = [
    "Press r to reset current timer.",
    "Press n to create a new timer.",
    "Press any other key to pause current timer.",
    "Press ctrl+c or escape to exit.",
];

type Mode = "frame" | "line";

// Whether the terminal could ever draw the frame. Decided without looking at
// the width, so a size that is not known yet does not rule it out.
function hasFrameSupport() {
    return (
        typeof process.stdout.moveCursor === "function" &&
        typeof process.stdout.clearScreenDown === "function" &&
        process.env.TERM !== "dumb"
    );
}

// A terminal that has not reported its size yet. Drawing now would mean
// guessing, and a wrong guess either scrolls the screen or leaves a frame
// stranded in the wrong place.
function hasKnownSize() {
    const { columns, rows } = process.stdout;
    return (
        typeof columns === "number" &&
        columns > 0 &&
        typeof rows === "number" &&
        rows > 0
    );
}

// The frame has to fit in both directions. Width keeps the rows from wrapping,
// height keeps the write from scrolling: either one and the cursor arithmetic
// stops describing where the frame actually is. The extra row is for the
// newline the write ends on, which parks the cursor below the last digit.
function canDrawFrame(milliseconds: number, listedTimers: number) {
    const { columns, rows } = process.stdout;
    if (!hasKnownSize()) {
        return false;
    }
    return (
        hasFrameSupport() &&
        (columns as number) >= bigFrameRequiredWidth(milliseconds) &&
        (rows as number) >= bigFrameHeight(listedTimers) + 1
    );
}

export function run() {
    const timers = new Timers();
    timers.startCurrentTimer();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(true);
    }

    // Start optimistic: if the terminal can draw a frame, wait for the first
    // paint to learn the width rather than flashing the fallback menu.
    let mode: Mode = hasFrameSupport() ? "frame" : "line";
    let menuPrinted = false;
    let drawnRows = 0;
    let lastTitleUpdate = Number.NEGATIVE_INFINITY;
    let waitingForSizeSince: number | null = null;

    function printMenu() {
        for (const line of MENU_LINES) {
            console.log(line);
        }
        console.log();
        menuPrinted = true;
    }

    // Every draw ends with a newline, so the cursor sits one line below the
    // block and the redraw has to travel the whole height, not height - 1.
    function wipeFrame() {
        if (drawnRows === 0) {
            return;
        }
        // moveCursor is relative and leaves the column alone, so a frame drawn
        // straight after a plain line would start part way across the row.
        process.stdout.cursorTo(0);
        process.stdout.moveCursor(0, -drawnRows);
        process.stdout.clearScreenDown();
        drawnRows = 0;
    }

    function drawFrame(rows: string[]) {
        wipeFrame();
        // The first frame of a session lands wherever the shell prompt left the
        // cursor, which is usually part way across the row, and the frame is
        // wider than the space that is left.
        process.stdout.cursorTo(0);
        process.stdout.write(`${rows.join("\n")}\n`);
        drawnRows = rows.length;
    }

    function drawLine(line: string) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(line);
        // The line sits below the menu printMenu just wrote, and the next wipe
        // has to take the whole region with it: forgetting the menu leaves a
        // copy of it on screen every time the display changes mode. The cursor
        // is left on the last row drawn, so that is what it takes to get back
        // to the top of the region. Counting the line as a row of its own would
        // climb a row every time the display changed and eventually wipe
        // whatever was printed above.
        drawnRows = MENU_LINES.length + 1;
    }

    function updateWindowTitle(milliseconds: number, now: number) {
        if (now - lastTitleUpdate < TITLE_INTERVAL_MILLISECONDS) {
            return;
        }
        lastTitleUpdate = now;
        const [clock] = millisecondsToPrettyDuration(milliseconds).split(".");
        process.stdout.write(`${TITLE_PREFIX}${clock}${TITLE_SUFFIX}`);
    }

    function render() {
        // A terminal that has not reported its size yet gets nothing drawn: a
        // guess would either scroll the screen or strand a frame. When stdout
        // is not a terminal there is nothing to wait for, and the plain line
        // is written straight away exactly as before.
        if (process.stdout.isTTY && !hasKnownSize()) {
            waitingForSizeSince ??= Date.now();
            if (Date.now() - waitingForSizeSince < SIZE_WAIT_MILLISECONDS) {
                return;
            }
        } else {
            waitingForSizeSince = null;
        }
        const timer = timers.getCurrentTimer();
        const milliseconds = timer.getMilliseconds();
        const now = Date.now();
        const others = timers.getOtherTimers();
        const nextMode: Mode = canDrawFrame(milliseconds, others.length)
            ? "frame"
            : "line";

        if (nextMode !== mode) {
            wipeFrame();
            mode = nextMode;
            menuPrinted = false;
        }

        if (mode === "line") {
            if (!menuPrinted) {
                printMenu();
            }
            drawLine(renderPlainLine(milliseconds));
            return;
        }

        updateWindowTitle(milliseconds, now);
        drawFrame(
            renderBigFrame({
                current: { milliseconds, isRunning: timer.isRunning() },
                others: others.map((other) => ({
                    milliseconds: other.getMilliseconds(),
                    isRunning: other.isRunning(),
                })),
                now,
            }),
        );
    }

    if (mode === "line") {
        printMenu();
    }

    const interval = setInterval(render, FRAME_INTERVAL_MILLISECONDS);

    function stop() {
        clearInterval(interval);
        process.exit(0);
    }

    process.stdin.on("keypress", (_str, key) => {
        if (!key) {
            return;
        }
        if ((key.ctrl && key.name === "c") || key.name === "escape") {
            stop();
        } else if (key.name === "r") {
            timers.resetCurrentTimer();
        } else if (key.name === "n") {
            timers.addTimerAfterCurrent();
            timers.startCurrentTimer();
        } else if (key.name === "up") {
            timers.moveUp();
        } else if (key.name === "down") {
            timers.moveDown();
        } else {
            timers.toggleCurrentTimer();
        }
    });
}
