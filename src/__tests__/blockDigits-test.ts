import { buildDigitRows, digitsWidth, GLYPH_HEIGHT } from "../blockDigits";

// Every digit, pinned to the rows it actually draws. Nothing else in the suite
// looks inside a digit, only at widths, so a 2 drawn as a 3 or an 8 drawn as a 0
// passes every other test in the repo. Read straight off the glyph table in
// blockDigits.ts: this documents what the code draws, it is not a claim about
// how a digit ought to look.
const DIGITS: [digit: string, rows: string[]][] = [
    ["0", [" █ ", "█ █", "█ █", "█ █", " █ "]],
    ["1", [" █ ", " █ ", " █ ", " █ ", " █ "]],
    ["2", ["███", "  █", "███", "█  ", "███"]],
    ["3", ["███", "  █", "███", "  █", "███"]],
    ["4", ["█ █", "█ █", "███", "  █", "  █"]],
    ["5", ["███", "█  ", "███", "  █", "███"]],
    ["6", ["███", "█  ", "███", "█ █", "███"]],
    ["7", ["███", "  █", "  █", "  █", "  █"]],
    ["8", ["███", "█ █", "███", "█ █", "███"]],
    ["9", ["███", "█ █", "███", "  █", "███"]],
];

describe("blockDigits", () => {
    it("should draw five rows", () => {
        const rows = buildDigitRows("00:00:00.00");

        expect(rows).toHaveLength(GLYPH_HEIGHT);
    });

    it("should draw every row the same width", () => {
        for (const time of ["00:00:00.00", "11:11:11.11", "9:59:59.99"]) {
            const rows = buildDigitRows(time);
            const widths = new Set(rows.map((row) => row.length));

            expect(widths.size).toBe(1);
        }
    });

    it("should report the width it actually draws", () => {
        for (const time of ["00:00:00.00", "100:00:00.00", "1234:00:00.00"]) {
            expect(digitsWidth(time)).toBe(buildDigitRows(time)[0].length);
        }
    });

    it("should be narrow enough for a split pane", () => {
        // 8 digits at 3 columns, 2 colons and a dot at 1, and a blank column
        // between each of the eleven glyphs.
        expect(digitsWidth("00:00:00.00")).toBe(37);
    });

    it("should grow a column past 99 hours", () => {
        const twoDigits = digitsWidth("99:00:00.00");
        const threeDigits = digitsWidth("100:00:00.00");

        expect(twoDigits).toBe(37);
        expect(threeDigits).toBe(twoDigits + 4);
    });

    it("should draw a zero as an outline", () => {
        const rows = buildDigitRows("0");

        expect(rows).toEqual([" █ ", "█ █", "█ █", "█ █", " █ "]);
    });

    describe("each digit", () => {
        it.each(DIGITS)("should draw a %s as these rows", (digit, rows) => {
            expect(buildDigitRows(digit)).toEqual(rows);
        });

        it.each(DIGITS)(
            "should draw a %s as five rows of three columns",
            (digit) => {
                const drawn = buildDigitRows(digit);

                // A ragged glyph leaves a gap in one of its rows and pushes every
                // column after it sideways, so the rows all have to be the same
                // width, and the width the module reports has to be the width it
                // actually draws.
                expect(drawn).toHaveLength(GLYPH_HEIGHT);
                expect(new Set(drawn.map((row) => row.length))).toEqual(
                    new Set([3]),
                );
                expect(digitsWidth(digit)).toBe(3);
            },
        );

        it.each(DIGITS)(
            "should draw a %s out of blocks and blanks only",
            (digit) => {
                for (const row of buildDigitRows(digit)) {
                    expect(row).toMatch(/^[ █]+$/);
                }
            },
        );

        it("should draw no two digits alike", () => {
            // The last guard against one digit quietly being drawn as another:
            // the rows above are only worth anything if they are all different.
            const drawn = DIGITS.map(([digit]) =>
                buildDigitRows(digit).join("\n"),
            );

            expect(new Set(drawn).size).toBe(DIGITS.length);
        });
    });

    it("should draw the colons on two rows only", () => {
        const colon = buildDigitRows(":");

        expect(colon).toEqual([" ", "█", " ", "█", " "]);
    });

    it("should draw the hundredths separator on the bottom row", () => {
        const dot = buildDigitRows(".");

        expect(dot).toEqual([" ", " ", " ", " ", "█"]);
    });

    it("should draw anything it does not know as blank", () => {
        const rows = buildDigitRows("x");

        expect(rows).toEqual([" ", " ", " ", " ", " "]);
        // And the unknown glyph still takes its one column, so the digits
        // around it do not move.
        expect(digitsWidth("x")).toBe(1);
    });

    it("should leave a blank column between glyphs", () => {
        const rows = buildDigitRows("11");

        expect(rows[0]).toBe(" █   █ ");
    });

    it("should be five rows tall whatever it is given", () => {
        for (const text of ["", "0", "00:00:00.00", "nonsense", "😀"]) {
            expect(buildDigitRows(text)).toHaveLength(GLYPH_HEIGHT);
        }
    });
});
