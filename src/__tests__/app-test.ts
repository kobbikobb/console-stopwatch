import fs from "fs";
import os from "os";
import path from "path";
import { run, type RunHandle } from "../app";
import { GLYPH_HEIGHT } from "../blockDigits";
import { BINDINGS, type KeyAction } from "../keys";

const ESC = String.fromCharCode(27);

// The colours a timer is drawn in, written out here rather than asked of the
// render code. An expectation built from the function under test cannot fail
// when that function is wrong, and these are the codes a terminal shows.
const RUNNING_COLOUR = 214;
const STOPPED_COLOUR = 244;
const coloured = (colour: number) => `${ESC}[38;5;${colour}m`;

describe("app run", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation();
    const setRawMode = jest.fn();
    const clearLine = jest.fn();
    const cursorTo = jest.fn();
    const write = jest.fn();

    // What the stream and the terminal looked like before this file put its own
    // on them. The process is shared with every other test file in the worker,
    // so anything left behind is still in place for the next one: a silent
    // stdout.write, a terminal that can no longer move its cursor, or a stdin
    // left in raw mode.
    const originalWrite = process.stdout.write;
    const originalClearLine = process.stdout.clearLine;
    const originalCursorTo = process.stdout.cursorTo;
    const originalMoveCursor = process.stdout.moveCursor;
    const originalClearScreenDown = process.stdout.clearScreenDown;
    const originalSetRawMode = process.stdin.setRawMode;

    process.stdin.setRawMode = setRawMode;
    process.stdout.clearLine = clearLine;
    process.stdout.cursorTo = cursorTo;
    process.stdout.write = write;

    const originalTerm = process.env.TERM;
    const originalColumns = process.stdout.columns;
    const originalRows = process.stdout.rows;
    const originalIsTTY = process.stdout.isTTY;
    const originalConfigHome = process.env.XDG_CONFIG_HOME;

    // Assigning undefined to an environment variable sets it to the string
    // "undefined" rather than removing it, which would leave every later test
    // reading a path called undefined.
    const restoreEnv = (name: string, value: string | undefined) => {
        if (value === undefined) {
            delete process.env[name];
            return;
        }
        process.env[name] = value;
    };

    // A property that was never there has to be taken away again rather than
    // set to undefined, so the streams are left the shape they were found in.
    const restoreProperty = (target: object, name: string, value: unknown) => {
        if (value === undefined) {
            delete (target as Record<string, unknown>)[name];
            return;
        }
        (target as Record<string, unknown>)[name] = value;
    };

    // Every run this file starts, so every one of them can be stopped again. A
    // run holds a keypress listener and a redraw timer that both outlive the
    // test that started them, and one left behind answers the keys of the next
    // test and writes into whatever settings directory that test set up. That is
    // how a test comes to pass because the last run to start happened to want
    // the same thing as the one under test.
    const startedRuns: RunHandle[] = [];

    const startRun = () => {
        const handle = run();
        startedRuns.push(handle);
        return handle;
    };

    const stopEveryRun = () => {
        for (const handle of startedRuns.splice(0)) {
            handle.stop();
        }
    };

    // What stdin was already subscribed to before this file added anything, so
    // the count can be checked against it rather than assumed to be zero.
    const keypressListenersAtStart = process.stdin.listenerCount("keypress");

    // The display the user last chose is remembered in a file, so every test
    // gets a directory of its own to read and write. Otherwise a test that
    // presses d writes to the real home directory, and a test that runs after
    // anyone has used the app starts on whatever they last chose.
    let settingsHome = "";

    const settingsFile = () =>
        path.join(settingsHome, "console-stopwatch", "settings.json");

    const writeSettings = (contents: string) => {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
        fs.writeFileSync(settingsFile(), contents);
    };

    const readSettings = () => fs.readFileSync(settingsFile(), "utf8");

    // A terminal that keeps track of where the cursor is and what is on the
    // screen, so a redraw can be checked by where the next write lands and by
    // what the previous one left behind.
    const fakeTerminal = () => {
        const terminal = {
            row: 0,
            column: 0,
            // One string per row. A row that was never written to is empty, so
            // leftover content from a region that shrank is visible.
            screen: [] as string[],
            writeStarts: [] as { row: number; column: number }[],
            // A terminal that has filled the last column does not wrap until
            // something else is written, so a row that fits exactly is one row.
            pendingWrap: false,
            // Resizing replaces the cursor functions, so a test that resizes
            // has to put the model back afterwards.
            attach: () => {
                process.stdout.clearLine =
                    terminal.clearLine as typeof process.stdout.clearLine;
                process.stdout.cursorTo = ((x: number) => {
                    terminal.column = Math.max(0, x);
                    terminal.pendingWrap = false;
                }) as typeof process.stdout.cursorTo;
                process.stdout.moveCursor = ((x: number, y: number) => {
                    terminal.column = Math.max(0, terminal.column + x);
                    terminal.row = Math.max(0, terminal.row + y);
                    terminal.pendingWrap = false;
                    return true;
                }) as typeof process.stdout.moveCursor;
                process.stdout.clearScreenDown = (() => {
                    terminal.screen.length = Math.min(
                        terminal.screen.length,
                        terminal.row + 1,
                    );
                    process.stdout.clearLine(1);
                }) as typeof process.stdout.clearScreenDown;
            },
            clearLine: (mode: number) => {
                const line = terminal.screen[terminal.row] || "";
                // 0 erases to the start of the row, 1 to the end of it.
                terminal.screen[terminal.row] =
                    mode === 0
                        ? " ".repeat(terminal.column) +
                          line.slice(terminal.column)
                        : line.slice(0, terminal.column);
            },
            put: (character: string) => {
                if (terminal.pendingWrap) {
                    terminal.row += 1;
                    terminal.column = 0;
                    terminal.pendingWrap = false;
                }
                while (terminal.screen.length <= terminal.row) {
                    terminal.screen.push("");
                }
                const line = terminal.screen[terminal.row].padEnd(
                    terminal.column,
                    " ",
                );
                terminal.screen[terminal.row] =
                    line.slice(0, terminal.column) +
                    character +
                    line.slice(terminal.column + 1);
                terminal.column += 1;
                // A real terminal wraps, and a wrapped row is the case the
                // width gate exists to prevent.
                if (
                    typeof process.stdout.columns === "number" &&
                    terminal.column >= process.stdout.columns
                ) {
                    terminal.pendingWrap = true;
                }
            },
        };
        terminal.attach();
        const realWrite = write.getMockImplementation();
        write.mockImplementation((chunk: unknown) => {
            const text = String(chunk);
            terminal.writeStarts.push({
                row: terminal.row,
                column: terminal.column,
            });
            for (let index = 0; index < text.length; index++) {
                const character = text[index];
                // Step over the escape sequences: CSI ends on a letter, OSC on
                // BEL. Neither covers a visible column.
                if (character === "\x1b") {
                    const isOsc = text[index + 1] === "]";
                    let end = index + 2;
                    while (
                        end < text.length &&
                        !(isOsc
                            ? text[end] === "\x07"
                            : /[a-zA-Z]/.test(text[end]))
                    ) {
                        end++;
                    }
                    index = end;
                    continue;
                }
                if (character === "\n") {
                    terminal.row += 1;
                    terminal.column = 0;
                    terminal.pendingWrap = false;
                    continue;
                }
                terminal.put(character);
            }
            return realWrite ? realWrite(chunk) : true;
        });
        return terminal;
    };

    const withDigitSupport = (columns: number, rows: number) => {
        Object.defineProperty(process.stdout, "columns", {
            value: columns,
            configurable: true,
        });
        Object.defineProperty(process.stdout, "rows", {
            value: rows,
            configurable: true,
        });
        process.stdout.moveCursor = jest.fn();
        process.stdout.clearScreenDown = jest.fn();
    };

    const withoutDigitSupport = () => {
        process.stdout.moveCursor = undefined as unknown as (
            x: number,
            y: number,
        ) => boolean;
        process.stdout.clearScreenDown = undefined as unknown as () => boolean;
    };

    const clearSize = () => {
        Object.defineProperty(process.stdout, "columns", {
            value: undefined,
            configurable: true,
        });
        Object.defineProperty(process.stdout, "rows", {
            value: undefined,
            configurable: true,
        });
    };

    beforeEach(() => {
        jest.useFakeTimers();
        withoutDigitSupport();
        clearSize();
        // A terminal that says nothing about its size and still says it is a
        // TTY is treated as one whose size has not come back yet, which makes
        // the app wait rather than draw, so leaving it to whatever the test
        // before this one set would silently skip the drawing. The tests that
        // are about such a terminal say so themselves.
        Object.defineProperty(process.stdout, "isTTY", {
            value: false,
            configurable: true,
        });
        restoreEnv("TERM", originalTerm);
        settingsHome = fs.mkdtempSync(
            path.join(os.tmpdir(), "stopwatch-test-"),
        );
        process.env.XDG_CONFIG_HOME = settingsHome;
    });

    afterEach(() => {
        stopEveryRun();
        // Nothing this file started is still listening. A handler left over from
        // an earlier test would answer this one's keys, so a test could keep
        // passing long after the thing it was checking had been fixed.
        expect(process.stdin.listenerCount("keypress")).toBe(
            keypressListenersAtStart,
        );
        fs.rmSync(settingsHome, { recursive: true, force: true });
        exitSpy.mockReset();
        setRawMode.mockReset();
        clearLine.mockReset();
        cursorTo.mockReset();
        write.mockReset();
        // The cursor model replaces this, so put the plain mock back for the
        // tests that do not install one.
        process.stdout.cursorTo = cursorTo;
    });

    afterAll(() => {
        process.stdin.pause();
        // Every run is stopped in afterEach, and stopping one takes its own
        // listener back off, so there is nothing here left to take off by
        // force. removeAllListeners would take listeners this file never added,
        // and the next test file would inherit a stdin with none of them.
        restoreProperty(process.stdout, "write", originalWrite);
        restoreProperty(process.stdout, "clearLine", originalClearLine);
        restoreProperty(process.stdout, "cursorTo", originalCursorTo);
        restoreProperty(process.stdout, "moveCursor", originalMoveCursor);
        restoreProperty(
            process.stdout,
            "clearScreenDown",
            originalClearScreenDown,
        );
        restoreProperty(process.stdin, "setRawMode", originalSetRawMode);
        restoreEnv("TERM", originalTerm);
        restoreEnv("XDG_CONFIG_HOME", originalConfigHome);
        Object.defineProperty(process.stdout, "columns", {
            value: originalColumns,
            configurable: true,
        });
        Object.defineProperty(process.stdout, "rows", {
            value: originalRows,
            configurable: true,
        });
        Object.defineProperty(process.stdout, "isTTY", {
            value: originalIsTTY,
            configurable: true,
        });
    });

    const expectWriteToContainTime = (time: string) => {
        expect(write).toHaveBeenCalledWith(expect.stringContaining(time));
    };

    const expectWriteToContainLastTime = (time: string | RegExp) => {
        if (time instanceof RegExp) {
            expect(write).toHaveBeenLastCalledWith(expect.stringMatching(time));
            return;
        }
        expect(write).toHaveBeenLastCalledWith(expect.stringContaining(time));
    };

    // The block digits are made of block characters, the plain line is text, so
    // the two are easy to tell apart without depending on the exact glyphs.
    const expectDigits = () => expectWriteToContainLastTime("█");
    // The padded form is two newlines: the line, and the blank row under it.
    // Which one is expected is the point of the argument, since the padding is
    // only there when the redraw can travel back up to the line. A stopped timer
    // is drawn in the paused colour, which is the second argument.
    const expectPlainLine = (padded = false, running = true) =>
        expectWriteToContainLastTime(
            new RegExp(
                // The escape sequences have to be escaped again to be matched as
                // themselves, since a bracket in a pattern opens a character
                // class.
                `^${ESC}\\[38;5;${running ? RUNNING_COLOUR : STOPPED_COLOUR}m` +
                    `\\d{2}:\\d{2}\\.\\d{2}` +
                    `${ESC}\\[0m` +
                    `${padded ? "\\n\\n" : ""}$`,
            ),
        );

    // The five rows of block digits, as they are on the screen.
    const digitRows = (terminal: { screen: string[] }) =>
        terminal.screen.slice(2, 2 + GLYPH_HEIGHT);

    // The same rows as they were written, colour and all. The screen model steps
    // over the escape sequences, so the colour is only in the write.
    const writtenDigits = () =>
        String(write.mock.calls[write.mock.calls.length - 1][0])
            .split("\n")
            .slice(2, 2 + GLYPH_HEIGHT);

    // The same rows with the colour taken out, so two frames can be compared
    // without the colour of the timer deciding whether they look the same. The
    // escape sequences are the pieces of a row that start with a bracket.
    const glyphsOf = (rows: string[]) =>
        rows.map((row) =>
            row
                .split(ESC)
                .filter((part) => !part.startsWith("["))
                .join("")
                .trim(),
        );

    describe("a stopped timer", () => {
        // The block digits always greyed a stopped timer, so switching to the
        // plain line with d used to show the same stopped timer in orange. The
        // two displays have to agree or the key looks like it changed something
        // it did not.
        it("should grey the plain line, as the block digits already did", () => {
            withDigitSupport(120, 5);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            expectPlainLine(true);

            process.stdin.emit("data", Buffer.from(" "));
            jest.advanceTimersByTime(50);

            expectPlainLine(true, false);
        });

        it("should still grey the block digits", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            startRun();
            process.stdin.emit("data", Buffer.from(" "));
            jest.advanceTimersByTime(50);

            // The menu is dim as well, so the digit rows are looked at rather
            // than the whole write.
            const rows = String(
                write.mock.calls[write.mock.calls.length - 1][0],
            ).split("\n");
            rows.slice(2, 2 + GLYPH_HEIGHT).forEach((row) => {
                expect(row).toContain(coloured(STOPPED_COLOUR));
            });
        });

        it("should not grey a running timer on either display", () => {
            withDigitSupport(120, 5);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });
    });

    it("should write a hint line above the plain line", () => {
        // The cursor model brings the cursor functions with it, and a terminal
        // that can move its cursor also gets a gap under the keys, so they are
        // taken away again to keep this the terminal that can only draw the one
        // line the app has always drawn.
        const terminal = fakeTerminal();
        withoutDigitSupport();
        startRun();
        jest.advanceTimersByTime(50);

        // What is on the screen and not only how often something was written:
        // a hint that was printed and then wiped counts the same as one that is
        // still there, and it is the second a person would notice.
        expect(terminal.screen[0]).toContain("r reset");
        expect(terminal.screen[1]).toContain("00:00.05");
    });

    it("should not reprint the hint above the plain line every frame", () => {
        const terminal = fakeTerminal();
        withoutDigitSupport();
        startRun();
        jest.advanceTimersByTime(500);

        // Ten frames later the keys are still the one row they were printed as,
        // rather than a row per frame pushed down the screen, with the line
        // still redrawn under them.
        expect(
            terminal.screen.filter((row) => row.includes("r reset")),
        ).toHaveLength(1);
        expect(terminal.screen[0]).toContain("r reset");
        expect(terminal.screen[1]).toContain("00:00.50");
    });

    it("should write elpased time", () => {
        startRun();
        jest.advanceTimersByTime(50);

        expectWriteToContainTime("00:00.05");
    });

    it("should write elpased time with color", () => {
        startRun();
        jest.advanceTimersByTime(50);

        expect(write).toHaveBeenLastCalledWith("\x1b[38;5;214m00:00.05\x1b[0m");
    });

    it("should write elpased time twice", () => {
        startRun();
        jest.advanceTimersByTime(50);
        jest.advanceTimersByTime(50);

        expectWriteToContainTime("00:00.05");
        expectWriteToContainTime("00:00.10");
    });

    it("should reset timer", () => {
        startRun();
        jest.advanceTimersByTime(100);

        process.stdin.emit("data", Buffer.from("r"));
        jest.advanceTimersByTime(50);

        expectWriteToContainLastTime("00:00.05");
    });

    it("should create new timer", () => {
        startRun();
        jest.advanceTimersByTime(100);

        process.stdin.emit("data", Buffer.from("n"));
        jest.advanceTimersByTime(50);

        expectWriteToContainLastTime("00:00.05");
    });

    it("should pause timer", () => {
        startRun();
        process.stdin.emit("data", Buffer.from(" "));
        jest.advanceTimersByTime(100);

        expectWriteToContainLastTime("00:00.00");
    });

    it("should ignore a key it has no use for", () => {
        // Every key that was not one of the timer keys used to be treated as a
        // pause, so a key aimed at nothing silently stopped the clock.
        startRun();
        process.stdin.emit("data", Buffer.from("x"));
        jest.advanceTimersByTime(100);

        expectWriteToContainLastTime("00:00.10");
    });

    it("should close the application when pressing ctrl+c", () => {
        startRun();
        process.stdin.emit("data", Buffer.from("\x03"));

        expect(exitSpy).toHaveBeenCalled();
    });

    it("should close the application when pressing esc", () => {
        startRun();
        process.stdin.emit("keypress", "", { name: "escape" });

        expect(exitSpy).toHaveBeenCalled();
    });

    describe("ending a run", () => {
        it("should stop answering keys when it is stopped", () => {
            const handle = startRun();
            expect(process.stdin.listenerCount("keypress")).toBe(
                keypressListenersAtStart + 1,
            );
            jest.advanceTimersByTime(100);
            expectWriteToContainLastTime("00:00.10");

            handle.stop();

            // The one listener it added is the one it takes off again. A run
            // that outlives the test that started it goes on answering keys, and
            // each handler it leaves behind holds its own idea of the display
            // and writes it into the settings directory of whatever test is
            // running at the time.
            expect(process.stdin.listenerCount("keypress")).toBe(
                keypressListenersAtStart,
            );
            process.stdin.emit("data", Buffer.from("d"));
            expect(fs.existsSync(settingsFile())).toBe(false);
        });

        it("should be safe to stop twice", () => {
            const handle = startRun();
            handle.stop();

            expect(() => handle.stop()).not.toThrow();
        });

        it("should stop redrawing when it is stopped", () => {
            const terminal = fakeTerminal();
            const handle = startRun();
            jest.advanceTimersByTime(100);
            const screen = [...terminal.screen];
            const written = write.mock.calls.length;

            handle.stop();
            jest.advanceTimersByTime(1000);

            // The redraw timer is gone rather than left running against a run
            // nobody is watching: no timer left, and a screen that stops
            // changing.
            expect(jest.getTimerCount()).toBe(0);
            expect(write.mock.calls).toHaveLength(written);
            expect(terminal.screen).toEqual(screen);
        });

        it("should clear the redraw timer on the way out of esc", () => {
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(100);
            const screen = [...terminal.screen];
            const written = write.mock.calls.length;

            process.stdin.emit("keypress", "", { name: "escape" });

            // esc ends the process, so the run has to take its timer and its
            // listener down on the way. The process is not really gone here, so
            // a timer left behind would keep drawing to a terminal that is no
            // longer being watched.
            expect(jest.getTimerCount()).toBe(0);
            expect(process.stdin.listenerCount("keypress")).toBe(
                keypressListenersAtStart,
            );
            jest.advanceTimersByTime(1000);
            expect(write.mock.calls).toHaveLength(written);
            expect(terminal.screen).toEqual(screen);
        });
    });

    it("should move between timers with the arrow keys", () => {
        startRun();
        jest.advanceTimersByTime(100);
        // The first timer stops at 100ms and the new one starts from zero, so
        // the two show different times and moving between them is visible.
        process.stdin.emit("data", Buffer.from("n"));
        jest.advanceTimersByTime(300);
        expectWriteToContainLastTime("00:00.30");

        process.stdin.emit("keypress", "", { name: "up" });
        jest.advanceTimersByTime(50);

        expectWriteToContainLastTime("00:00.10");
    });

    describe("the key table", () => {
        // What each action in the table has to do when its key is pressed. It is
        // written out here rather than read back out of the table, because the
        // claim being made is that a key does this and not that the table says
        // it does. The type is the same set of actions the table names, so an
        // action added there is an action this file does not compile without: a
        // key cannot be wired up until somebody has said what it does.
        const expectAction: Record<KeyAction, (press: () => void) => void> = {
            reset(press) {
                startRun();
                jest.advanceTimersByTime(100);

                press();

                jest.advanceTimersByTime(50);
                expectWriteToContainLastTime("00:00.05");
            },
            newTimer(press) {
                startRun();
                jest.advanceTimersByTime(100);

                press();

                // The new timer starts from zero, so the time the old one had
                // reached is gone from the line and this is what is on it now.
                jest.advanceTimersByTime(50);
                expectWriteToContainLastTime("00:00.05");
                expect(write).not.toHaveBeenLastCalledWith(
                    expect.stringContaining("00:00.15"),
                );
            },
            toggleDisplay(press) {
                // The one action with no effect on the plain line, so this is the
                // only one that needs a terminal the digits fit in.
                withDigitSupport(120, 40);
                fakeTerminal();
                startRun();
                jest.advanceTimersByTime(50);
                expectDigits();

                press();

                jest.advanceTimersByTime(50);
                expectPlainLine(true);
            },
            toggle(press) {
                startRun();

                press();

                // Paused, so the time stands still.
                jest.advanceTimersByTime(100);
                expectWriteToContainLastTime("00:00.00");

                // And the same key again starts it, which is the half of what the
                // key does that a menu saying "pause" left out.
                press();
                jest.advanceTimersByTime(100);
                expectWriteToContainLastTime("00:00.10");
            },
            quit(press) {
                startRun();

                press();

                expect(exitSpy).toHaveBeenCalledWith(0);
                // Taken down on the way out rather than left behind: a run still
                // listening and still holding its redraw timer in a process on
                // its way to being gone is a run that goes on answering keys.
                expect(process.stdin.listenerCount("keypress")).toBe(
                    keypressListenersAtStart,
                );
                expect(jest.getTimerCount()).toBe(0);
            },
            moveUp(press) {
                startRun();
                jest.advanceTimersByTime(100);
                // The first timer stops at a tenth of a second and the second
                // starts from zero, so the two show different times and moving
                // between them is visible on the line.
                process.stdin.emit("data", Buffer.from("n"));
                jest.advanceTimersByTime(300);
                expectWriteToContainLastTime("00:00.30");

                press();

                jest.advanceTimersByTime(50);
                expectWriteToContainLastTime("00:00.10");
            },
            moveDown(press) {
                startRun();
                jest.advanceTimersByTime(100);
                // Two timers, and back up to the first, so that down has
                // somewhere to go: the key is a no-op on the last one.
                process.stdin.emit("data", Buffer.from("n"));
                process.stdin.emit("keypress", "", { name: "up" });
                jest.advanceTimersByTime(300);
                expectWriteToContainLastTime("00:00.10");

                press();

                jest.advanceTimersByTime(50);
                expectWriteToContainLastTime("00:00.35");
            },
        };

        // One live run at a time, on the plain line. A second run would answer
        // the same keypress and write into the same mock, and which of the two
        // writes came last would be up to the order their redraw timers fired in
        // rather than to anything the test meant.
        const freshRun = () => {
            stopEveryRun();
            write.mockClear();
            withoutDigitSupport();
            clearSize();
        };

        it("should do what every key the table lists says it does", () => {
            // The keypresses are the ones the table lists, in the shape readline
            // reports them, so a table entry with nothing behind it fails here
            // instead of passing for a key the handler quietly ignores. More than
            // one key on an entry is one thing to do rather than two, and every
            // one of them is pressed: esc and ctrl+c both have to quit.
            BINDINGS.forEach((binding) => {
                binding.keys.forEach((key) => {
                    freshRun();
                    expectAction[binding.action](() =>
                        process.stdin.emit("keypress", "", key),
                    );
                });
            });
        });

        it("should do nothing for a key the table does not list", () => {
            // The keys a binding is most likely to reach for next, and the ones
            // readline names that a stray branch would answer to. Nothing here
            // changes what the timer shows, so a key bound in the handler but
            // missing from the table - the drift this table exists to make
            // impossible - fails on the line it stopped, reset or replaced.
            const unbound = [
                "c",
                "left",
                "right",
                "q",
                "x",
                "s",
                "p",
                "0",
                "enter",
                "return",
                "tab",
                "backspace",
                "delete",
                "home",
                "end",
                "pageup",
                "pagedown",
                "f1",
            ];

            unbound.forEach((name) => {
                freshRun();
                startRun();
                jest.advanceTimersByTime(100);

                process.stdin.emit("keypress", "", { name });

                // Still counting, so the key was not a pause, a reset or a new
                // timer, and nothing was quit or written down either.
                jest.advanceTimersByTime(100);
                expectWriteToContainLastTime("00:00.20");
                expect(exitSpy).not.toHaveBeenCalled();
                expect(fs.existsSync(settingsFile())).toBe(false);
            });
        });
    });

    describe("when the terminal can draw digits", () => {
        it("should draw the elapsed time in block digits", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectDigits();
            // The menu, the gap under it, five rows of digits, the gap under the
            // timer, the blank row under that, and the row the cursor parks on.
            expect(terminal.row).toBe(9);
        });

        it("should draw the menu at the top as part of the display", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // The menu is a row of the region rather than a line printed once
            // above, so it comes before the digits in the same write and is
            // redrawn with them.
            const lastWrite = String(
                write.mock.calls[write.mock.calls.length - 1][0],
            );
            const rows = lastWrite.split("\n").filter((row) => row.length > 0);
            expect(rows[0]).toContain("esc quit");
            expect(rows[rows.length - 1]).toContain("█");
            // The row the menu is on is the row the region starts on, which is
            // what "part of the display" comes to: a menu printed above the
            // region would leave the region starting two rows lower, and the
            // screen would look the same either way, so this is the part that
            // says where the row was written from.
            expect(terminal.screen[0]).toContain("esc quit");
            expect(
                terminal.writeStarts[terminal.writeStarts.length - 1],
            ).toEqual({ row: 0, column: 0 });
        });

        it("should name the key that switches display in the menu", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expect(terminal.screen[0]).toContain("d display");
        });

        it("should keep the digits on the same rows every frame", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            for (let frame = 0; frame < 5; frame++) {
                jest.advanceTimersByTime(50);
                const row =
                    terminal.writeStarts[terminal.writeStarts.length - 1].row;
                // Nothing is drawn above the region, so it starts on row zero.
                expect(row).toBe(0);
            }
            expect(terminal.row).toBe(9);
        });

        it("should start the first frame at the left edge", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            process.stdout.write("$ a prompt longer than ".repeat(3));
            expect(terminal.column).toBeGreaterThan(39);
            startRun();
            jest.advanceTimersByTime(50);

            expect(
                terminal.writeStarts[terminal.writeStarts.length - 1],
            ).toEqual({ row: 0, column: 0 });
        });

        it("should list the other timers under the digits", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);

            // The timer that was replaced is stopped, so it is listed as such.
            expectWriteToContainLastTime(/⏸.*00:00\.00/);
            // One more row for the timer that was added.
            expect(terminal.row).toBe(10);
        });

        it("should reset the timer in the block digits", () => {
            // On this display the elapsed time reaches the screen as blocks and
            // nowhere else, so what a reset has to get back to is the first frame
            // itself. Spelling the time out here instead would only prove the
            // screen agrees with this test, since the blocks come from the same
            // code that formats the time.
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            const firstFrame = glyphsOf(digitRows(terminal));

            jest.advanceTimersByTime(1000);
            expect(glyphsOf(digitRows(terminal))).not.toEqual(firstFrame);

            process.stdin.emit("data", Buffer.from("r"));
            jest.advanceTimersByTime(50);

            expect(glyphsOf(digitRows(terminal))).toEqual(firstFrame);
        });

        it("should move between timers with the arrow keys in the block digits", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(100);
            // The digits for the first timer at a tenth of a second, kept as
            // what moving back to it has to show again.
            const firstTimer = glyphsOf(digitRows(terminal));

            // The first timer stops at a tenth of a second and a new one starts
            // from zero, so the two show different times and the one that is not
            // current is listed under the digits.
            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(300);
            expect(terminal.screen[8]).toContain("⏸ 00:00.10");
            expect(glyphsOf(digitRows(terminal))).not.toEqual(firstTimer);

            process.stdin.emit("keypress", "", { name: "up" });
            jest.advanceTimersByTime(50);

            // The digits are the timer that is current again, stopped at a tenth
            // of a second, so they are drawn in the stopped colour and the
            // running one is the one listed.
            expect(glyphsOf(digitRows(terminal))).toEqual(firstTimer);
            writtenDigits().forEach((row) => {
                expect(row).toContain(coloured(STOPPED_COLOUR));
            });
            expect(terminal.screen[8]).toContain("▶ 00:00.35");

            process.stdin.emit("keypress", "", { name: "down" });
            jest.advanceTimersByTime(50);

            // And back to the new one, running, with the other listed again.
            expect(glyphsOf(digitRows(terminal))).not.toEqual(firstTimer);
            writtenDigits().forEach((row) => {
                expect(row).toContain(coloured(RUNNING_COLOUR));
            });
            expect(terminal.screen[8]).toContain("⏸ 00:00.10");
        });

        it("should not stack up rows when the display changes", () => {
            // Five rows is far too few for the digits, and wide enough for the
            // menu, so the fallback prints the menu above the line.
            withDigitSupport(120, 5);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            // The menu is on row zero, the gap under it row one, the line row two
            // and the blank row under that row three, so the cursor parks below
            // all four.
            expect(terminal.row).toBe(4);

            for (let cycle = 0; cycle < 3; cycle++) {
                withDigitSupport(120, 40);
                terminal.attach();
                terminal.writeStarts.length = 0;
                jest.advanceTimersByTime(50);
                expect(terminal.row).toBe(9);
                // The plain line left the cursor at the end of the text, and
                // moveCursor does not touch the column, so the digits have to
                // be put back at the left edge or they start part way across.
                // The two rows the fallback left above the line are reclaimed, so
                // the region starts on row zero rather than below it.
                expect(
                    terminal.writeStarts[terminal.writeStarts.length - 1],
                ).toEqual({ row: 0, column: 0 });

                withDigitSupport(120, 5);
                terminal.attach();
                jest.advanceTimersByTime(50);
                // Back to the plain line, wiped off the digits and drawn under
                // the menu, which is printed again now the region no longer
                // carries one, so the cursor parks below the blank row again.
                expect(terminal.row).toBe(4);
            }
        });

        it("should not drift when the display changes below other output", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            process.stdout.write("\n".repeat(7));
            startRun();
            // Seven rows of other output, so the region starts on row seven and
            // the nine rows of the display park the cursor on row sixteen.
            jest.advanceTimersByTime(50);
            expect(terminal.row).toBe(16);

            for (let cycle = 0; cycle < 3; cycle++) {
                withDigitSupport(120, 5);
                terminal.attach();
                jest.advanceTimersByTime(50);
                // The menu goes on row seven, the gap row eight, the line row
                // nine, the blank row under it row ten, so the cursor parks on
                // row eleven.
                expect(terminal.row).toBe(11);

                withDigitSupport(120, 40);
                terminal.attach();
                terminal.writeStarts.length = 0;
                jest.advanceTimersByTime(50);
                // Back on the same row, not a row higher and not a row lower.
                // The two rows the fallback printed above the line are reclaimed,
                // which puts the region back on row seven.
                expect(
                    terminal.writeStarts[terminal.writeStarts.length - 1].row,
                ).toBe(7);
            }
        });

        it("should leave nothing of the digits behind when it falls back", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            expect(terminal.screen.some((row) => row.includes("█"))).toBe(true);

            withDigitSupport(120, 5);
            terminal.attach();
            jest.advanceTimersByTime(50);

            // The rows the region used to own are cleared rather than left
            // showing the last frame of the digits, which a cursor position
            // cannot tell. The menu above the line is the only thing left.
            const left = terminal.screen.filter((row) => row.includes("█"));
            expect(left).toHaveLength(0);
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(2);
        });

        it("should leave nothing of the digits behind when they come back", () => {
            withDigitSupport(120, 5);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            withDigitSupport(120, 40);
            terminal.attach();
            jest.advanceTimersByTime(50);

            // The menu and the gap the fallback printed above the line are gone,
            // and the display has a menu of its own at the top, so the screen
            // holds the region and nothing else.
            expect(terminal.screen[2]).toContain("█");
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(6);
        });

        it("should leave a blank row under the display", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // The menu is row zero, the digits rows two to six, the gap under
            // the timer row seven and the blank row under the display row eight.
            expect(terminal.screen[7] || "").toBe("");
            expect(terminal.screen[8] || "").toBe("");
            expect(terminal.row).toBe(9);

            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);

            // The blank row moves down with the listed timer rather than the
            // display sliding into it, so it is a row of the region and not the
            // row the cursor happens to be parked on.
            expect(terminal.screen[8]).toContain("⏸");
            expect(terminal.screen[9] || "").toBe("");
            expect(terminal.row).toBe(10);
        });

        it("should keep a blank row under the timer when one is added", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // This is the padding that can be seen: the row under the digits is
            // blank, so there is a gap to look at.
            const lastDigitRow = () =>
                terminal.screen.reduce(
                    (last, row, index) => (row.includes("█") ? index : last),
                    -1,
                );
            expect(lastDigitRow()).toBe(6);
            expect(terminal.screen[7] || "").toBe("");
            expect(terminal.row).toBe(9);

            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);

            // The gap stays directly under the timer. It used to sit above the
            // keys instead, where a listed timer took its place and the padding
            // disappeared the moment a new timer was added.
            expect(lastDigitRow()).toBe(6);
            expect(terminal.screen[7] || "").toBe("");
            expect(terminal.screen[8]).toContain("⏸");
            expect(terminal.row).toBe(10);
        });

        it("should leave a blank row under the plain line", () => {
            withDigitSupport(120, 5);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // The menu is on row zero, the gap under it row one, the line row
            // two and the blank row under it row three, with the cursor parked
            // on row four.
            const line = () =>
                terminal.screen.findIndex((row) => row.includes("00:00."));
            expect(line()).toBe(2);
            expect(terminal.screen[1] || "").toBe("");
            expect(terminal.screen[3] || "").toBe("");
            expect(terminal.row).toBe(4);

            // The blank row is a row of the display, so it stays put instead of
            // the display stepping down a row every frame.
            for (let frame = 0; frame < 3; frame++) {
                jest.advanceTimersByTime(50);
                expect(line()).toBe(2);
                expect(terminal.screen[3] || "").toBe("");
                expect(terminal.row).toBe(4);
            }
        });

        it("should clear the blank row under the plain line", () => {
            withDigitSupport(120, 5);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            expect(terminal.row).toBe(4);

            // Anything that writes into the row under the display has to go with
            // it, the same as the rows of the block digits are.
            terminal.screen[3] = "something else";
            jest.advanceTimersByTime(50);

            expect(terminal.screen[3] || "").toBe("");
            expect(terminal.row).toBe(4);
        });

        it("should not pad the plain line on a terminal one row tall", () => {
            // Parking the cursor on the row below the line would scroll the
            // terminal a row every frame, so a one row terminal keeps the line
            // unpadded. No model here, so the cursor calls stay observable.
            withDigitSupport(38, 1);
            startRun();
            jest.advanceTimersByTime(150);

            expectPlainLine();
            expect(process.stdout.moveCursor).not.toHaveBeenCalled();
        });

        it("should not print the hint when it would wrap", () => {
            withDigitSupport(20, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // The hint is wider than the terminal, so it would take a second
            // row the plain line knows nothing about. The line still gets the
            // blank row under it, on row one, so the cursor parks on row two.
            // The keys are looked for on the screen, where a hint that was
            // printed anyway would have taken the rows above the line.
            expect(terminal.screen.some((row) => row.includes("r reset"))).toBe(
                false,
            );
            expect(terminal.row).toBe(2);
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(1);
        });

        it("should fall back to the plain line when too narrow", () => {
            // The menu is the widest row and it names the key that switches
            // display, so the display needs 51 columns and 50 is one too few.
            withDigitSupport(50, 40);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the width they need", () => {
            withDigitSupport(51, 40);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should fall back to the plain line when too short", () => {
            // The menu, the gap under it, five rows of digits, the gap under the
            // timer, the blank row under those and the row the cursor parks on
            // need ten rows. Nine is one too few.
            withDigitSupport(120, 9);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the height they need", () => {
            withDigitSupport(120, 10);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should fall back on a terminal that cannot move the cursor", () => {
            withDigitSupport(120, 40);
            // attach() installs the model, so the support has to be taken away
            // after it.
            fakeTerminal();
            withoutDigitSupport();
            startRun();
            jest.advanceTimersByTime(50);

            expectPlainLine();
        });

        it("should fall back on TERM=dumb", () => {
            withDigitSupport(120, 40);
            process.env.TERM = "dumb";
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectPlainLine();
        });
    });

    describe("when the terminal size is not known", () => {
        it("should wait for the size and draw nothing yet", () => {
            Object.defineProperty(process.stdout, "isTTY", {
                value: true,
                configurable: true,
            });
            withDigitSupport(120, 40);
            clearSize();
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(100);

            // Nothing at all, not even the hint: there is no way to know whether
            // the terminal is tall enough for the display to put it under. The
            // rows are checked and not only the cursor, so a hint that had been
            // drawn and then wiped again cannot pass for a display that never
            // drew at all.
            expect(terminal.row).toBe(0);
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(0);
        });

        it("should give up waiting and write the plain line", () => {
            Object.defineProperty(process.stdout, "isTTY", {
                value: true,
                configurable: true,
            });
            withDigitSupport(120, 40);
            clearSize();
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(1500);

            expectPlainLine(true);
        });

        it("should treat a width of zero as a size it does not know", () => {
            // Zero is a number, so a terminal that reports it is not caught by
            // the check that there is a size at all, and only the check that it
            // is one fits.
            Object.defineProperty(process.stdout, "isTTY", {
                value: true,
                configurable: true,
            });
            withDigitSupport(0, 40);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(100);

            // A width of zero is a width, so the wait below is for a size it can
            // never have. Nothing is drawn while it is on, and the rows are
            // checked as well as the cursor so a frame that was drawn and then
            // wiped cannot pass for one that never was.
            expect(terminal.row).toBe(0);
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(0);

            jest.advanceTimersByTime(1500);

            // The line is drawn rather than the digits, and with no keys above
            // it: there is no width to tell whether they fit on one row, and a
            // key that wrapped would take a row the line knows nothing about.
            // A width of zero has to be read as no room for the keys rather than
            // as no width to measure them against, or the menu is printed and
            // the line is drawn below it. Where the line starts is checked
            // rather than whether the keys are on the screen, because a terminal
            // reporting a width of zero puts one character to a row, so a menu
            // printed here would not be a row of text to look for.
            expect(terminal.screen[0]).toBe("0");
            expect(terminal.screen.some((row) => row.includes("█"))).toBe(
                false,
            );
            expectPlainLine(true);
        });

        it("should treat a height of zero as a size it does not know", () => {
            Object.defineProperty(process.stdout, "isTTY", {
                value: true,
                configurable: true,
            });
            withDigitSupport(120, 0);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(100);

            expect(terminal.row).toBe(0);

            jest.advanceTimersByTime(1500);

            // A terminal that cannot spare the blank rows gets the line on a row
            // of its own, with the keys above it, since the width is known and
            // the height is not one to measure them against.
            expect(terminal.screen.some((row) => row.includes("█"))).toBe(
                false,
            );
            expect(terminal.screen[0]).toContain("r reset");
            expect(terminal.row).toBe(1);
            expectPlainLine();
        });

        it("should not wait when the output is not a terminal", () => {
            Object.defineProperty(process.stdout, "isTTY", {
                value: false,
                configurable: true,
            });
            clearSize();
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });
    });

    describe("the display toggle", () => {
        const ROOMY = { columns: 120, rows: 40 };

        it("should draw the block digits when nothing has been chosen", () => {
            // The default is the display the app has always picked for itself, so
            // a first run looks like the last one.
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should switch to the plain line when d is pressed", () => {
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            expectDigits();

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
            // The digits are gone rather than left under the line, so switching
            // is a handover and not a second display drawn on top of the first.
            expect(
                terminal.screen.filter((row) => row.includes("█")),
            ).toHaveLength(0);
        });

        it("should switch back to the block digits when d is pressed again", () => {
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);
            expectPlainLine(true);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should remember the display it was switched to", () => {
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            const writeFile = jest.spyOn(fs, "writeFileSync");
            startRun();
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            // Written when the key is pressed rather than on the way out, because
            // esc ends the process and a choice made just before pressing it
            // should not be the one that is lost.
            expect(JSON.parse(readSettings())).toEqual({ display: "standard" });
            // And written by this run and nothing else. The file is one the
            // whole process shares, so a handler left over from an earlier run
            // would write the same value again and this would pass either way.
            expect(writeFile).toHaveBeenCalledTimes(1);
            expect(writeFile).toHaveBeenCalledWith(
                settingsFile(),
                expect.any(String),
            );
            writeFile.mockRestore();
        });

        it("should not write the display from a run that has been stopped", () => {
            // Two runs at once is the state a suite that starts a run and never
            // stops it ends up in, one handler per test, and every one of them
            // answers the key and writes into whichever settings directory the
            // test running at the time set up. The file is then whatever the
            // last-registered run happened to want, which is why the test above
            // has to check how many times it was written and not only what is
            // in it.
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            const writeFile = jest.spyOn(fs, "writeFileSync");
            const stopped = startRun();
            startRun();
            jest.advanceTimersByTime(50);

            // Both runs are live, so both of them answer the key.
            process.stdin.emit("data", Buffer.from("d"));
            expect(writeFile).toHaveBeenCalledTimes(2);

            // And once one of them is stopped, only the other one does. Its key
            // is the one that takes the display back to the block digits, so a
            // handler that were left behind would leave the file on the plain
            // line instead.
            stopped.stop();
            writeFile.mockClear();
            process.stdin.emit("data", Buffer.from("d"));

            expect(writeFile).toHaveBeenCalledTimes(1);
            expect(JSON.parse(readSettings())).toEqual({ display: "advanced" });
            writeFile.mockRestore();
        });

        it("should start on the plain line when that is what it was left on", () => {
            writeSettings(JSON.stringify({ display: "standard" }));
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // A terminal this size could draw the digits, so the only reason to
            // see the plain line is that it was asked for last time.
            expectPlainLine(true);
        });

        it("should stay on the plain line when the terminal grows", () => {
            writeSettings(JSON.stringify({ display: "standard" }));
            withDigitSupport(51, 10);
            const terminal = fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            expectPlainLine(true);

            withDigitSupport(ROOMY.columns, ROOMY.rows);
            terminal.attach();
            jest.advanceTimersByTime(50);

            // Two states, not three: a terminal big enough for the digits is no
            // longer enough on its own to bring them back.
            expectPlainLine(true);
        });

        it("should start on the block digits when that is what it was left on", () => {
            writeSettings(JSON.stringify({ display: "advanced" }));
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should ignore a display it does not recognise", () => {
            writeSettings(
                JSON.stringify({ display: "something else", extra: 1 }),
            );
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // A file someone has edited by hand reads as nothing remembered, so
            // the default applies rather than a display that is not one of the
            // two.
            expectDigits();
        });

        it("should ignore a settings file that is not readable", () => {
            writeSettings("this is not json");
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should still switch when the settings cannot be written", () => {
            // A read only home directory should cost the remembering, not the
            // stopwatch, so nothing is reported and the display still changes.
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fs.mkdirSync(path.join(settingsHome, "console-stopwatch"), {
                recursive: true,
            });
            fs.mkdirSync(
                path.join(settingsHome, "console-stopwatch", "settings.json"),
            );
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should fall back to the plain line when the terminal is too small", () => {
            writeSettings(JSON.stringify({ display: "advanced" }));
            withDigitSupport(120, 5);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);

            // The measurement still gets the last word, so a remembered choice
            // the terminal cannot honour does not draw something it cannot draw.
            expectPlainLine(true);
        });
    });

    describe("the window title", () => {
        // The title of a window is one of the few things a user sees without
        // looking at the terminal, and a title that stopped counting would look
        // exactly like a stopwatch that had only just been started, so the times
        // below are ones the app can only have got to by counting.
        const titles = () =>
            write.mock.calls
                .map((call) => String(call[0]))
                .filter((text) => text.includes("⏱"));

        // The whole sequence, and not just the one value, so a title that is
        // frozen, that skips a second or that counts too fast all fail here. The
        // clock ends the title, so one that grew hundredths fails too.
        const expectTitled = (time: string) =>
            expect(titles()).toContainEqual(
                expect.stringMatching(new RegExp(`⏱ ${time}\\x07$`)),
            );

        it("should show the elapsed time without hundredths", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(1500);

            expectTitled("00:01");
            expect(titles().every((text) => !text.includes("."))).toBe(true);

            jest.advanceTimersByTime(1000);

            expectTitled("00:02");
        });

        it("should mirror the time whichever way it is displayed", () => {
            // Thirty-eight columns is too narrow for the block digits, so the
            // plain line is the live display. The title is the app's, not a
            // display's, so it is mirrored either way.
            withDigitSupport(38, 40);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(1500);

            expectTitled("00:01");

            jest.advanceTimersByTime(1000);

            expectTitled("00:02");
        });

        it("should only update the title once a second", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            startRun();
            jest.advanceTimersByTime(50);
            const titleWrites = () => titles().length;
            const first = titleWrites();

            // Ten frames is half a second, which is not enough to be due again.
            jest.advanceTimersByTime(10 * 50);
            expect(titleWrites()).toBe(first);

            // Another second takes it past the next update, and that one is a
            // second later rather than the frozen first one.
            jest.advanceTimersByTime(10 * 50);
            expect(titleWrites()).toBe(first + 1);
            expectTitled("00:01");
        });
    });
});
