import { digitsWidth, GLYPH_HEIGHT } from "../blockDigits";
import {
    digitsHeight,
    digitsRequiredWidth,
    hintWidth,
    PADDING,
    renderDigits,
    renderHint,
    renderListedTimer,
    renderPlainLine,
    renderRegion,
} from "../render";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
// The two colour codes, written out. Building the expected escape out of the
// same helper the renderer calls with proves only that the two calls disagree,
// so any other pair of codes would pass; these are the codes themselves.
const RUNNING = `${ESC}[38;5;214m`;
const STOPPED = `${ESC}[38;5;244m`;
const stripAnsi = (text: string) =>
    text.split(RUNNING).join("").split(STOPPED).join("").split(RESET).join("");

describe("render", () => {
    describe("renderDigits", () => {
        it("should draw one row per glyph row", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            expect(rows).toHaveLength(GLYPH_HEIGHT);
        });

        it("should colour the glyphs, not an empty string before them", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });
            const first = rows[0];

            // The colour opens at the very start and the glyphs follow it
            // immediately. An empty coloured string would reset the colour again
            // before a single glyph was drawn, leaving the digits plain.
            expect(first.startsWith(RUNNING)).toBe(false);
            expect(first.startsWith(`${" ".repeat(PADDING)}${RUNNING}`)).toBe(
                true,
            );
            expect(first.endsWith(RESET)).toBe(true);
        });

        it("should colour a running timer orange, as the plain line does", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            expect(rows[0]).toContain(RUNNING);
        });

        it("should draw a paused timer in a different colour", () => {
            const running = renderDigits({ milliseconds: 50, isRunning: true });
            const paused = renderDigits({ milliseconds: 50, isRunning: false });

            expect(paused[0]).toContain(STOPPED);
            // Pinned to both codes, not just to "not the running one": a stopped
            // timer that went grey in a shade nobody chose still has to fail.
            expect(paused[0]).not.toContain(RUNNING);
            expect(paused[0]).not.toBe(running[0]);
        });

        it("should draw the elapsed time", () => {
            const oneMinute = renderDigits({
                milliseconds: 60 * 1000,
                isRunning: true,
            });
            const oneMinuteOne = renderDigits({
                milliseconds: 61 * 1000,
                isRunning: true,
            });

            // The block is exactly as wide as the time needs plus the padding,
            // and a different time draws a different block. The gate is wider
            // than this on purpose, to cover the hours appearing later.
            expect(stripAnsi(oneMinute[0]).length).toBe(
                PADDING + digitsWidth("01:00.00"),
            );
            expect(oneMinute).not.toEqual(oneMinuteOne);
        });

        it("should leave the hours out until there are any", () => {
            const zero = stripAnsi(
                renderDigits({ milliseconds: 0, isRunning: true })[0],
            );
            const oneHour = stripAnsi(
                renderDigits({
                    milliseconds: 60 * 60 * 1000,
                    isRunning: true,
                })[0],
            );

            // The hour brings a three wide glyph, a separator and two gaps.
            expect(zero).toHaveLength(oneHour.length - 6);
        });

        it("should inset every row by the padding", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            rows.forEach((row) => {
                expect(stripAnsi(row).startsWith(" ".repeat(PADDING))).toBe(
                    true,
                );
            });
        });
    });

    describe("renderListedTimer", () => {
        it("should mark a running timer", () => {
            const row = renderListedTimer({
                milliseconds: 50,
                isRunning: true,
            });

            expect(stripAnsi(row)).toContain("▶");
        });

        it("should mark a stopped timer", () => {
            const row = renderListedTimer({
                milliseconds: 50,
                isRunning: false,
            });

            expect(stripAnsi(row)).toContain("⏸");
        });

        it("should show the elapsed time", () => {
            const row = renderListedTimer({
                milliseconds: 12340,
                isRunning: true,
            });

            expect(stripAnsi(row)).toContain("00:12.34");
        });

        it("should line up with the digits", () => {
            const row = renderListedTimer({ milliseconds: 0, isRunning: true });
            const digits = renderDigits({ milliseconds: 0, isRunning: true });

            // Both start at the padding, so the listed timers sit under the
            // left edge of the block rather than against the terminal.
            expect(stripAnsi(row).startsWith(" ".repeat(PADDING))).toBe(true);
            expect(stripAnsi(digits[0]).startsWith(" ".repeat(PADDING))).toBe(
                true,
            );
        });
    });

    describe("renderHint", () => {
        it("should be indented like the rest of the display", () => {
            expect(stripAnsi(renderHint())).toMatch(/^ {2}\S/);
        });

        it("should be the dim colour of the listed timers", () => {
            expect(renderHint()).toContain(STOPPED);
        });

        it("should name every key", () => {
            const hint = stripAnsi(renderHint());

            ["r reset", "n new", "d display", "pause", "esc quit"].forEach(
                (key) => {
                    expect(hint).toContain(key);
                },
            );
        });
    });

    describe("digitsRequiredWidth", () => {
        it("should cover the width the digits draw at zero", () => {
            const required = digitsRequiredWidth(0);
            const drawn = renderDigits({ milliseconds: 0, isRunning: true });

            expect(required).toBeGreaterThanOrEqual(stripAnsi(drawn[0]).length);
        });

        it("should cover the hours appearing an hour in", () => {
            const under = digitsRequiredWidth(59 * 60 * 1000);
            const over = digitsRequiredWidth(60 * 60 * 1000);

            // The digits grow by four columns when the first hour appears, and
            // the gate has to already allow for it or the display would drop to
            // the plain line at that point.
            expect(over).toBe(under);
        });

        it("should be set by the menu, which is now the widest row", () => {
            // The menu grew wider than the timer when it started naming the key
            // that switches display, and the gate follows the widest row, so a
            // terminal that fits the menu fits the timer too.
            //
            // This is the cross check that works: it compares the gate against
            // the width of the menu, which the gate is not built out of, so it
            // fails if either side moves past the other. Comparing the gate
            // against the rows it is drawn from cannot fail, because the gate is
            // a max of those very widths.
            expect(digitsRequiredWidth(0)).toBe(hintWidth());
        });

        it("should still cover three digit hours", () => {
            // Growing the gate at 99 hours was how the hours were stopped from
            // wrapping. The menu is wider than three digit hours now, so the gate
            // does not have to grow for it, but the digits still have to fit
            // inside what it does allow.
            const milliseconds = 100 * 60 * 60 * 1000;
            const drawn = renderDigits({ milliseconds, isRunning: true });

            expect(digitsRequiredWidth(milliseconds)).toBeGreaterThanOrEqual(
                stripAnsi(drawn[0]).length,
            );
        });
    });

    describe("digitsHeight", () => {
        it("should be the menu, two gaps, the glyph height and the blank row", () => {
            expect(digitsHeight(0)).toBe(GLYPH_HEIGHT + 4);
        });

        it("should add a row per other timer", () => {
            expect(digitsHeight(2)).toBe(GLYPH_HEIGHT + 4 + 2);
        });
    });

    describe("renderRegion", () => {
        const current = { milliseconds: 5000, isRunning: true };
        const digits = renderDigits(current);

        it("should be the menu, a gap, the timer, a gap and a blank row", () => {
            const rows = renderRegion(current, []);

            expect(rows).toHaveLength(GLYPH_HEIGHT + 4);
            expect(stripAnsi(rows[0])).toContain("esc quit");
            expect(rows[1]).toBe("");
            // The five digit rows come next, with nothing else between them.
            for (let row = 0; row < GLYPH_HEIGHT; row++) {
                expect(rows[2 + row]).toBe(digits[row]);
            }
            // The gap under the timer, and the blank row under the display.
            expect(rows[GLYPH_HEIGHT + 2]).toBe("");
            expect(rows[GLYPH_HEIGHT + 3]).toBe("");
        });

        it("should keep the gap under the timer when others are listed", () => {
            const rows = renderRegion(current, [
                { milliseconds: 1000, isRunning: true },
                { milliseconds: 2000, isRunning: false },
            ]);

            expect(rows).toHaveLength(GLYPH_HEIGHT + 6);
            expect(stripAnsi(rows[0])).toContain("esc quit");
            expect(rows[1]).toBe("");
            // The gap stays directly under the timer, so asking for a new one
            // does not take the padding away. It used to sit above the keys,
            // where a listed timer took its place instead.
            expect(rows[GLYPH_HEIGHT + 2]).toBe("");
            expect(stripAnsi(rows[GLYPH_HEIGHT + 3])).toContain("00:01.00");
            expect(stripAnsi(rows[GLYPH_HEIGHT + 4])).toContain("00:02.00");
            expect(rows[GLYPH_HEIGHT + 5]).toBe("");
        });
    });

    describe("renderPlainLine", () => {
        it("should be the same output as before this change", () => {
            expect(renderPlainLine({ milliseconds: 50, isRunning: true })).toBe(
                "\x1b[38;5;214m00:00.05\x1b[0m",
            );
        });

        it("should grey a stopped timer, as the block digits do", () => {
            // It used to be the running colour whatever the state, so the same
            // stopped timer was orange on the line and grey in the digits. The
            // codes are written out rather than asked of the renderer, so this
            // pins 244 and not merely "some other colour than 214".
            expect(
                renderPlainLine({ milliseconds: 50, isRunning: false }),
            ).not.toBe(renderPlainLine({ milliseconds: 50, isRunning: true }));
            expect(
                renderPlainLine({ milliseconds: 50, isRunning: false }),
            ).toBe("\x1b[38;5;244m00:00.05\x1b[0m");
        });
    });
});
