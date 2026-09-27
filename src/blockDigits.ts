// Three by five block digits. Big enough to read across a room, small enough
// that the stopwatch still fits in a split terminal pane.
export const GLYPH_HEIGHT = 5;

const DIGITS: Record<string, string[]> = {
    "0": [" █ ", "█ █", "█ █", "█ █", " █ "],
    "1": [" █ ", " █ ", " █ ", " █ ", " █ "],
    "2": ["███", "  █", "███", "█  ", "███"],
    "3": ["███", "  █", "███", "  █", "███"],
    "4": ["█ █", "█ █", "███", "  █", "  █"],
    "5": ["███", "█  ", "███", "  █", "███"],
    "6": ["███", "█  ", "███", "█ █", "███"],
    "7": ["███", "  █", "  █", "  █", "  █"],
    "8": ["███", "█ █", "███", "█ █", "███"],
    "9": ["███", "█ █", "███", "  █", "███"],
};

const COLON: string[] = [" ", "█", " ", "█", " "];

const DOT: string[] = [" ", " ", " ", " ", "█"];

const BLANK: string[] = [" ", " ", " ", " ", " "];

const GLYPHS: Record<string, string[]> = {
    ...DIGITS,
    ":": COLON,
    ".": DOT,
    " ": BLANK,
};

function glyphFor(character: string) {
    return GLYPHS[character] || BLANK;
}

export function buildDigitRows(text: string) {
    const glyphs = [...text].map(glyphFor);
    const rows: string[][] = Array.from({ length: GLYPH_HEIGHT }, () => []);

    glyphs.forEach((glyph, index) => {
        // One blank column between glyphs, so the digits do not run together.
        if (index > 0) {
            for (const row of rows) {
                row.push(" ");
            }
        }
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
            for (const character of glyph[row]) {
                rows[row].push(character);
            }
        }
    });

    return rows.map((row) => row.join(""));
}

export function digitsWidth(text: string) {
    return [...text].reduce(
        (width, character, index) =>
            width + glyphFor(character)[0].length + (index > 0 ? 1 : 0),
        0,
    );
}
