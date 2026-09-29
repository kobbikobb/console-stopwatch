// What the terminal can do, as opposed to what anything wants to draw on it.
// These are asked again every frame rather than cached, because a terminal can
// be resized at any time and that is what lets a display be swapped for another
// mid-run.

// Whether the terminal can move the cursor up and down, which is what redrawing
// several rows in place needs. A terminal that cannot still gets the plain line,
// overwritten on its own row.
export function hasDigitSupport() {
    return (
        typeof process.stdout.moveCursor === "function" &&
        process.env.TERM !== "dumb"
    );
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
