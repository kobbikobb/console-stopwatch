import readline, { type Key } from "readline";
import type { Timer } from "./Timer";
import { Timers } from "./Timers";
import { findBinding, type KeyAction } from "./keys";
import { digitsOutput, lineOutput } from "./output";
import { millisecondsToClock } from "./timeUtils";
import type { TimerSnapshot } from "./render";
import { hasKnownSize } from "./terminal";
import { DEFAULT_DISPLAY, readDisplay, writeDisplay } from "./settings";

const RENDER_INTERVAL_MILLISECONDS = 50;
const TITLE_INTERVAL_MILLISECONDS = 1000;
const TITLE_PREFIX = "\x1b]0;\u23f1 ";
const TITLE_SUFFIX = "\x07";
// A terminal that has not reported its size gets nothing drawn until it has,
// and the plain line if it never does. Guessing either way means drawing in
// the wrong place or saying nothing at all.
const SIZE_WAIT_MILLISECONDS = 1000;

// What a caller needs in order to end a run. A run starts a keypress listener
// and a redraw timer that both outlive the call that started them, so the only
// way they can be taken back down again is for the caller to be given a way to.
export interface RunHandle {
    stop(): void;
}

export function run(): RunHandle {
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
    const digits = digitsOutput();
    const line = lineOutput();
    let current = line;
    // The display the user last asked for, remembered from the last run. The
    // default is the block digits whenever the terminal is big enough for them,
    // which is what the app has always done on its own, so a first run and a run
    // with an unreadable settings file behave the same.
    let display = readDisplay() ?? DEFAULT_DISPLAY;
    let lastTitleUpdate = Number.NEGATIVE_INFINITY;
    let waitingForSizeSince: number | null = null;

    const snapshot = (timer: Timer): TimerSnapshot => ({
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

        // The title is the app's, not a display's, so it is written the same way
        // whichever provider is drawing - it is a title, not a frame, and it
        // belongs to neither display. Whether this frame gets that far is the
        // size gate's decision above, not the title's own.
        updateWindowTitle(currentSnapshot.milliseconds, Date.now());

        // Which display to use is a preference and a measurement, in that order.
        // The preference says which one to try first, so the block digits stay
        // the default and pressing d pins the plain line instead; the measurement
        // still gets the last word, so a preference the terminal cannot honour
        // falls back rather than drawing something it cannot draw. Handing over
        // clears the rows the outgoing display owned, so the incoming one never
        // draws on top of what is already there.
        const order = display === "digits" ? [digits, line] : [line, digits];
        const wanted =
            order.find((provider) =>
                provider.canDraw(currentSnapshot, others.length),
            ) ?? line;
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

    // The two things this run started, given back to whoever started it. The
    // listener is named rather than inline so it can be taken off again, and
    // the stop is idempotent so a handle is safe to hold and call twice.
    let stopped = false;

    function stop() {
        if (stopped) {
            return;
        }
        stopped = true;
        clearInterval(interval);
        process.stdin.off("keypress", onKeypress);
    }

    // What each key in the table is for, as a function. The table names the set
    // of actions and this holds one of each, so a key added there is a key whose
    // behaviour somebody has to write here: an action with nothing behind it
    // does not compile.
    const actions: Record<KeyAction, () => void> = {
        quit() {
            // Tearing the run down and ending the process are separate
            // decisions, so a caller that only wanted the stopwatch to stop
            // does not have to end the process with it. This is the CLI, where
            // esc has always meant quit, and the run is stopped first so
            // nothing is left listening or drawing on the way out.
            stop();
            process.exit(0);
        },
        reset() {
            timers.resetCurrentTimer();
        },
        newTimer() {
            timers.addTimerAfterCurrent();
            timers.startCurrentTimer();
        },
        moveUp() {
            timers.moveUp();
        },
        moveDown() {
            timers.moveDown();
        },
        toggle() {
            timers.toggleCurrentTimer();
        },
        toggleDisplay() {
            // Switch display and remember it. The choice is written straight away
            // rather than on the way out, because esc ends the process and a
            // choice made just before pressing it should not be the one that is
            // lost.
            display = display === "digits" ? "line" : "digits";
            writeDisplay(display);
        },
    };

    function onKeypress(_str: string | undefined, key: Key) {
        if (!key) {
            return;
        }
        // Which key this is and what it is for is the table's question, not this
        // function's, so a keypress that is not in the table has nothing to
        // dispatch to. Treating every unbound key as a pause meant a key aimed
        // at nothing silently stopped the timer, which is worse than doing
        // nothing.
        const binding = findBinding(key);
        if (!binding) {
            return;
        }
        actions[binding.action]();
    }

    process.stdin.on("keypress", onKeypress);

    return { stop };
}
