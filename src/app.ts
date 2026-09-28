import readline from "readline";
import { Timers } from "./Timers";
import { advancedOutput, standardOutput } from "./output";
import { millisecondsToClock } from "./timeUtils";
import type { TimerSnapshot } from "./render";
import { hasKnownSize } from "./terminal";

const RENDER_INTERVAL_MILLISECONDS = 50;
const TITLE_INTERVAL_MILLISECONDS = 1000;
const TITLE_PREFIX = "\x1b]0;\u23f1 ";
const TITLE_SUFFIX = "\x07";
// A terminal that has not reported its size gets nothing drawn until it has,
// and the plain line if it never does. Guessing either way means drawing in
// the wrong place or saying nothing at all.
const SIZE_WAIT_MILLISECONDS = 1000;

export function run() {
    const timers = new Timers();
    timers.startCurrentTimer();

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
        process.stdin.setRawMode(true);
    }

    // Both ways of showing the timers are built once and kept, because each one
    // remembers the rows it owns. Which one is live is a question about the
    // terminal, so it is asked again every frame and can change when the
    // terminal is resized.
    const advanced = advancedOutput();
    const standard = standardOutput();
    let current = standard;
    let lastTitleUpdate = Number.NEGATIVE_INFINITY;
    let waitingForSizeSince: number | null = null;

    const snapshot = (timer: {
        getMilliseconds: () => number;
        isRunning: () => boolean;
    }): TimerSnapshot => ({
        milliseconds: timer.getMilliseconds(),
        isRunning: timer.isRunning(),
    });

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
        const others = timers.getOtherTimers();
        const currentSnapshot = snapshot(timer);

        // The title is the app's, not a display's: it is mirrored whichever way
        // the timers are being shown, so it does not wait for a provider that
        // can draw.
        updateWindowTitle(currentSnapshot.milliseconds, Date.now());

        // The standard line fits anywhere, so the choice is which of the two can
        // draw rather than whether one of them can. Handing over clears the rows
        // the outgoing display owned, so the incoming one never draws on top of
        // what is already there.
        const wanted = advanced.canDraw(currentSnapshot, others.length)
            ? advanced
            : standard;
        if (wanted !== current) {
            current.clear();
            current = wanted;
        }

        current.draw(
            currentSnapshot,
            others.map((other) => snapshot(other)),
        );
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
