/* eslint-disable no-control-regex -- matching raw ANSI escapes is the point */

import { GLYPH_HEIGHT } from "../bigFont";
import { CALM_RAMP, FRAME_COLOR, HOT_RAMP, WARM_RAMP } from "../palette";
import {
    bigFrameRequiredWidth,
    FrameState,
    MIN_INNER_WIDTH,
    renderBigFrame,
    renderPlainLine,
} from "../render";

const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");

const state = (overrides: Partial<FrameState> = {}): FrameState => ({
    current: { milliseconds: 123450, isRunning: true },
    others: [],
    now: 1000,
    ...overrides,
});

const visibleRows = (s: FrameState) => renderBigFrame(s).map(strip);

const colorsIn = (rows: string[]) =>
    [...rows.join("").matchAll(/\x1b\[38;5;(\d+)m/g)].map((match) =>
        Number(match[1]),
    );

// Digit rows only, minus the frame colour those rows also carry, so the
// assertions see nothing but the ramp.
const digitColorsIn = (s: FrameState) =>
    colorsIn(
        renderBigFrame(s).filter((row) => strip(row).includes("█")),
    ).filter((color) => color !== FRAME_COLOR);

describe("render", () => {
    it("should render the frame, the digits and the legend", () => {
        const rows = visibleRows(state());

        expect(rows[0].startsWith("╭─ stopwatch ")).toBe(true);
        expect(rows[0].endsWith("╮")).toBe(true);
        expect(rows[rows.length - 1].startsWith("╰─ ")).toBe(true);
        expect(rows[rows.length - 1]).toContain("r reset");
        expect(rows[rows.length - 1]).toContain("esc quit");
    });

    it("should render seven digit rows", () => {
        const rows = visibleRows(state());

        const digitRows = rows.filter((row) => row.includes("█"));

        expect(digitRows).toHaveLength(GLYPH_HEIGHT);
    });

    it("should draw the full time without dropping hours", () => {
        // 12:34:56.78, so the leading glyphs are "1" and "2" rather than
        // zeros. A dropped hour would leave a zero, or a narrower time block.
        const rows = visibleRows(
            state({
                current: { milliseconds: 45296789, isRunning: true },
            }),
        );

        const lit = rows.filter((row) => row.includes("█"));

        expect(lit).toHaveLength(GLYPH_HEIGHT);
        expect(lit[0]).toContain("   █   ███ ");
    });

    it("should keep every row the same visible width", () => {
        const rows = visibleRows(state());

        const widths = rows.map((row) => row.length);

        expect(new Set(widths)).toEqual(new Set([59]));
    });

    it("should keep every row the same width for a four digit hour", () => {
        const rows = visibleRows(
            state({
                current: { milliseconds: 1000 * 3600000, isRunning: true },
            }),
        );

        const widths = rows.map((row) => row.length);

        expect(new Set(widths).size).toBe(1);
        expect(widths[0]).toBeGreaterThan(59);
    });

    it("should never draw a row wider than the frame requires", () => {
        for (const milliseconds of [0, 999, 123450, 3723450, 1000 * 3600000]) {
            const rows = visibleRows(
                state({ current: { milliseconds, isRunning: true } }),
            );

            expect(Math.max(...rows.map((row) => row.length))).toBe(
                bigFrameRequiredWidth(milliseconds),
            );
        }
    });

    it("should blink the colons off halfway through the second", () => {
        const on = visibleRows(state({ now: 0 })).join("\n");
        const off = visibleRows(state({ now: 1000 })).join("\n");

        expect(on).not.toBe(off);
        expect(off.split("█").length).toBe(on.split("█").length - 4);
    });

    it("should list the other timers with a running marker", () => {
        const rows = visibleRows(
            state({
                others: [
                    { milliseconds: 3723000, isRunning: true },
                    { milliseconds: 90000, isRunning: false },
                ],
            }),
        );

        expect(rows).toHaveLength(13);
        expect(rows[11]).toContain("▶");
        expect(rows[11]).toContain("01:02:03.00");
        expect(rows[12]).toContain("⏸");
        expect(rows[12]).toContain("00:01:30.00");
    });

    it("should use the warm ramp while running", () => {
        const colors = digitColorsIn(state({ now: 0 }));

        expect(colors.length).toBeGreaterThan(0);
        expect(colors.every((color) => WARM_RAMP.includes(color))).toBe(true);
        expect(colors).toContain(WARM_RAMP[0]);
    });

    it("should use the calm ramp while paused", () => {
        const colors = digitColorsIn(
            state({ current: { milliseconds: 123450, isRunning: false } }),
        );

        expect(colors.every((color) => CALM_RAMP.includes(color))).toBe(true);
    });

    it("should use the hot ramp past an hour", () => {
        const colors = digitColorsIn(
            state({ current: { milliseconds: 3723450, isRunning: true } }),
        );

        expect(colors.every((color) => HOT_RAMP.includes(color))).toBe(true);
    });

    it("should never leave a colour open at the end of a row", () => {
        for (const row of renderBigFrame(state())) {
            let open: number | null = null;
            for (const [, code] of row.matchAll(/\x1b\[(38;5;\d+|0)m/g)) {
                open = code === "0" ? null : Number(code.slice(5));
            }
            expect(open).toBe(null);
        }
    });

    it("should keep the plain line output unchanged", () => {
        expect(renderPlainLine(50)).toBe("\x1b[38;5;214m00:00:00.05\x1b[0m");
    });

    it("should size the frame to the time it has to show", () => {
        expect(bigFrameRequiredWidth(0)).toBe(MIN_INNER_WIDTH + 2);
        expect(bigFrameRequiredWidth(1000 * 3600000)).toBeGreaterThan(
            bigFrameRequiredWidth(0),
        );
    });
});
