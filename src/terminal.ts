// What a terminal can do, and the one thing the code uses to ask it to: both
// live here, so nothing has to find a terminal for itself - the handle is made
// once at the edge, where the process is, and handed down from there. Every
// question is asked again rather than cached, so a resize can swap the display.

// The size the terminal reports, as it reports it. A half that is undefined is a
// half not reported at all, which is a different answer from a half reported as
// zero, and only the questions below know what to do with either.
export type TerminalSize = {
    columns: number | undefined;
    rows: number | undefined;
};

// The terminal the display code draws on, and everything it needs of one. A
// terminal that cannot do one of these says so by not doing it, so nothing above
// asks whether a method is there - which is why a handle and not the stream.
export type Terminal = {
    // Text, escapes and all. A window title is written through here too, because
    // a frame and a title have to land on one descriptor for the row bookkeeping
    // to work.
    write(text: string): void;
    toStartOfRow(): void;
    // Never called on its own: every move goes through moveCursor() below.
    moveCursor(dx: number, dy: number): void;
    eraseToEndOfRow(): void;
    eraseBelow(): void;
    size(): TerminalSize;
    // Piped output never gets a cursor, and is never waited on for a size.
    isTerminal(): boolean;
    canMoveCursor(): boolean;
};

// A terminal that calls itself dumb renders what it is sent as plain text, and
// the block digits are not plain text, so it is asked about separately.
export function isDumbTerminal() {
    return process.env.TERM === "dumb";
}

// The handle the CLI runs on: the real one, over the process's own output, and
// the only thing in the program that knows where a terminal comes from.
export function createStdoutTerminal(): Terminal {
    // A stdout that is not a terminal is a socket, and a socket has no cursor
    // methods on it at all, so calling one is a TypeError thrown from inside the
    // redraw. Each asks whether it is there instead: a pipe never had a cursor to
    // move, which is the answer hasCursorMovement already gives for it.
    const cursor = process.stdout as Partial<typeof process.stdout>;
    return {
        write: (text) => process.stdout.write(text),
        toStartOfRow: () => cursor.cursorTo?.(0),
        moveCursor: (dx, dy) => cursor.moveCursor?.(dx, dy),
        eraseToEndOfRow: () => cursor.clearLine?.(1),
        eraseBelow: () => cursor.clearScreenDown?.(),
        size: () => ({
            columns: process.stdout.columns,
            rows: process.stdout.rows,
        }),
        isTerminal: () => process.stdout.isTTY === true,
        canMoveCursor: () =>
            typeof process.stdout.moveCursor === "function" &&
            !isDumbTerminal(),
    };
}

// Every move of the cursor goes through here rather than through the handle
// directly, because every move needs a terminal that can make it and a terminal
// can stop answering mid-run. Throwing out of the middle of a wipe is not one of
// the things a display holding rows it can no longer reach can do.
export function moveCursor(terminal: Terminal, dx: number, dy: number) {
    if (!hasCursorMovement(terminal)) {
        return;
    }
    terminal.moveCursor(dx, dy);
}

// Whether the terminal can move its cursor, which is what a display needs before
// it takes more than one row: redrawing rows in place, and clearing them, both
// mean travelling up. A terminal that cannot still gets the plain line, on a row
// of its own.
//
// There is deliberately no separate question about the block digits: the glyphs
// are text, so what a multi-row display needs is the movement and nothing else.
// Naming it after a display is how a display asks the wrong question.
export function hasCursorMovement(terminal: Terminal) {
    return terminal.canMoveCursor();
}

// Whether a row this wide fits on one row of the terminal. A width that is not a
// number is left to fit: there is nothing to measure against. A width of zero is
// an answer that leaves no room for the row rather than an unknown one.
export function fitsOnOneRow(terminal: Terminal, width: number) {
    const { columns } = terminal.size();
    if (typeof columns !== "number") {
        return true;
    }
    return columns >= width;
}

// The size the terminal reports, as a pair, or null when it cannot be drawn
// against. @types/node types both as numbers, but at runtime they are undefined
// when stdout is not a TTY, and a zero is not an answer either.
export function terminalSize(
    terminal: Terminal,
): { columns: number; rows: number } | null {
    const { columns, rows } = terminal.size();
    if (typeof columns !== "number" || typeof rows !== "number") {
        return null;
    }
    if (columns <= 0 || rows <= 0) {
        return null;
    }
    return { columns, rows };
}

export function hasKnownSize(terminal: Terminal) {
    return terminalSize(terminal) !== null;
}
