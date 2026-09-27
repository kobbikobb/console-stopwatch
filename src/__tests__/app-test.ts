import { run } from "../app";

describe("app run", () => {
    const consoleSpy = jest.spyOn(console, "log").mockImplementation();
    const exitSpy = jest.spyOn(process, "exit").mockImplementation();
    const setRawMode = jest.fn();
    const clearLine = jest.fn();
    const cursorTo = jest.fn();
    const write = jest.fn();
    const exit = jest.fn();

    const originalColumns = process.stdout.columns;
    const originalRows = process.stdout.rows;
    const originalIsTty = process.stdout.isTTY;
    const originalMoveCursor = process.stdout.moveCursor;
    const originalClearScreenDown = process.stdout.clearScreenDown;
    const originalCursorTo = process.stdout.cursorTo;
    const originalTerm = process.env.TERM;

    process.stdin.setRawMode = setRawMode;
    process.stdout.clearLine = clearLine;
    process.stdout.cursorTo = cursorTo;
    process.stdout.write = write;
    // run() registers a keypress listener per call and the suite calls it many
    // times, so lift the default limit of ten.
    process.stdin.setMaxListeners(0);

    const setSize = (columns: number | undefined, rows: number | undefined) => {
        Object.defineProperty(process.stdout, "columns", {
            value: columns,
            configurable: true,
        });
        Object.defineProperty(process.stdout, "rows", {
            value: rows,
            configurable: true,
        });
    };

    const setTty = (isTty: boolean | undefined) => {
        Object.defineProperty(process.stdout, "isTTY", {
            value: isTty,
            configurable: true,
        });
    };

    // The default is a pipe, which is how jest runs: stdout is not a terminal,
    // so the single line fallback is exercised.
    const withoutFrameSupport = () => {
        Reflect.deleteProperty(process.stdout, "moveCursor");
        Reflect.deleteProperty(process.stdout, "clearScreenDown");
        setSize(undefined, undefined);
        setTty(undefined);
    };

    const withFrameSupport = (columns = 120, rows = 40) => {
        process.stdout.moveCursor = jest.fn();
        process.stdout.clearScreenDown = jest.fn();
        setSize(columns, rows);
        setTty(true);
    };

    // A minimal cursor model. The frame only stays in place if the cursor lands
    // back on the same spot after every frame, so track it rather than trusting
    // the escape sequences: moveCursor is relative on both axes, cursorTo moves
    // horizontally only, clearScreenDown does not move the cursor at all, and a
    // real terminal refuses to move past the top left corner.
    const fakeTerminal = () => {
        const terminal = {
            row: 0,
            column: 0,
            writeStarts: [] as { row: number; column: number }[],
        };
        process.stdout.cursorTo = ((x: number) => {
            terminal.column = Math.max(0, x);
        }) as typeof process.stdout.cursorTo;
        process.stdout.moveCursor = ((x: number, y: number) => {
            terminal.column = Math.max(0, terminal.column + x);
            terminal.row = Math.max(0, terminal.row + y);
        }) as typeof process.stdout.moveCursor;
        process.stdout.clearScreenDown =
            (() => {}) as typeof process.stdout.clearScreenDown;
        const realWrite = write.getMockImplementation();
        write.mockImplementation((chunk: unknown) => {
            const text = String(chunk);
            terminal.writeStarts.push({
                row: terminal.row,
                column: terminal.column,
            });
            for (let index = 0; index < text.length; index++) {
                const character = text[index];
                if (character === "\x1b") {
                    // Step over the escape sequence: CSI ends on a letter, OSC
                    // on BEL. Neither covers any visible column.
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
                    continue;
                }
                terminal.column += 1;
            }
            return realWrite ? realWrite(chunk) : true;
        });
        return terminal;
    };

    beforeEach(() => {
        jest.useFakeTimers();
        withoutFrameSupport();
        process.env.TERM = originalTerm;
    });

    afterEach(() => {
        consoleSpy.mockReset();
        exitSpy.mockReset();
        setRawMode.mockReset();
        clearLine.mockReset();
        cursorTo.mockReset();
        write.mockReset();
        exit.mockReset();
    });

    afterAll(() => {
        process.stdin.pause();
        process.stdin.removeAllListeners();
        process.stdout.moveCursor = originalMoveCursor;
        process.stdout.clearScreenDown = originalClearScreenDown;
        process.stdout.cursorTo = originalCursorTo;
        setSize(originalColumns, originalRows);
        setTty(originalIsTty);
        process.env.TERM = originalTerm;
    });

    const expectWriteToContainTime = (time: string) => {
        expect(write).toHaveBeenCalledWith(expect.stringContaining(time));
    };

    const expectWriteToContainLastTime = (time: string) => {
        expect(write).toHaveBeenLastCalledWith(expect.stringContaining(time));
    };

    it("should write a menu", () => {
        run();

        expect(consoleSpy).toHaveBeenCalledWith(
            "Press r to reset current timer.",
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            "Press n to create a new timer.",
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            "Press any other key to pause current timer.",
        );
        expect(consoleSpy).toHaveBeenCalledWith(
            "Press ctrl+c or escape to exit.",
        );
    });

    it("should write elpased time", () => {
        run();
        jest.advanceTimersByTime(50);

        expectWriteToContainTime("00:00:00.05");
    });

    it("should write elpased time with color", () => {
        run();
        jest.advanceTimersByTime(50);

        expect(write).toHaveBeenCalledWith("\x1b[38;5;214m00:00:00.05\x1b[0m");
    });

    it("should write elpased time twice", () => {
        run();
        jest.advanceTimersByTime(50);
        jest.advanceTimersByTime(50);

        expectWriteToContainTime("00:00:00.05");
        expectWriteToContainTime("00:00:00.10");
    });

    it("should reset timer", () => {
        run();
        jest.advanceTimersByTime(100);

        process.stdin.emit("data", Buffer.from("r"));
        jest.advanceTimersByTime(50);

        expectWriteToContainLastTime("00:00:00.05");
    });

    it("should create new timer", () => {
        run();
        jest.advanceTimersByTime(100);

        process.stdin.emit("data", Buffer.from("n"));
        jest.advanceTimersByTime(50);

        expectWriteToContainLastTime("00:00:00.05");
    });

    it("should pause timer", () => {
        run();
        process.stdin.emit("data", Buffer.from("x"));
        jest.advanceTimersByTime(100);

        expectWriteToContainLastTime("00:00:00.00");
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

    describe("when the terminal can draw the frame", () => {
        beforeEach(() => {
            withFrameSupport();
        });

        it("should draw the frame instead of the menu", () => {
            run();
            jest.advanceTimersByTime(50);

            expect(consoleSpy).not.toHaveBeenCalled();
            expect(write).toHaveBeenLastCalledWith(
                expect.stringContaining("stopwatch"),
            );
            expect(write).toHaveBeenLastCalledWith(
                expect.stringContaining("█"),
            );
        });

        it("should keep the frame eleven rows tall", () => {
            run();
            jest.advanceTimersByTime(50);

            const last = write.mock.calls[write.mock.calls.length - 1][0];

            expect(last.trimEnd().split("\n")).toHaveLength(11);
        });

        it("should not write to the last line only", () => {
            run();
            jest.advanceTimersByTime(50);

            expect(clearLine).not.toHaveBeenCalled();
        });

        it("should move the cursor back up for the next frame", () => {
            run();
            jest.advanceTimersByTime(50);
            jest.advanceTimersByTime(50);

            expect(process.stdout.moveCursor).toHaveBeenCalledWith(0, -11);
        });

        it("should keep the frame on the same rows every frame", () => {
            const terminal = fakeTerminal();
            run();

            const rows: number[] = [];
            for (let frame = 0; frame < 5; frame++) {
                jest.advanceTimersByTime(50);
                rows.push(terminal.row);
            }

            expect(rows[0]).toBe(11);
            expect(new Set(rows).size).toBe(1);
        });

        it("should start the frame at the left edge after a plain line", () => {
            // A plain line leaves the cursor at the end of the text, and
            // moveCursor does not reset the column, so the frame would be drawn
            // part way across the row without an explicit move first.
            withFrameSupport(40);
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);
            expect(write).toHaveBeenLastCalledWith(
                expect.stringContaining("00:00:00.05"),
            );

            withFrameSupport(120);
            terminal.writeStarts.length = 0;
            jest.advanceTimersByTime(50);

            expect(write).toHaveBeenLastCalledWith(
                expect.stringContaining("stopwatch"),
            );
            expect(
                terminal.writeStarts[terminal.writeStarts.length - 1],
            ).toEqual({ row: 0, column: 0 });
        });

        it("should keep the frame on the same rows after adding a timer", () => {
            const terminal = fakeTerminal();
            run();
            jest.advanceTimersByTime(50);
            const before = terminal.row;

            process.stdin.emit("data", Buffer.from("n"));
            const rows: number[] = [];
            for (let frame = 0; frame < 3; frame++) {
                jest.advanceTimersByTime(50);
                rows.push(terminal.row);
            }

            expect(terminal.row).toBe(before + 1);
            expect(new Set(rows).size).toBe(1);
        });

        it("should set the window title without centiseconds", () => {
            run();
            jest.advanceTimersByTime(50);

            expect(write).toHaveBeenCalledWith(
                expect.stringContaining("\x1b]0;⏱ 00:00:00\x07"),
            );
        });

        it("should only update the window title once a second", () => {
            run();
            jest.advanceTimersByTime(500);

            const titles = write.mock.calls.filter(([call]) =>
                String(call).includes("\x1b]0;"),
            );

            expect(titles).toHaveLength(1);
        });
    });

    it("should fall back to the single line when the terminal is too narrow", () => {
        withFrameSupport(20);
        run();
        jest.advanceTimersByTime(50);

        expect(consoleSpy).toHaveBeenCalledWith(
            "Press r to reset current timer.",
        );
        expect(write).toHaveBeenLastCalledWith(
            expect.stringContaining("00:00:00.05"),
        );
    });

    it("should fall back to the single line when the terminal is too short", () => {
        // Wide enough, but the frame would scroll the screen, and a scrolled
        // frame can never be redrawn in the same place.
        withFrameSupport(120, 8);
        run();
        jest.advanceTimersByTime(50);

        expect(consoleSpy).toHaveBeenCalledWith(
            "Press r to reset current timer.",
        );
        expect(write).toHaveBeenLastCalledWith(
            expect.stringContaining("00:00:00.05"),
        );
    });

    it("should need one row more than the frame is tall", () => {
        // Eleven rows hold the frame, but the write ends in a newline, so the
        // cursor needs a twelfth row or the screen scrolls on every frame.
        withFrameSupport(120, 11);
        run();
        jest.advanceTimersByTime(50);
        expect(write).toHaveBeenLastCalledWith(
            expect.stringContaining("00:00:00.05"),
        );

        withFrameSupport(120, 12);
        jest.advanceTimersByTime(50);
        expect(write).toHaveBeenLastCalledWith(
            expect.stringContaining("stopwatch"),
        );
    });

    it("should wait for a terminal size before drawing anything", () => {
        withFrameSupport(120);
        setSize(undefined, undefined);
        run();
        jest.advanceTimersByTime(200);

        expect(write).not.toHaveBeenCalled();
        expect(consoleSpy).not.toHaveBeenCalled();
        expect(process.stdout.clearScreenDown).not.toHaveBeenCalled();

        setSize(120, 40);
        jest.advanceTimersByTime(50);

        expect(write).toHaveBeenLastCalledWith(
            expect.stringContaining("stopwatch"),
        );
    });

    it("should give up waiting for a size that never arrives", () => {
        // A terminal that reports no size at all still has to show something.
        withFrameSupport(120);
        setSize(undefined, undefined);
        run();
        jest.advanceTimersByTime(2000);

        expect(consoleSpy).toHaveBeenCalledWith(
            "Press r to reset current timer.",
        );
        expect(write).toHaveBeenLastCalledWith(
            expect.stringContaining("\x1b[38;5;214m"),
        );
        expect(write).not.toHaveBeenCalledWith(
            expect.stringContaining("stopwatch"),
        );
    });

    it("should write the plain line without waiting for a size when not a terminal", () => {
        // A real pipe has no clearLine, so it cannot reach this code: master
        // throws on clearLine there too. What matters here is that the new size
        // gate does not hold the plain line back when stdout is not a terminal.
        run();
        jest.advanceTimersByTime(50);

        expect(write).toHaveBeenLastCalledWith(
            expect.stringContaining("00:00:00.05"),
        );
    });

    it("should fall back to the single line on a dumb terminal", () => {
        process.env.TERM = "dumb";
        run();
        jest.advanceTimersByTime(50);

        expect(consoleSpy).toHaveBeenCalledWith(
            "Press r to reset current timer.",
        );
    });

    it("should show the paused timer on the next frame", () => {
        run();
        process.stdin.emit("data", Buffer.from("x"));
        jest.advanceTimersByTime(100);

        expectWriteToContainLastTime("00:00:00.00");
    });
});
