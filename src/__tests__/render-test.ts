import { GLYPH_HEIGHT } from "../blockDigits";
import {
    colorFor,
    digitsHeight,
    digitsRequiredWidth,
    renderDigits,
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
            expect(first.startsWith(colour)).toBe(true);
            expect(first.startsWith(`${colour}${RESET}`)).toBe(false);
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

            // The block is exactly as wide as the time needs, and a different
            // time draws a different block.
            expect(stripAnsi(oneMinute[0]).length).toBe(
                digitsRequiredWidth(60 * 1000),
            );
            expect(oneMinute).not.toEqual(oneMinuteOne);
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

            expect(stripAnsi(row)).toContain("00:00:12.34");
        });

        it("should be indented under the digits", () => {
            const row = renderListedTimer({ milliseconds: 0, isRunning: true });

            expect(row.startsWith("  ")).toBe(true);
        });
    });

    describe("digitsRequiredWidth", () => {
        it("should be the width the digits draw at zero", () => {
            const required = digitsRequiredWidth(0);
            const drawn = renderDigits({ milliseconds: 0, isRunning: true });

            expect(required).toBe(stripAnsi(drawn[0]).length);
        });

        it("should grow past 99 hours", () => {
            const under = digitsRequiredWidth(99 * 60 * 60 * 1000);
            const over = digitsRequiredWidth(100 * 60 * 60 * 1000);

            expect(over).toBe(under + 4);
        });
    });

    describe("digitsHeight", () => {
        it("should be the glyph height with no other timers", () => {
            expect(digitsHeight(0)).toBe(GLYPH_HEIGHT);
        });

        it("should add a row per other timer", () => {
            expect(digitsHeight(2)).toBe(GLYPH_HEIGHT + 2);
        });
    });

    describe("renderPlainLine", () => {
        it("should be the same output as before this change", () => {
            expect(renderPlainLine(50)).toBe(
                "\x1b[38;5;214m00:00:00.05\x1b[0m",
            );
        });
    });
});
