export const GLYPH_HEIGHT = 7;

const DIGITS: Record<string, string[]> = {
    "0": [" ███ ", "█   █", "█   █", "█   █", "█   █", "█   █", " ███ "],
    "1": ["   █ ", "   █ ", "   █ ", "   █ ", "   █ ", "   █ ", " ███ "],
    "2": [" ███ ", "█   █", "    █", "   █ ", " █   ", "█    ", "█████"],
    "3": [" ███ ", "█   █", "    █", " ███ ", "    █", "█   █", " ███ "],
    "4": ["█   █", "█   █", "█   █", "█████", "    █", "    █", "    █"],
    "5": ["█████", "█    ", "█    ", "████ ", "    █", "█   █", " ███ "],
    "6": [" ███ ", "█    ", "█    ", "████ ", "█   █", "█   █", " ███ "],
    "7": ["█████", "    █", "   █ ", "  █  ", " █   ", " █   ", " █   "],
    "8": [" ███ ", "█   █", "█   █", " ███ ", "█   █", "█   █", " ███ "],
    "9": [" ███ ", "█   █", "█   █", " ████", "    █", "    █", " ███ "],
};

const COLON: string[] = [" ", "█", " ", " ", " ", "█", " "];

const DOT: string[] = [" ", " ", " ", " ", " ", " ", "█"];

const BLANK: string[] = [" ", " ", " ", " ", " ", " ", " "];

const GLYPHS: Record<string, string[]> = {
    ...DIGITS,
    ":": COLON,
    ".": DOT,
    " ": BLANK,
};

function glyphFor(character: string) {
    return GLYPHS[character] || BLANK;
}

export type TimeMatrix = {
    rows: string[][];
    colonColumns: number[];
};

export function buildTimeMatrix(text: string): TimeMatrix {
    const glyphs = [...text].map(glyphFor);
    const colonColumns: number[] = [];

    const rows: string[][] = Array.from({ length: GLYPH_HEIGHT }, () => []);
    let column = 0;

    glyphs.forEach((glyph, index) => {
        if (index > 0) {
            for (const row of rows) {
                row.push(" ");
            }
            column += 1;
        }
        if (glyph === COLON) {
            colonColumns.push(column);
        }
        for (let row = 0; row < GLYPH_HEIGHT; row++) {
            for (const character of glyph[row]) {
                rows[row].push(character);
            }
        }
        column += glyph[0].length;
    });

    return { rows, colonColumns };
}

export function matrixWidth(text: string) {
    return buildTimeMatrix(text).rows[0].length;
}

export function isBlinkingColonsOpen(now: number, periodMilliseconds = 1000) {
    return Math.floor(now / periodMilliseconds) % 2 === 0;
}
