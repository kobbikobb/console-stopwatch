import fs from "fs";
import os from "os";
import path from "path";
import { run } from "../app";
import { GLYPH_HEIGHT } from "../blockDigits";
import { colorFor } from "../render";

const ESC = String.fromCharCode(27);

describe("app run", () => {
    const consoleSpy = jest.spyOn(console, "log");
    const exitSpy = jest.spyOn(process, "exit").mockImplementation();
    const setRawMode = jest.fn();
    const clearLine = jest.fn();
    const cursorTo = jest.fn();
    const write = jest.fn();

    process.stdin.setRawMode = setRawMode;
    process.stdout.clearLine = clearLine;
    process.stdout.cursorTo = cursorTo;
    process.stdout.write = write;

    const originalTerm = process.env.TERM;
    const originalColumns = process.stdout.columns;
    const originalRows = process.stdout.rows;
    const originalIsTTY = process.stdout.isTTY;
    const originalConfigHome = process.env.XDG_CONFIG_HOME;

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
        process.env.TERM = originalTerm;
        settingsHome = fs.mkdtempSync(
            path.join(os.tmpdir(), "stopwatch-test-"),
        );
        process.env.XDG_CONFIG_HOME = settingsHome;
        // The hint line goes out through console.log, so it has to reach the
        // fake terminal too or the cursor model cannot see the row it takes.
        consoleSpy.mockImplementation((...args: unknown[]) => {
            process.stdout.write(`${args.map(String).join(" ")}\n`);
        });
    });

    afterEach(() => {
        fs.rmSync(settingsHome, { recursive: true, force: true });
        consoleSpy.mockReset();
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
        process.stdin.removeAllListeners();
        process.env.TERM = originalTerm;
        delete process.env.XDG_CONFIG_HOME;
        if (originalConfigHome !== undefined) {
            process.env.XDG_CONFIG_HOME = originalConfigHome;
        }
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
                `^${String.fromCharCode(27)}\\[38;5;${colorFor(running)}m` +
                    `\\d{2}:\\d{2}\\.\\d{2}` +
                    `${String.fromCharCode(27)}\\[0m` +
                    `${padded ? "\\n\\n" : ""}$`,
            ),
        );

    describe("a stopped timer", () => {
        // The block digits always greyed a stopped timer, so switching to the
        // plain line with d used to show the same stopped timer in orange. The
        // two displays have to agree or the key looks like it changed something
        // it did not.
        it("should grey the plain line, as the block digits already did", () => {
            withDigitSupport(120, 5);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);
            expectPlainLine(true);

            process.stdin.emit("data", Buffer.from(" "));
            jest.advanceTimersByTime(50);

            expectPlainLine(true, false);
        });

        it("should still grey the block digits", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            run();
            process.stdin.emit("data", Buffer.from(" "));
            jest.advanceTimersByTime(50);

            // The menu is dim as well, so the digit rows are looked at rather
            // than the whole write.
            const rows = String(
                write.mock.calls[write.mock.calls.length - 1][0],
            ).split("\n");
            rows.slice(2, 2 + GLYPH_HEIGHT).forEach((row) => {
                expect(row).toContain(`${ESC}[38;5;${colorFor(false)}m`);
            });
        });

        it("should not grey a running timer on either display", () => {
            withDigitSupport(120, 5);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });
    });

    it("should write a hint line above the plain line", () => {
        run();
        jest.advanceTimersByTime(50);

        expect(consoleSpy).toHaveBeenCalledTimes(1);
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining("r reset"),
        );
    });

    it("should not reprint the hint above the plain line every frame", () => {
        run();
        jest.advanceTimersByTime(500);

        expect(consoleSpy).toHaveBeenCalledTimes(1);
    });

    it("should write elpased time", () => {
        run();
        jest.advanceTimersByTime(50);

        expectWriteToContainTime("00:00.05");
    });

    it("should write elpased time with color", () => {
        run();
        jest.advanceTimersByTime(50);

        expect(write).toHaveBeenLastCalledWith("\x1b[38;5;214m00:00.05\x1b[0m");
    });

    it("should write elpased time twice", () => {
        run();
        jest.advanceTimersByTime(50);
        jest.advanceTimersByTime(50);

        expectWriteToContainTime("00:00.05");
        expectWriteToContainTime("00:00.10");
    });

    it("should reset timer", () => {
        run();
        jest.advanceTimersByTime(100);

        process.stdin.emit("data", Buffer.from("r"));
        jest.advanceTimersByTime(50);

        expectWriteToContainLastTime("00:00.05");
    });

    it("should create new timer", () => {
        run();
        jest.advanceTimersByTime(100);

        process.stdin.emit("data", Buffer.from("n"));
        jest.advanceTimersByTime(50);

        expectWriteToContainLastTime("00:00.05");
    });

    it("should pause timer", () => {
        run();
        process.stdin.emit("data", Buffer.from(" "));
        jest.advanceTimersByTime(100);

        expectWriteToContainLastTime("00:00.00");
    });

    it("should ignore a key it has no use for", () => {
        // Every key that was not one of the timer keys used to be treated as a
        // pause, so a key aimed at nothing silently stopped the clock.
        run();
        process.stdin.emit("data", Buffer.from("x"));
        jest.advanceTimersByTime(100);

        expectWriteToContainLastTime("00:00.10");
    });

    it("should close the application when pressing ctrl+c", () => {
        run();
        process.stdin.emit("data", Buffer.from("\x03"));

        expect(exitSpy).toHaveBeenCalled();
    });

    it("should close the application when pressing esc", () => {
        run();
        process.stdin.emit("keypress", "", { name: "escape" });

        expect(exitSpy).toHaveBeenCalled();
    });

    it("should move between timers with the arrow keys", () => {
        run();
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

    describe("when the terminal can draw digits", () => {
        it("should draw the elapsed time in block digits", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectDigits();
            // The menu, the gap under it, five rows of digits, the gap under the
            // timer, the blank row under that, and the row the cursor parks on.
            expect(terminal.row).toBe(9);
        });

        it("should draw the menu at the top as part of the display", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            run();
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
            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it("should name the key that switches display in the menu", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expect(terminal.screen[0]).toContain("d display");
        });

        it("should keep the digits on the same rows every frame", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            run();
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
            run();
            jest.advanceTimersByTime(50);

            expect(
                terminal.writeStarts[terminal.writeStarts.length - 1],
            ).toEqual({ row: 0, column: 0 });
        });

        it("should list the other timers under the digits", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            run();
            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);

            // The timer that was replaced is stopped, so it is listed as such.
            expectWriteToContainLastTime(/⏸.*00:00\.00/);
            // One more row for the timer that was added.
            expect(terminal.row).toBe(10);
        });

        it("should not stack up rows when the display changes", () => {
            // Five rows is far too few for the digits, and wide enough for the
            // menu, so the fallback prints the menu above the line.
            withDigitSupport(120, 5);
            const terminal = fakeTerminal();
            run();
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
            run();
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
            run();
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
            run();
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
            run();
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
            run();
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
            run();
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
            run();
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
            run();
            jest.advanceTimersByTime(150);

            expectPlainLine();
            expect(process.stdout.moveCursor).not.toHaveBeenCalled();
        });

        it("should not print the hint when it would wrap", () => {
            withDigitSupport(20, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            // The hint is wider than the terminal, so it would take a second
            // row the plain line knows nothing about. The line still gets the
            // blank row under it, on row one, so the cursor parks on row two.
            expect(consoleSpy).not.toHaveBeenCalled();
            expect(terminal.row).toBe(2);
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(1);
        });

        it("should fall back to the plain line when too narrow", () => {
            // The menu is the widest row and it names the key that switches
            // display, so the display needs 50 columns and 49 is one too few.
            withDigitSupport(49, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the width they need", () => {
            withDigitSupport(50, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should fall back to the plain line when too short", () => {
            // The menu, the gap under it, five rows of digits, the gap under the
            // timer, the blank row under those and the row the cursor parks on
            // need ten rows. Nine is one too few.
            withDigitSupport(120, 9);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the height they need", () => {
            withDigitSupport(120, 10);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should fall back on a terminal that cannot move the cursor", () => {
            withDigitSupport(120, 40);
            // attach() installs the model, so the support has to be taken away
            // after it.
            fakeTerminal();
            withoutDigitSupport();
            run();
            jest.advanceTimersByTime(50);

            expectPlainLine();
        });

        it("should fall back on TERM=dumb", () => {
            withDigitSupport(120, 40);
            process.env.TERM = "dumb";
            fakeTerminal();
            run();
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
            run();
            jest.advanceTimersByTime(100);

            // Nothing at all, not even the hint: there is no way to know whether
            // the terminal is tall enough for the display to put it under.
            expect(terminal.row).toBe(0);
            expect(consoleSpy).not.toHaveBeenCalled();
        });

        it("should give up waiting and write the plain line", () => {
            Object.defineProperty(process.stdout, "isTTY", {
                value: true,
                configurable: true,
            });
            withDigitSupport(120, 40);
            clearSize();
            fakeTerminal();
            run();
            jest.advanceTimersByTime(1500);

            expectPlainLine(true);
        });

        it("should not wait when the output is not a terminal", () => {
            Object.defineProperty(process.stdout, "isTTY", {
                value: false,
                configurable: true,
            });
            clearSize();
            fakeTerminal();
            run();
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
            run();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should switch to the plain line when d is pressed", () => {
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            const terminal = fakeTerminal();
            run();
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
            run();
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
            run();
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            // Written when the key is pressed rather than on the way out, because
            // esc ends the process and a choice made just before pressing it
            // should not be the one that is lost.
            expect(JSON.parse(readSettings())).toEqual({ display: "standard" });
        });

        it("should start on the plain line when that is what it was left on", () => {
            writeSettings(JSON.stringify({ display: "standard" }));
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            // A terminal this size could draw the digits, so the only reason to
            // see the plain line is that it was asked for last time.
            expectPlainLine(true);
        });

        it("should stay on the plain line when the terminal grows", () => {
            writeSettings(JSON.stringify({ display: "standard" }));
            withDigitSupport(50, 10);
            const terminal = fakeTerminal();
            run();
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
            run();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should ignore a display it does not recognise", () => {
            writeSettings(
                JSON.stringify({ display: "something else", extra: 1 }),
            );
            withDigitSupport(ROOMY.columns, ROOMY.rows);
            fakeTerminal();
            run();
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
            run();
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
            run();
            jest.advanceTimersByTime(50);

            process.stdin.emit("data", Buffer.from("d"));
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should fall back to the plain line when the terminal is too small", () => {
            writeSettings(JSON.stringify({ display: "advanced" }));
            withDigitSupport(120, 5);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            // The measurement still gets the last word, so a remembered choice
            // the terminal cannot honour does not draw something it cannot draw.
            expectPlainLine(true);
        });
    });

    describe("the window title", () => {
        it("should show the elapsed time without hundredths", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expect(write).toHaveBeenCalledWith(
                expect.stringContaining("⏱ 00:00"),
            );
        });

        it("should mirror the time whichever way it is displayed", () => {
            // Thirty-eight columns is too narrow for the block digits, so the
            // plain line is the live display. The title is the app's, not a
            // display's, so it is mirrored either way.
            withDigitSupport(38, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expect(write).toHaveBeenCalledWith(
                expect.stringContaining("⏱ 00:00"),
            );
        });

        it("should only update the title once a second", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);
            const titleWrites = () =>
                write.mock.calls.filter((call) =>
                    String(call[0]).includes("⏱"),
                ).length;
            const first = titleWrites();

            jest.advanceTimersByTime(10 * 50);
            expect(titleWrites()).toBe(first);
        });
    });
});
