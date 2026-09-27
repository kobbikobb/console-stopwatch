import readline from "readline";
import { Timers } from "./Timers";
import {
    digitsHeight,
    digitsRequiredWidth,
    renderDigits,
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
const HINTS = "r reset  \u00b7  n new  \u00b7  \u2423 pause  \u00b7  esc quit";

// Whether the terminal can move the cursor up and clear below it, which is
// what redrawing several rows in place needs.
function hasDigitSupport() {
    return (
        typeof process.stdout.moveCursor === "function" &&
        typeof process.stdout.clearScreenDown === "function" &&
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

// The digits plus the rows for the listed timers have to fit, and so does the
// row the cursor ends up parked on below them. The hint line takes one more
// row above them.
function canDrawDigits(milliseconds: number, listedTimers: number) {
    if (!hasKnownSize()) {
        return false;
    }
    const { columns, rows } = process.stdout;
    return (
        hasDigitSupport() &&
        (columns as number) >= digitsRequiredWidth(milliseconds) &&
        (rows as number) >= digitsHeight(listedTimers) + 2
    );
}

export function run() {
    const timers = new Timers();
    timers.startCurrentTimer();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(true);
    }

    console.log(HINTS);

    // How many rows below the top of the region the cursor has ended up. Every
    // digits row ends with a newline, so the cursor is parked that far down
    // and the next redraw has to travel all the way back up. The plain line
    // ends without one, which leaves the cursor on its only row and nothing to
    // travel.
    let drawnRows = 0;
    let lastTitleUpdate = Number.NEGATIVE_INFINITY;
    let waitingForSizeSince: number | null = null;

    function wipe() {
        // moveCursor is relative and leaves the column alone, so the cursor has
        // to be put back at the left edge first or the next draw starts part
        // way across the row.
        process.stdout.cursorTo(0);
        if (drawnRows > 0) {
            process.stdout.moveCursor(0, -drawnRows);
        }
        process.stdout.clearScreenDown();
        drawnRows = 0;
    }

    function drawDigits(rows: string[]) {
        wipe();
        process.stdout.write(`${rows.join("\n")}\n`);
        drawnRows = rows.length;
    }

    function drawLine(line: string) {
        // Only travel up and clear if there are digits to take back. A
        // terminal with no cursor support never got that far, and calling these
        // anyway would throw on a pipe.
        if (drawnRows > 0) {
            wipe();
        }
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(line);
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
            drawDigits([
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
