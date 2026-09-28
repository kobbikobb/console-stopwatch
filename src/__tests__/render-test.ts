import { digitsWidth, GLYPH_HEIGHT } from "../blockDigits";
import {
    colorFor,
    digitsHeight,
    digitsRequiredWidth,
    hintWidth,
    PADDING,
    renderDigits,
    renderHint,
    renderListedTimer,
    renderPlainLine,
} from "../render";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const stripAnsi = (text: string) =>
    text
        .split(`${ESC}[38;5;214m`)
        .join("")
        .split(`${ESC}[38;5;244m`)
        .join("")
        .split(RESET)
        .join("");

describe("render", () => {
    describe("renderDigits", () => {
        it("should draw one row per glyph row", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            expect(rows).toHaveLength(GLYPH_HEIGHT);
        });

        it("should colour the glyphs, not an empty string before them", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });
            const first = rows[0];
            const colour = `${ESC}[38;5;${colorFor(true)}m`;

            // The colour opens at the very start and the glyphs follow it
            // immediately. An empty coloured string would reset the colour again
            // before a single glyph was drawn, leaving the digits plain.
            expect(first.startsWith(colour)).toBe(false);
            expect(first.startsWith(`${" ".repeat(PADDING)}${colour}`)).toBe(
                true,
            );
            expect(first.endsWith(RESET)).toBe(true);
        });

        it("should colour a running timer orange, as the plain line does", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            expect(rows[0]).toContain(`${ESC}[38;5;${colorFor(true)}m`);
        });

        it("should draw a paused timer in a different colour", () => {
            const running = renderDigits({ milliseconds: 50, isRunning: true });
            const paused = renderDigits({ milliseconds: 50, isRunning: false });

            expect(colorFor(true)).not.toBe(colorFor(false));
            expect(paused[0]).toContain(`${ESC}[38;5;${colorFor(false)}m`);
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
            expect(renderHint()).toContain(`${ESC}[38;5;244m`);
        });

        it("should name every key", () => {
            const hint = stripAnsi(renderHint());

            ["r reset", "n new", "pause", "esc quit"].forEach((key) => {
                expect(hint).toContain(key);
            });
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

        it("should be wider than the hint row", () => {
            // A row wider than the gate wraps, and the cursor arithmetic does
            // not know about the extra line.
            expect(hintWidth()).toBeLessThanOrEqual(digitsRequiredWidth(0));
        });

        it("should grow past 99 hours", () => {
            const under = digitsRequiredWidth(99 * 60 * 60 * 1000);
            const over = digitsRequiredWidth(100 * 60 * 60 * 1000);

            expect(over).toBe(under + 4);
        });
    });

    describe("digitsHeight", () => {
        it("should be the glyph height, the hint and the blank row", () => {
            expect(digitsHeight(0)).toBe(GLYPH_HEIGHT + 2);
        });

        it("should add a row per other timer", () => {
            expect(digitsHeight(2)).toBe(GLYPH_HEIGHT + 2 + 2);
        });
    });

    describe("renderPlainLine", () => {
        it("should be the same output as before this change", () => {
            expect(renderPlainLine(50)).toBe("\x1b[38;5;214m00:00.05\x1b[0m");
        });
    });
});
