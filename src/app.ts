import readline from "readline";
import { Timers } from "./Timers";
import {
    digitsHeight,
    digitsRequiredWidth,
    hintWidth,
    renderDigits,
    renderHint,
    renderListedTimer,
    renderPlainLine,
} from "./render";
import { millisecondsToClock } from "./timeUtils";

const RENDER_INTERVAL_MILLISECONDS = 50;
const TITLE_INTERVAL_MILLISECONDS = 1000;
const TITLE_PREFIX = "\x1b]0;\u23f1 ";
const TITLE_SUFFIX = "\x07";
// A terminal that has not reported its size gets nothing drawn until it has,
// and the plain line if it never does. Guessing either way means drawing in
// the wrong place or saying nothing at all.
const SIZE_WAIT_MILLISECONDS = 1000;

// Whether the terminal can move the cursor up and down, which is what redrawing
// several rows in place needs. A terminal that cannot still gets the plain line,
// overwritten on its own row.
function hasDigitSupport() {
    return (
        typeof process.stdout.moveCursor === "function" &&
        process.env.TERM !== "dumb"
    );
}

function hasKnownSize() {
    return (
        typeof process.stdout.columns === "number" &&
        typeof process.stdout.rows === "number" &&
        (process.stdout.columns as number) > 0 &&
        (process.stdout.rows as number) > 0
    );
}

// The digits, the rows for the listed timers and the hint under them have to
// fit, and so does the row the cursor ends up parked on below them. Nothing is
// drawn above the region, so that is the only row needed up there.
function canDrawDigits(milliseconds: number, listedTimers: number) {
    if (!hasKnownSize()) {
        return false;
    }
    const { columns, rows } = process.stdout;
    return (
        hasDigitSupport() &&
        (columns as number) >= digitsRequiredWidth(milliseconds) &&
        (rows as number) >= digitsHeight(listedTimers) + 1
    );
}

// Whether the hint can be printed on one row. A hint that wraps takes a second
// row the plain line knows nothing about, and the plain line is exactly what a
// terminal too narrow for the hint gets. An unknown width is left to print it:
// there is nothing to measure against.
function hintFitsOnOneRow() {
    return (
        typeof process.stdout.columns !== "number" ||
        (process.stdout.columns as number) >= hintWidth()
    );
}

export function run() {
    const timers = new Timers();
    timers.startCurrentTimer();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(true);
    }

    // How many rows below the top of the region the cursor has ended up. Every
    // region row ends with a newline, so the cursor is parked that far down and
    // the next redraw has to travel all the way back up.
    let drawnRows = 0;
    // The plain line has no region to put the hint under, so the hint is
    // printed once above it and stays there until the digits take over and
    // reclaim the row.
    let printedHintAbove = false;
    let lastTitleUpdate = Number.NEGATIVE_INFINITY;
    let waitingForSizeSince: number | null = null;

    function wipe() {
        process.stdout.cursorTo(0);
        if (drawnRows === 0) {
            return;
        }
        // The hint can be a row the region sits above, in the case of the plain
        // line, so the wipe clears exactly the rows the last draw owned instead
        // of everything below the cursor.
        //
        // Moving down and back up is only needed when the region is more than
        // one row tall, and a terminal that never drew more than one row never
        // had moveCursor to begin with.
        const taller = drawnRows > 1;
        if (taller) {
            process.stdout.moveCursor(0, -drawnRows);
        }
        for (let row = 0; row < drawnRows; row++) {
            // 1 erases from the cursor to the end of the row, so a row that is
            // wider than what is drawn now is left clean.
            process.stdout.clearLine(1);
            if (row < drawnRows - 1) {
                process.stdout.moveCursor(0, 1);
            }
        }
        if (taller) {
            process.stdout.moveCursor(0, -(drawnRows - 1));
        }
        drawnRows = 0;
    }

    function drawRows(rows: string[]) {
        wipe();
        process.stdout.write(`${rows.join("\n")}\n`);
        drawnRows = rows.length;
    }

    function drawLine(line: string) {
        // The wipe comes first. The hint is a row the line does not own, so
        // printing it before the wipe would leave the line a row lower than the
        // row the next wipe is measured from, and the display would step down
        // one row every time it changed.
        wipe();
        if (!printedHintAbove && hintFitsOnOneRow()) {
            // There is no region to put the hint under, so it goes above the
            // line and stays there.
            console.log(renderHint());
            printedHintAbove = true;
        }
        // The line ends without a newline, which leaves the cursor on its only
        // row and nothing to travel.
        process.stdout.write(line);
        drawnRows = 1;
    }

    function reclaimHintRow() {
        if (!printedHintAbove) {
            return;
        }
        // The hint above the plain line is a row above the region, and the
        // region carries a hint of its own under the timer. Clear it along with
        // the region and start one row higher, so it is not left behind twice.
        process.stdout.cursorTo(0);
        process.stdout.moveCursor(0, -1);
        process.stdout.clearScreenDown();
        drawnRows = 0;
        printedHintAbove = false;
    }

    function updateWindowTitle(milliseconds: number, now: number) {
        if (now - lastTitleUpdate < TITLE_INTERVAL_MILLISECONDS) {
            return;
        }
        lastTitleUpdate = now;
        process.stdout.write(
            `${TITLE_PREFIX}${millisecondsToClock(
                milliseconds,
            )}${TITLE_SUFFIX}`,
        );
    }

    function render() {
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
        const others = timers.getOtherTimers();

        if (canDrawDigits(milliseconds, others.length)) {
            updateWindowTitle(milliseconds, Date.now());
            reclaimHintRow();
            // The hint is a row of the region rather than a line printed once,
            // because it goes under the timer. That means it is redrawn with
            // everything else, and the region is the last thing on the screen,
            // which is what lets the wipe take exactly the rows it drew.
            drawRows([
                ...renderDigits({
                    milliseconds,
                    isRunning: timer.isRunning(),
                }),
                ...others.map((other) =>
                    renderListedTimer({
                        milliseconds: other.getMilliseconds(),
                        isRunning: other.isRunning(),
                    }),
                ),
                renderHint(),
            ]);
            return;
        }

        drawLine(renderPlainLine(milliseconds));
    }

    const interval = setInterval(render, RENDER_INTERVAL_MILLISECONDS);

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
