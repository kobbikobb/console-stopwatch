// What the terminal can do, as opposed to what anything wants to draw on it.
// These are asked again every frame rather than cached, because a terminal can
// be resized at any time and that is what lets a display be swapped for another
// mid-run.

// Whether the terminal can move its cursor, which is what a display needs
// before it takes more than one row: redrawing several rows in place means
// travelling back up to the first of them, and clearing them means travelling
// up to them at all. A terminal that cannot still gets the plain line,
// overwritten on its own row.
//
// There is deliberately no separate question about the block digits here. The
// glyphs are text, so what a multi row display needs is the movement and
// nothing else; naming that after a display rather than after the capability
// is how a display ends up asking the wrong question about itself.
export function hasCursorMovement() {
    return (
        typeof process.stdout.moveCursor === "function" &&
        process.env.TERM !== "dumb"
    );
}

// Whether a row this wide fits on one row of the terminal. A width that is not
// a number is left to fit: there is nothing to measure against, and a hint that
// wrapped takes a second row that the display it belongs to knows nothing
// about. A width of zero is an answer that leaves no room for the row rather
// than an unknown one, so it does not fit.
export function fitsOnOneRow(width: number) {
    const { columns } = process.stdout;
    if (typeof columns !== "number") {
        return true;
    }
    return columns >= width;
}

// The size the terminal is reporting, as a pair, or null when it is not
// reporting one it can be drawn against. @types/node types both as numbers, but
// at runtime they are undefined when stdout is not a TTY, and a terminal that
// answers with a zero has not really answered either, so both of those are an
// unknown size here. Asking once and handing back the narrowed pair is what
// stops a caller having to re-narrow the same two globals and getting it wrong.
export function terminalSize(): { columns: number; rows: number } | null {
    const { columns, rows } = process.stdout;
    if (typeof columns !== "number" || typeof rows !== "number") {
        return null;
    }
    if (columns <= 0 || rows <= 0) {
        return null;
    }
    return { columns, rows };
}

export function hasKnownSize() {
    return terminalSize() !== null;
}
