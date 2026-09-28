import { run } from "../app";

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
        // The hint line goes out through console.log, so it has to reach the
        // fake terminal too or the cursor model cannot see the row it takes.
        consoleSpy.mockImplementation((...args: unknown[]) => {
            process.stdout.write(`${args.map(String).join(" ")}\n`);
        });
    });

    afterEach(() => {
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
    // only there when the redraw can travel back up to the line.
    const expectPlainLine = (padded = false) =>
        expectWriteToContainLastTime(
            new RegExp(
                `^${String.fromCharCode(27)}\\[38;5;214m` +
                    `\\d{2}:\\d{2}\\.\\d{2}` +
                    `${String.fromCharCode(27)}\\[0m` +
                    `${padded ? "\\n\\n" : ""}$`,
            ),
        );

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
        process.stdin.emit("data", Buffer.from("x"));
        jest.advanceTimersByTime(100);

        expectWriteToContainLastTime("00:00.00");
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
            // Five rows of digits, the hint under them and the blank row below
            // that, with the cursor parked on the row after it.
            expect(terminal.row).toBe(7);
        });

        it("should draw the hint under the timer as part of the display", () => {
            withDigitSupport(120, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            // The hint is a row of the region rather than a line printed once
            // above, so it comes after the digits in the same write and is
            // redrawn with them.
            const lastWrite = String(
                write.mock.calls[write.mock.calls.length - 1][0],
            );
            const rows = lastWrite.split("\n").filter((row) => row.length > 0);
            expect(rows[0]).toContain("█");
            expect(rows[rows.length - 1]).toContain("esc quit");
            expect(consoleSpy).not.toHaveBeenCalled();
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
            expect(terminal.row).toBe(7);
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
            expect(terminal.row).toBe(8);
        });

        it("should not stack up rows when the display changes", () => {
            // 38 columns is one too few for the digits, and exactly enough for
            // the hint, so the fallback prints it above the line.
            withDigitSupport(38, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);
            // The hint is printed above the plain line, so the line is on row
            // one, the blank row under it is row two, and the cursor parks
            // below both of them.
            expect(terminal.row).toBe(3);

            for (let cycle = 0; cycle < 3; cycle++) {
                withDigitSupport(120, 40);
                terminal.attach();
                terminal.writeStarts.length = 0;
                jest.advanceTimersByTime(50);
                expect(terminal.row).toBe(7);
                // The plain line left the cursor at the end of the text, and
                // moveCursor does not touch the column, so the digits have to
                // be put back at the left edge or they start part way across.
                // The hint the fallback left above is reclaimed, so the region
                // starts on row zero rather than below it.
                expect(
                    terminal.writeStarts[terminal.writeStarts.length - 1],
                ).toEqual({ row: 0, column: 0 });

                withDigitSupport(38, 40);
                terminal.attach();
                jest.advanceTimersByTime(50);
                // Back to the plain line, wiped off the digits and drawn under
                // the hint, which is printed again now the region no longer
                // carries one, so the cursor parks below the blank row again.
                expect(terminal.row).toBe(3);
            }
        });

        it("should not drift when the display changes below other output", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            process.stdout.write("\n".repeat(7));
            run();
            // Seven rows of other output, so the region starts on row seven and
            // the cursor parks on row fourteen.
            jest.advanceTimersByTime(50);
            expect(terminal.row).toBe(14);

            for (let cycle = 0; cycle < 3; cycle++) {
                withDigitSupport(38, 40);
                terminal.attach();
                jest.advanceTimersByTime(50);
                // The hint goes on row seven, the line on row eight, the blank
                // row under it on row nine, so the cursor parks on row ten.
                expect(terminal.row).toBe(10);

                withDigitSupport(120, 40);
                terminal.attach();
                terminal.writeStarts.length = 0;
                jest.advanceTimersByTime(50);
                // Back on the same row, not a row higher and not a row lower.
                // The hint the fallback printed is one row above the line, and
                // reclaiming it puts the region back on row seven.
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

            withDigitSupport(38, 40);
            terminal.attach();
            jest.advanceTimersByTime(50);

            // The rows the region used to own are cleared rather than left
            // showing the last frame of the digits, which a cursor position
            // cannot tell. The hint above the line is the only thing left.
            const left = terminal.screen.filter((row) => row.includes("█"));
            expect(left).toHaveLength(0);
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(2);
        });

        it("should leave nothing of the digits behind when they come back", () => {
            withDigitSupport(38, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            withDigitSupport(120, 40);
            terminal.attach();
            jest.advanceTimersByTime(50);

            // The hint the fallback printed above the line is gone, and the
            // display has a hint of its own under the timer, so the screen
            // holds the region and nothing else.
            expect(terminal.screen[0]).toContain("█");
            expect(
                terminal.screen.filter((row) => row.trim().length > 0),
            ).toHaveLength(6);
        });

        it("should leave a blank row under the keys", () => {
            withDigitSupport(120, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            const hintRow = () =>
                terminal.screen.findIndex((row) => row.includes("esc quit"));
            expect(hintRow()).toBe(5);
            expect(terminal.screen[6] || "").toBe("");
            expect(terminal.row).toBe(7);

            process.stdin.emit("data", Buffer.from("n"));
            jest.advanceTimersByTime(50);

            // The blank row moves down with the hint rather than the display
            // sliding into it, so it is a row of the region and not the row the
            // cursor happens to be parked on.
            expect(hintRow()).toBe(6);
            expect(terminal.screen[7] || "").toBe("");
            expect(terminal.row).toBe(8);
        });

        it("should leave a blank row under the plain line", () => {
            withDigitSupport(38, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            // The hint is on row zero, so the line is on row one and the blank
            // row under it is row two, with the cursor parked on row three.
            const line = () =>
                terminal.screen.findIndex((row) => row.includes("00:00."));
            expect(line()).toBe(1);
            expect(terminal.screen[2] || "").toBe("");
            expect(terminal.row).toBe(3);

            // The blank row is a row of the display, so it stays put instead of
            // the display stepping down a row every frame.
            for (let frame = 0; frame < 3; frame++) {
                jest.advanceTimersByTime(50);
                expect(line()).toBe(1);
                expect(terminal.screen[2] || "").toBe("");
                expect(terminal.row).toBe(3);
            }
        });

        it("should clear the blank row under the plain line", () => {
            withDigitSupport(38, 40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);
            expect(terminal.row).toBe(3);

            // Anything that writes into the row under the display has to go with
            // it, the same as the rows of the block digits are.
            terminal.screen[2] = "something else";
            jest.advanceTimersByTime(50);

            expect(terminal.screen[2] || "").toBe("");
            expect(terminal.row).toBe(3);
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
            // The display needs 39 columns, and 38 is one too few.
            withDigitSupport(38, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the width they need", () => {
            withDigitSupport(39, 40);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectDigits();
        });

        it("should fall back to the plain line when too short", () => {
            // Five rows of digits, the hint, the blank row under it and the row
            // the cursor parks on need eight rows. Seven is one too few.
            withDigitSupport(120, 7);
            fakeTerminal();
            run();
            jest.advanceTimersByTime(50);

            expectPlainLine(true);
        });

        it("should draw the digits at exactly the height they need", () => {
            withDigitSupport(120, 8);
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
