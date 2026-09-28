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

export function hasKnownSize() {
    return (
        typeof process.stdout.columns === "number" &&
        typeof process.stdout.rows === "number" &&
        (process.stdout.columns as number) > 0 &&
        (process.stdout.rows as number) > 0
    );
}
