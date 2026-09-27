import {
    buildTimeMatrix,
    GLYPH_HEIGHT,
    isBlinkingColonsOpen,
    matrixWidth,
} from "../bigFont";

const DIGITS = "0123456789";

describe("bigFont", () => {
    it("should render seven rows", () => {
        const matrix = buildTimeMatrix("0");

        expect(matrix.rows).toHaveLength(GLYPH_HEIGHT);
    });

    it("should render every digit the same width", () => {
        for (const digit of DIGITS) {
            const matrix = buildTimeMatrix(digit);

            const widths = matrix.rows.map((row) => row.length);

            expect(widths).toEqual(new Array(GLYPH_HEIGHT).fill(5));
        }
    });

    it("should render every row of a time the same width", () => {
        const matrix = buildTimeMatrix("00:00:00.00");

        const widths = matrix.rows.map((row) => row.length);

        expect(widths).toEqual(new Array(GLYPH_HEIGHT).fill(53));
    });

    it("should not leave undefined cells", () => {
        const matrix = buildTimeMatrix("1000:00:00.00");

        const cells = matrix.rows.flat();

        expect(cells.filter((cell) => cell === undefined)).toHaveLength(0);
        expect(cells.every((cell) => cell === " " || cell === "█")).toBe(true);
    });

    it("should separate glyphs with a single space", () => {
        expect(matrixWidth("11")).toBe(11);
        expect(matrixWidth("1:1")).toBe(13);
    });

    it("should report the colon columns", () => {
        const matrix = buildTimeMatrix("00:00:00.00");

        expect(matrix.colonColumns).toEqual([12, 26]);
    });

    it("should keep the dot on the bottom row only", () => {
        const matrix = buildTimeMatrix(".");

        const rowsWithPixels = matrix.rows
            .map((row, index) => (row[0] === "█" ? index : -1))
            .filter((index) => index >= 0);

        expect(rowsWithPixels).toEqual([GLYPH_HEIGHT - 1]);
    });

    it("should fall back to blank for unknown characters", () => {
        const matrix = buildTimeMatrix("x");

        expect(matrix.rows.flat().every((cell) => cell === " ")).toBe(true);
    });

    it("should alternate the colons once a second", () => {
        expect(isBlinkingColonsOpen(0)).toBe(true);
        expect(isBlinkingColonsOpen(999)).toBe(true);
        expect(isBlinkingColonsOpen(1000)).toBe(false);
        expect(isBlinkingColonsOpen(1999)).toBe(false);
        expect(isBlinkingColonsOpen(2000)).toBe(true);
    });
});
