import fs from "fs";
import os from "os";
import path from "path";
import { run, type RunHandle } from "../app";
import { GLYPH_HEIGHT } from "../blockDigits";
import { BINDINGS, type KeyAction } from "../keys";
import { isDumbTerminal } from "../terminal";

const ESC = String.fromCharCode(27);

// The colours a timer is drawn in, written out here rather than asked of the
// render code. An expectation built from the function under test cannot fail
// when that function is wrong, and these are the codes a terminal shows.
const RUNNING_COLOUR = 214;
const STOPPED_COLOUR = 244;
const coloured = (colour: number) => `${ESC}[38;5;${colour}m`;

// The terminal every run in this file draws on, and the roomy one most of them
// want: the block digits need 51 columns and 10 rows, the menu 51 columns and
// one, so a terminal this size leaves the gate free to be about whatever the
// test is about.
const ROOMY = { columns: 120, rows: 40 };
// Wide enough for the menu, far too short for the block digits, so the fallback
// prints the keys above the line.
const SHORT = { columns: 120, rows: 5 };

describe("app run", () => {
    const exitSpy = jest.spyOn(process, "exit").mockImplementation();

    const restoreEnv = (name: string, value: string | undefined) => {
        if (value === undefined) {
            delete process.env[name];
            return;
        }
        process.env[name] = value;
    };

    // Every run this file starts, so every one of them can be stopped again. A
    // run holds a keypress listener and a redraw timer that both outlive the
    // test that started them, and one left behind answers the keys of the next
    // test and writes into whatever settings directory that test set up. That is
    // how a test comes to pass because the last run to start happened to want
    // the same thing as the one under test.
    const startedRuns: RunHandle[] = [];

    const startRun = () => {
        const handle = run(terminal.handle);
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

    // What a terminal reports of itself. A width that is missing is a width it
    // has not reported, which is a different answer from a width of zero, so
    // the two are set separately here and are never derived from one another.
    type TerminalConfig = {
        columns?: number;
        rows?: number;
        isTTY?: boolean;
        canMoveCursor?: boolean;
    };

    // A terminal that keeps track of where the cursor is and what is on the
    // screen, and the handle a run draws through: one thing rather than a model
    // plus a set of capabilities that could disagree with it. Every row on the
    // screen got there through the handle, so a redraw can be checked by where
    // the next write lands and by what the previous one left behind.
    const fakeTerminal = (config: TerminalConfig = {}) => {
        const answers = { ...config };
        const screen: string[] = [];
        const writes: string[] = [];
        const writeStarts: { row: number; column: number }[] = [];
        const moves: { dx: number; dy: number }[] = [];
        let row = 0;
        let column = 0;
        // A terminal that has filled the last column does not wrap until
        // something else is written, so a row that fits exactly is one row.
        let pendingWrap = false;

        const put = (character: string) => {
            if (pendingWrap) {
                row += 1;
                column = 0;
                pendingWrap = false;
            }
            while (screen.length <= row) {
                // A row that was never written to is empty, so leftover content
                // from a region that shrank is visible.
                screen.push("");
            }
            const line = screen[row].padEnd(column, " ");
            screen[row] =
                line.slice(0, column) + character + line.slice(column + 1);
            column += 1;
            // A real terminal wraps, and a wrapped row is the case the width
            // gate exists to prevent.
            if (
                typeof answers.columns === "number" &&
                column >= answers.columns
            ) {
                pendingWrap = true;
            }
        };

        // 0 erases to the start of the row, 1 to the end of it.
        const clearLine = (mode: number) => {
            const line = screen[row] || "";
            screen[row] =
                mode === 0
                    ? " ".repeat(column) + line.slice(column)
                    : line.slice(0, column);
        };

        const write = (text: string) => {
            writes.push(text);
            writeStarts.push({ row, column });
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
                    row += 1;
                    column = 0;
                    pendingWrap = false;
                    continue;
                }
                put(character);
            }
        };

        const moveCursor = (dx: number, dy: number) => {
            column = Math.max(0, column + dx);
            row = Math.max(0, row + dy);
            pendingWrap = false;
            moves.push({ dx, dy });
        };

        return {
            screen,
            writes,
            writeStarts,
            moves,
            get row() {
                return row;
            },
            get column() {
                return column;
            },
            write,
            // A resize is the terminal starting to report something else, and
            // nothing more: the model and the answers are the same object, so a
            // test cannot move the size the app is given and leave the screen
            // behind. Answers that are not in it are the ones kept, which is
            // what a terminal that only changed its height looks like.
            resize(next: TerminalConfig) {
                Object.assign(answers, next);
            },
            // What a run is handed. Every answer is read here and now rather
            // than kept, so a resize is answered by the terminal as it is on the
            // next frame. Whether the terminal is a dumb one is production's
            // question, asked by the real predicate, so the one thing this adds
            // is what the stream itself would have said.
            handle: {
                write,
                toStartOfRow: () => {
                    column = 0;
                    pendingWrap = false;
                },
                moveCursor,
                eraseToEndOfRow: () => clearLine(1),
                eraseBelow: () => {
                    screen.length = Math.min(screen.length, row + 1);
                    clearLine(1);
                },
                size: () => ({
                    columns: answers.columns,
                    rows: answers.rows,
                }),
                isTerminal: () => answers.isTTY === true,
                canMoveCursor: () =>
                    answers.canMoveCursor === true && !isDumbTerminal(),
            },
        };
    };

    // The terminal the next run draws on, rebuilt for every test so a resize in
    // one of them cannot be the size the next one starts on.
    let terminal: ReturnType<typeof fakeTerminal>;

    const useTerminal = (config?: TerminalConfig) => {
        terminal = fakeTerminal(config);
        return terminal;
    };

    const originalTerm = process.env.TERM;
    const originalConfigHome = process.env.XDG_CONFIG_HOME;

    beforeEach(() => {
        jest.useFakeTimers();
        // A terminal that says nothing about its size, cannot move its cursor
        // and is not a TTY, so a test that needs any of those has to say so. It
        // is also the terminal that makes the app draw at all: a terminal that
        // says nothing about its size and still says it is a TTY is treated as
        // one whose size has not come back yet, and the app waits.
        useTerminal();
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
    });

    afterAll(() => {
        process.stdin.pause();
        // Every run is stopped in afterEach, and stopping one takes its own
        // listener back off, so there is nothing here left to take off by
        // force. removeAllListeners would take listeners this file never added,
        // and the next test file would inherit a stdin with none of them.
        restoreEnv("TERM", originalTerm);
        restoreEnv("XDG_CONFIG_HOME", originalConfigHome);
    });

    const lastWrite = () => terminal.writes[terminal.writes.length - 1];

    // Every write that carries a time, which is every frame: the rows printed
    // above the display once are the keys and nothing else, so what is left is
    // the readings themselves, one write each.
    const readings = () =>
        terminal.writes.filter((text) => /\d\d:\d\d\.\d\d/.test(text));

    const expectWriteToContainTime = (time: string) => {
        expect(terminal.writes).toContainEqual(expect.stringContaining(time));
    };

    const expectWriteToContainLastTime = (time: string | RegExp) => {
        if (time instanceof RegExp) {
            expect(lastWrite()).toMatch(time);
            return;
        }
        expect(lastWrite()).toContain(time);
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
    const digitRows = () => terminal.screen.slice(2, 2 + GLYPH_HEIGHT);

    // The same rows as they were written, colour and all. The screen model steps
    // over the escape sequences, so the colour is only in the write.
    const writtenDigits = () =>
        lastWrite()
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

    // A run on a terminal that can draw the block digits.
    const roomyRun = (config: TerminalConfig = ROOMY) => {
        useTerminal({ isTTY: true, canMoveCursor: true, ...config });
        startRun();
    };

    describe("a stopped timer", () => {
        // The block digits always greyed a stopped timer, so switching to the
        // plain line with d used to show the same stopped timer in orange. The
        // two displays have to agree or the key looks like it changed something
        // it did not.
        it("should grey the plain line, as the block digits already did", () => {
            // Wide and tall enough for the digits, too short for the block
            // digits on the last frame: the plain line is the live display, and
            // it is padded because the redraw can travel back up to it.
            roomyRun(SHORT);
            jest.advanceTimersByTime(50);
            expectPlainLine(true);

            process.stdin.emit("data", Buffer.from(" "));
            jest.advanceTimersByTime(50);

            expectPlainLine(true, false);
        });

        it("should still grey the block digits", () => {
            roomyRun();
            process.stdin.emit("data", Buffer.from(" "));
            jest.advanceTimersByTime(50);

            // The menu is dim as well, so the digit rows are looked at rather
            // than the whole write.
            writtenDigits().forEach((row) => {
                expect(row).toContain(coloured(STOPPED_COLOUR));
            });
        });

        it("should not grey a running timer on either display", () => {
            roomyRun(SHORT);
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });
    });

    it("should write a hint line above the plain line", () => {
        // The terminal that can only draw the one line the app has always
        // drawn, so the keys are printed above it and there is no gap under them.
        useTerminal();
        startRun();
        jest.advanceTimersByTime(50);

        // What is on the screen and not only how often something was written:
        // a hint that was printed and then wiped counts the same as one that is
        // still there, and it is the second a person would notice.
        expect(terminal.screen[0]).toContain("r reset");
        expect(terminal.screen[1]).toContain("00:00.05");
    });

    it("should not reprint the hint above the plain line every frame", () => {
        useTerminal();
        startRun();
        jest.advanceTimersByTime(500);

        // Ten frames later the keys are still the one row they were printed as,
        // rather than a row per frame pushed down the screen, with the line
        // still redrawn under them. The readings themselves do get a row each,
        // because this terminal is not a screen and nothing is erasing the row
        // a frame was written on, which is what leaves the earlier reading
        // where it was rather than turning it into the next one.
        expect(
            terminal.screen.filter((row) => row.includes("r reset")),
        ).toHaveLength(1);
        expect(terminal.screen[0]).toContain("r reset");
        expect(terminal.screen[1]).toContain("00:00.05");
        expect(terminal.screen[10]).toContain("00:00.50");
    });

    it("should write elpased time", () => {
        startRun();
        jest.advanceTimersByTime(50);

        expectWriteToContainTime("00:00.05");
    });

    it("should write elpased time with color", () => {
        startRun();
        jest.advanceTimersByTime(50);

        // The colour is pinned here rather than left unmentioned: the escapes
        // are built in render and a pipe is still given them, because deciding
        // not to is a question about the renderer rather than about how a frame
        // is written. The trailing newline is the piped reading's own: this
        // terminal is not a screen, so a frame that is not newline-terminated
        // would run into the next one.
        expect(lastWrite()).toBe("\x1b[38;5;214m00:00.05\x1b[0m\n");
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
            useTerminal();
            const handle = startRun();
            jest.advanceTimersByTime(100);
            const screen = [...terminal.screen];
            const written = terminal.writes.length;

            handle.stop();
            jest.advanceTimersByTime(1000);

            // The redraw timer is gone rather than left running against a run
            // nobody is watching: no timer left, and a screen that stops
            // changing.
            expect(jest.getTimerCount()).toBe(0);
            expect(terminal.writes).toHaveLength(written);
            expect(terminal.screen).toEqual(screen);
        });

        it("should clear the redraw timer on the way out of esc", () => {
            useTerminal();
            startRun();
            jest.advanceTimersByTime(100);
            const screen = [...terminal.screen];
            const written = terminal.writes.length;

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
            expect(terminal.writes).toHaveLength(written);
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
                expect(lastWrite()).not.toContain("00:00.15");
            },
            toggleDisplay(press) {
                // The one action with no effect on the plain line, so this is the
                // only one that needs a terminal the digits fit in.
                roomyRun();
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

        // One live run at a time, on the plain line, on a terminal of its own.
        // A second run would answer the same keypress and write into the same
        // terminal, and which of the two writes came last would be up to the
        // order their redraw timers fired in rather than to anything the test
        // meant.
        const freshRun = () => {
            stopEveryRun();
            useTerminal();
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
            roomyRun();
            jest.advanceTimersByTime(50);

            expectDigits();
            // The menu, the gap under it, five rows of digits, the gap under the
            // timer, the blank row under that, and the row the cursor parks on.
            expect(terminal.row).toBe(9);
        });

        it("should draw the menu at the top as part of the display", () => {
            roomyRun();
            jest.advanceTimersByTime(50);

            // The menu is a row of the region rather than a line printed once
            // above, so it comes before the digits in the same write and is
            // redrawn with them.
            const rows = lastWrite()
                .split("\n")
                .filter((row) => row.length > 0);
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
            roomyRun();
            jest.advanceTimersByTime(50);

            expect(terminal.screen[0]).toContain("d display");
        });

        it("should keep the digits on the same rows every frame", () => {
            roomyRun();
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
            useTerminal({ isTTY: true, canMoveCursor: true, ...ROOMY });
            terminal.write("$ a prompt longer than ".repeat(3));
            expect(terminal.column).toBeGreaterThan(39);
            startRun();
            jest.advanceTimersByTime(50);

            expect(
                terminal.writeStarts[terminal.writeStarts.length - 1],
            ).toEqual({ row: 0, column: 0 });
        });

        it("should list the other timers under the digits", () => {
            roomyRun();
            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);

            // The timer that was replaced is stopped, so it is listed as such.
            expectWriteToContainLastTime(/⏸.*00:00\.00/);
            // One more row for the timer that was added.
            expect(terminal.row).toBe(10);
        });

        it("should list the other timers under the plain line too", () => {
            // The bug: the digits listed the other timers and the plain line
            // could not, because the line was never handed any, so pressing d made
            // every timer but the current one vanish. The two displays show the
            // same timers, so the same timers are on the screen either way - and
            // a run pinned to the line from the start has to show them too, since
            // a terminal too small for the digits never sees them at all.
            writeSettings(JSON.stringify({ display: "line" }));
            roomyRun();
            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);

            expect(terminal.screen[4]).toContain("⏸ 00:00.00");
            // The line, the gap under it, the listed timer and the blank row under
            // the display, under the menu and its gap, with the cursor parked below
            // all six.
            expect(terminal.screen[3] || "").toBe("");
            expect(terminal.row).toBe(6);
        });

        it("should keep the other timers listed when the display is toggled", () => {
            // Both ways of showing them, so the timers survive the key rather than
            // appearing and disappearing as the display changes.
            roomyRun();
            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);
            expect(terminal.screen[8]).toContain("⏸ 00:00.00");

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            // The menu and the gap above the line are reclaimed and the line's
            // display is drawn from the top, so the listed timer is a row under the
            // line rather than wherever the digits left it. The line is the new
            // timer, still running, and underneath it is the one that was replaced
            // and stopped - the same two rows the digits had, in the same order.
            expect(terminal.screen[2]).toContain("00:00.10");
            expect(terminal.screen[3] || "").toBe("");
            expect(terminal.screen[4]).toContain("⏸ 00:00.00");
            // Not one of the blocks: the digits are gone, and they took their five
            // rows with them rather than leaving any behind.
            expect(
                terminal.screen.filter((row) => row.includes("█")),
            ).toHaveLength(0);
        });

        it("should reset the timer in the block digits", () => {
            // On this display the elapsed time reaches the screen as blocks and
            // nowhere else, so what a reset has to get back to is the first frame
            // itself. Spelling the time out here instead would only prove the
            // screen agrees with this test, since the blocks come from the same
            // code that formats the time.
            roomyRun();
            jest.advanceTimersByTime(50);
            const firstFrame = glyphsOf(digitRows());

            jest.advanceTimersByTime(1000);
            expect(glyphsOf(digitRows())).not.toEqual(firstFrame);

            process.stdin.emit("data", Buffer.from("r"));
            jest.advanceTimersByTime(50);

            expect(glyphsOf(digitRows())).toEqual(firstFrame);
        });

        it("should move between timers with the arrow keys in the block digits", () => {
            roomyRun();
            jest.advanceTimersByTime(100);
            // The digits for the first timer at a tenth of a second, kept as
            // what moving back to it has to show again.
            const firstTimer = glyphsOf(digitRows());

            // The first timer stops at a tenth of a second and a new one starts
            // from zero, so the two show different times and the one that is not
            // current is listed under the digits.
            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(300);
            expect(terminal.screen[8]).toContain("⏸ 00:00.10");
            expect(glyphsOf(digitRows())).not.toEqual(firstTimer);

            process.stdin.emit("keypress", "", { name: "up" });
            jest.advanceTimersByTime(50);

            // The digits are the timer that is current again, stopped at a tenth
            // of a second, so they are drawn in the stopped colour and the
            // running one is the one listed.
            expect(glyphsOf(digitRows())).toEqual(firstTimer);
            writtenDigits().forEach((row) => {
                expect(row).toContain(coloured(STOPPED_COLOUR));
            });
            expect(terminal.screen[8]).toContain("▶ 00:00.35");

            process.stdin.emit("keypress", "", { name: "down" });
            jest.advanceTimersByTime(50);

            // And back to the new one, running, with the other listed again.
            expect(glyphsOf(digitRows())).not.toEqual(firstTimer);
            writtenDigits().forEach((row) => {
                expect(row).toContain(coloured(RUNNING_COLOUR));
            });
            expect(terminal.screen[8]).toContain("⏸ 00:00.10");
        });

        it("should not stack up rows when the display changes", () => {
            // Five rows is far too few for the digits, and wide enough for the
            // menu, so the fallback prints the menu above the line.
            roomyRun(SHORT);
            jest.advanceTimersByTime(50);
            // The menu is on row zero, the gap under it row one, the line row two
            // and the blank row under that row three, so the cursor parks below
            // all four.
            expect(terminal.row).toBe(4);

            for (let cycle = 0; cycle < 3; cycle++) {
                terminal.resize(ROOMY);
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

                terminal.resize(SHORT);
                jest.advanceTimersByTime(50);
                // Back to the plain line, wiped off the digits and drawn under
                // the menu, which is printed again now the region no longer
                // carries one, so the cursor parks below the blank row again.
                expect(terminal.row).toBe(4);
            }
        });

        it("should not drift when the display changes below other output", () => {
            useTerminal({ isTTY: true, canMoveCursor: true, ...ROOMY });
            terminal.write("\n".repeat(7));
            startRun();
            // Seven rows of other output, so the region starts on row seven and
            // the nine rows of the display park the cursor on row sixteen.
            jest.advanceTimersByTime(50);
            expect(terminal.row).toBe(16);

            for (let cycle = 0; cycle < 3; cycle++) {
                terminal.resize(SHORT);
                jest.advanceTimersByTime(50);
                // The menu goes on row seven, the gap row eight, the line row
                // nine, the blank row under it row ten, so the cursor parks on
                // row eleven.
                expect(terminal.row).toBe(11);

                terminal.resize(ROOMY);
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
            roomyRun();
            jest.advanceTimersByTime(50);
            expect(terminal.screen.some((row) => row.includes("█"))).toBe(true);

            terminal.resize(SHORT);
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
            roomyRun(SHORT);
            jest.advanceTimersByTime(50);

            terminal.resize(ROOMY);
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
            roomyRun();
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
            roomyRun();
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
            roomyRun(SHORT);
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
            roomyRun(SHORT);
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
            // unpadded. The moves the terminal is asked for are what a one row
            // terminal should never be asked for.
            roomyRun({ columns: 38, rows: 1 });
            jest.advanceTimersByTime(150);

            expectPlainLine();
            expect(terminal.moves).toHaveLength(0);
        });

        it("should not print the hint when it would wrap", () => {
            roomyRun({ columns: 20, rows: 40 });
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
            roomyRun({ columns: 50, rows: 40 });
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the width they need", () => {
            roomyRun({ columns: 51, rows: 40 });
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should fall back to the plain line when too short", () => {
            // The menu, the gap under it, five rows of digits, the gap under the
            // timer, the blank row under those and the row the cursor parks on
            // need ten rows. Nine is one too few.
            roomyRun({ columns: 120, rows: 9 });
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the height they need", () => {
            roomyRun({ columns: 120, rows: 10 });
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should fall back on a terminal that cannot move the cursor", () => {
            roomyRun();
            // A terminal that cannot move its cursor is the one that has to fall
            // back, so the capability is taken away rather than the model: the
            // screen model and the moves it can make are one thing, and a run
            // that asks for a move it cannot make gets nothing.
            terminal.resize({ canMoveCursor: false });
            jest.advanceTimersByTime(50);

            expectPlainLine();
            expect(terminal.moves).toHaveLength(0);
        });

        it("should fall back on TERM=dumb", () => {
            roomyRun();
            // A terminal that says it is dumb says so in the environment rather
            // than in a property, which is why the handle answers the question
            // of whether it can move its cursor rather than this test saying it
            // cannot: the rule is the terminal's, and it is asked of every run.
            process.env.TERM = "dumb";
            jest.advanceTimersByTime(50);

            expectPlainLine();
            expect(terminal.moves).toHaveLength(0);
        });

        it("should keep drawing when the terminal stops moving the cursor", () => {
            roomyRun();
            jest.advanceTimersByTime(50);
            expectDigits();

            // A terminal that stops answering the cursor half way through a run.
            // The digits have taken nine rows that it can no longer travel back
            // up to, and there is no way to hand those back - but the handover to
            // the plain line still has to happen, and it has to happen without
            // the stopwatch dying over a terminal that was answering a moment
            // ago. Every move of the cursor is asked of the terminal first, and
            // that question is the whole of the fix: unguarded it is a TypeError
            // out of the middle of the wipe, which is thrown from a setInterval
            // and takes the process with it.
            terminal.resize({ canMoveCursor: false });

            expect(() => jest.advanceTimersByTime(50)).not.toThrow();
            expectPlainLine();
        });
    });

    describe("when the terminal size is not known", () => {
        it("should wait for the size and draw nothing yet", () => {
            // A terminal that is one, says so, and reports no size: the size has
            // not come back yet and the app waits for it.
            useTerminal({ isTTY: true, canMoveCursor: true });
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
            useTerminal({ isTTY: true, canMoveCursor: true });
            startRun();
            jest.advanceTimersByTime(1500);

            expectPlainLine(true);
        });

        it("should treat a width of zero as a size it does not know", () => {
            // Zero is a number, so a terminal that reports it is not caught by
            // the check that there is a size at all, and only the check that it
            // is one fits.
            useTerminal({
                isTTY: true,
                canMoveCursor: true,
                columns: 0,
                rows: 40,
            });
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
            useTerminal({
                isTTY: true,
                canMoveCursor: true,
                columns: 120,
                rows: 0,
            });
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
            // No TTY, so there is no size coming: the app draws the plain line
            // straight away rather than waiting for one, and it still pads it
            // because the redraw can travel back up to it.
            useTerminal({ canMoveCursor: true });
            startRun();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });
    });

    describe("the display toggle", () => {
        it("should draw the block digits when nothing has been chosen", () => {
            // The default is the display the app has always picked for itself, so
            // a first run looks like the last one.
            roomyRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should switch to the plain line when d is pressed", () => {
            roomyRun();
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
            roomyRun();
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);
            expectPlainLine(true);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should remember the display it was switched to", () => {
            roomyRun();
            const writeFile = jest.spyOn(fs, "writeFileSync");
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            // Written when the key is pressed rather than on the way out, because
            // esc ends the process and a choice made just before pressing it
            // should not be the one that is lost.
            expect(JSON.parse(readSettings())).toEqual({ display: "line" });
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
            roomyRun();
            const writeFile = jest.spyOn(fs, "writeFileSync");
            const stopped = startRun();
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
            expect(JSON.parse(readSettings())).toEqual({ display: "digits" });
            writeFile.mockRestore();
        });

        it("should start on the plain line when that is what it was left on", () => {
            writeSettings(JSON.stringify({ display: "line" }));
            roomyRun();
            jest.advanceTimersByTime(50);

            // A terminal this size could draw the digits, so the only reason to
            // see the plain line is that it was asked for last time.
            expectPlainLine(true);
        });

        it("should stay on the plain line when the terminal grows", () => {
            writeSettings(JSON.stringify({ display: "line" }));
            // Just big enough for the block digits, so growing is not by itself
            // a reason to bring them back.
            useTerminal({
                isTTY: true,
                canMoveCursor: true,
                columns: 51,
                rows: 10,
            });
            startRun();
            jest.advanceTimersByTime(50);
            expectPlainLine(true);

            terminal.resize(ROOMY);
            jest.advanceTimersByTime(50);

            // Two states, not three: a terminal big enough for the digits is no
            // longer enough on its own to bring them back.
            expectPlainLine(true);
        });

        it("should start on the block digits when that is what it was left on", () => {
            writeSettings(JSON.stringify({ display: "digits" }));
            roomyRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should ignore a display it does not recognise", () => {
            writeSettings(
                JSON.stringify({ display: "something else", extra: 1 }),
            );
            roomyRun();
            jest.advanceTimersByTime(50);

            // A file someone has edited by hand reads as nothing remembered, so
            // the default applies rather than a display that is not one of the
            // two.
            expectDigits();
        });

        it("should ignore a settings file that is not readable", () => {
            writeSettings("this is not json");
            roomyRun();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should still switch when the settings cannot be written", () => {
            // A read only home directory should cost the remembering, not the
            // stopwatch, so nothing is reported and the display still changes.
            roomyRun();
            fs.mkdirSync(path.join(settingsHome, "console-stopwatch"), {
                recursive: true,
            });
            fs.mkdirSync(
                path.join(settingsHome, "console-stopwatch", "settings.json"),
            );
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should fall back to the plain line when the terminal is too small", () => {
            writeSettings(JSON.stringify({ display: "digits" }));
            roomyRun(SHORT);
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
        // below are ones the app can only have got to by counting. It is written
        // through the same handle a frame is, which is what makes it a write to
        // the same terminal rather than to whatever the process has open.
        const titles = () =>
            terminal.writes.filter((text) => text.includes("⏱"));

        // The whole sequence, and not just the one value, so a title that is
        // frozen, that skips a second or that counts too fast all fail here. The
        // clock ends the title, so one that grew hundredths fails too.
        const expectTitled = (time: string) =>
            expect(titles()).toContainEqual(
                expect.stringMatching(new RegExp(`⏱ ${time}\\x07$`)),
            );

        it("should show the elapsed time without hundredths", () => {
            roomyRun();
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
            roomyRun({ columns: 38, rows: 40 });
            jest.advanceTimersByTime(1500);

            expectTitled("00:01");

            jest.advanceTimersByTime(1000);

            expectTitled("00:02");
        });

        it("should only update the title once a second", () => {
            roomyRun();
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

    describe("output that is not a terminal", () => {
        // The default terminal of this file is one that says nothing about its
        // size and is not a TTY, which is what a pipe looks like from here. It
        // used to be indistinguishable from a screen that cannot move its
        // cursor, and the two need not be: a pipe has nothing that erases a
        // row, so two seconds of readings have to come out one per line to be
        // worth reading at all.
        const pipedRun = (config: TerminalConfig = {}) => {
            useTerminal(config);
            startRun();
        };

        it("should write one reading per line", () => {
            pipedRun();
            jest.advanceTimersByTime(500);

            const lines = readings();
            // Ten frames, and ten lines. One frame without a trailing newline
            // would run into the next, so every one of these has to be its own
            // line rather than one line with ten times on it.
            expect(lines).toHaveLength(10);
            expect(lines.every((line) => line.endsWith("\n"))).toBe(true);
            expect(lines.map((line) => line.trim())).toEqual([
                `${ESC}[38;5;214m00:00.05${ESC}[0m`,
                `${ESC}[38;5;214m00:00.10${ESC}[0m`,
                `${ESC}[38;5;214m00:00.15${ESC}[0m`,
                `${ESC}[38;5;214m00:00.20${ESC}[0m`,
                `${ESC}[38;5;214m00:00.25${ESC}[0m`,
                `${ESC}[38;5;214m00:00.30${ESC}[0m`,
                `${ESC}[38;5;214m00:00.35${ESC}[0m`,
                `${ESC}[38;5;214m00:00.40${ESC}[0m`,
                `${ESC}[38;5;214m00:00.45${ESC}[0m`,
                `${ESC}[38;5;214m00:00.50${ESC}[0m`,
            ]);
            // And what reaches the screen is ten rows, not one: the rows the
            // frames were written on are not taken back, because there is no
            // cursor to take them back with.
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(11);
        });

        it("should write no window title", () => {
            pipedRun();
            jest.advanceTimersByTime(1500);

            // A title is what a window shows. In a file the OSC sequence means
            // nothing, and it is written between the readings, so it has to be
            // gone rather than trimmed: nothing here should open with ESC ].
            expect(terminal.writes.some((text) => text.includes("\x1b]"))).toBe(
                false,
            );
            expect(terminal.writes.some((text) => text.includes("⏱"))).toBe(
                false,
            );
        });

        it("should still write the colour, which is the renderer's decision", () => {
            pipedRun();
            jest.advanceTimersByTime(50);

            // Not suppressed, and pinned so that stays a visible decision
            // rather than an oversight. The escapes are built in render, which
            // this change does not touch, so a pipe gets them until whatever
            // builds them is told not to. The assertion is on the SGR sequence
            // itself rather than on the whole write, because the newline above
            // is this change and the colour is not.
            expect(readings()[0]).toContain(`${ESC}[38;5;214m`);
            expect(readings()[0]).toContain(`${ESC}[0m`);
        });
    });

    describe("a terminal that cannot move its cursor", () => {
        it("should overwrite one row on TERM=dumb and not scroll", () => {
            // A dumb terminal is still a terminal: it is a screen that renders
            // what it is sent as plain text, and the block digits are not plain
            // text, so it gets the line - and the line is redrawn by erasing
            // the row it is on. Twenty frames a second has to be twenty
            // redraws of one row, not twenty rows a second pushing the window
            // up, which is what asking "can the cursor move" for the newline
            // instead of asking "is there a terminal" would have done here.
            process.env.TERM = "dumb";
            useTerminal({ isTTY: true, canMoveCursor: true, ...ROOMY });
            startRun();
            jest.advanceTimersByTime(1000);

            // Two rows on the screen: the keys, printed once, and the line.
            // Every frame overwrote the same one rather than adding to it.
            expect(terminal.screen).toHaveLength(2);
            expect(terminal.screen[0]).toContain("r reset");
            expect(terminal.screen[1]).toContain("00:01.00");

            // No frame is newline-terminated, which is what lets the next one
            // erase the row instead of landing after it.
            const frames = readings();
            expect(frames).toHaveLength(20);
            expect(frames.every((frame) => !frame.endsWith("\n"))).toBe(true);
            expect(frames[19]).toContain("00:01.00");
            // Still the same row at the end of it all, rather than 20 rows down.
            expect(terminal.row).toBe(1);
        });

        it("should overwrite one row on a terminal without cursor methods", () => {
            // The same screen that simply does not have the methods: a display
            // that redraws in place needs them, so it gets the line on a row of
            // its own, and the row is reused.
            useTerminal({ isTTY: true, canMoveCursor: false, ...ROOMY });
            startRun();
            jest.advanceTimersByTime(500);

            expect(terminal.screen).toHaveLength(2);
            expect(terminal.screen[1]).toContain("00:00.50");
            expect(terminal.moves).toHaveLength(0);
            expect(readings().every((frame) => !frame.endsWith("\n"))).toBe(
                true,
            );
            expect(terminal.row).toBe(1);
        });
    });
});
