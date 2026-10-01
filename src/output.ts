import type { Display } from "./settings";
import {
    digitsRequiredWidth,
    hintWidth,
    renderLine,
    renderRegion,
    type TimerSnapshot,
} from "./render";
import {
    fitsOnOneRow,
    hasCursorMovement,
    moveCursor,
    terminalSize,
    type Terminal,
} from "./terminal";

// One way of putting the timers on the screen. What the rows of a display are
// lives in render, how they reach the terminal lives here, and which display is
// live is not the caller's business: it asks for one and hands over a snapshot
// every frame.
type OutputProvider = {
    // Whether this provider can draw on the terminal as it is right now.
    // Measured rather than guessed, so it can be asked again after a resize,
    // which is the only reason switching between providers is possible at all.
    canDraw(current: TimerSnapshot, others: TimerSnapshot[]): boolean;
    // Write one frame, or give back every row the display owns so the provider
    // taking over starts on a screen with nothing left on it.
    draw(current: TimerSnapshot, others: TimerSnapshot[]): void;
    clear(): void;
};

// The rows the last frame wrote, and the arithmetic to get back to the top of
// them. A provider owns one of these and nothing below it touches the cursor.
// The terminal is handed to it rather than found by it, so the same handle
// carries every write it makes and a display can be drawn on a terminal other
// than the process the code is running in.
function createRegion(terminal: Terminal) {
    // How many rows below the top of the region the cursor has ended up. Every
    // region row ends with a newline, so the cursor is parked that far down and
    // the next redraw travels all the way back up. A line written without one
    // leaves the cursor on its own row, so this is not the region's height.
    let cursorRows = 0;
    // How many rows the last frame wrote below the top of the region. These are
    // the rows the region owns, and the only ones a redraw may take back.
    let drawnRows = 0;
    // How many rows the display has printed above the top of the region. The
    // region cannot redraw them, so it only ever gives them back whole, and it
    // keeps the count itself: a count from outside can go out of step with the
    // rows on the screen.
    let rowsAbove = 0;

    function wipe() {
        terminal.toStartOfRow();
        if (drawnRows === 0) {
            return;
        }
        // Clearing to the end of the screen would take rows this display does
        // not own - the plain line's keys above it, for one - so the wipe clears
        // exactly the rows the last draw owned. Moving up and down is only
        // needed when the region is more than one row tall, and a display that
        // never drew more than one row never had a cursor to move.
        const taller = drawnRows > 1;
        if (taller) {
            moveCursor(terminal, 0, -cursorRows);
        }
        for (let row = 0; row < drawnRows; row++) {
            // 1 erases from the cursor to the end of the row, so a row that is
            // wider than what is drawn now is left clean.
            terminal.eraseToEndOfRow();
            if (row < drawnRows - 1) {
                moveCursor(terminal, 0, 1);
            }
        }
        if (taller) {
            moveCursor(terminal, 0, -(drawnRows - 1));
        }
        drawnRows = 0;
        cursorRows = 0;
    }

    // Give back every row the display owns: the rows above the region as well as
    // the region itself, for a display that leaves rows above itself which the
    // display taking over knows nothing about. How far up that is is arithmetic
    // on what was written - a padded line is a region of two rows with the
    // cursor parked below it, a plain one a single row with the cursor on it.
    function clear() {
        if (drawnRows === 0 && rowsAbove === 0) {
            // Nothing was printed, so there is nothing to give back, and
            // clearing from the cursor would take the rows above the display.
            return;
        }
        terminal.toStartOfRow();
        moveCursor(terminal, 0, -(cursorRows + rowsAbove));
        terminal.eraseBelow();
        drawnRows = 0;
        cursorRows = 0;
        rowsAbove = 0;
    }

    return {
        wipe,
        clear,

        // The rows a display leaves above the region: written once, at the top
        // of the display, and then left there because a redraw cannot reach
        // them. How many there are is a question about the terminal as it is
        // now, so a resize can answer it differently - and the rows written
        // before are then a different set of rows, so they have to be given back
        // before the new ones go out. Asking for the same number again is what
        // keeps the menu from being reprinted every frame, and comparing the
        // number rather than remembering whether the menu was printed is what
        // keeps the two from disagreeing about the screen. Each row ends with a
        // newline, exactly as the region rows do, so the menu is counted the
        // same way as what it sits above.
        printAbove(rows: string[]) {
            if (rows.length === rowsAbove) {
                return;
            }
            clear();
            for (const row of rows) {
                terminal.write(`${row}\n`);
            }
            rowsAbove = rows.length;
        },

        // The rows of a display, written the way that many rows have to be
        // written: a newline after each one, so the cursor parks below them and
        // the next frame can travel back up to the first. A single row gets none,
        // and is left there for the next frame to erase it - so it is only left
        // that way where there is a screen: isTerminal, not canMoveCursor.
        write(rows: string[]) {
            wipe();
            const ownRow = rows.length === 1 && terminal.isTerminal();
            terminal.write(ownRow ? rows[0] : `${rows.join("\n")}\n`);
            drawnRows = rows.length;
            cursorRows = ownRow ? 0 : rows.length;
        },
    };
}

// The block digits. Everything the display is made of is one region - the keys,
// a blank row, the timer, a blank row, the other timers, a blank row - so it is
// redrawn in place and the wipe can take exactly the rows it wrote.
function digitsOutput(terminal: Terminal): OutputProvider {
    const region = createRegion(terminal);

    return {
        canDraw(current, others) {
            // A display this tall cannot be drawn without a cursor that moves.
            if (!hasCursorMovement(terminal)) {
                return false;
            }
            // One reading of the size, so the gate and the arithmetic that
            // follows it cannot be answered by two different terminals.
            const size = terminalSize(terminal);
            if (size === null) {
                return false;
            }
            // The rows it draws, plus the row the cursor parks on below them: a
            // write that scrolls lands where the cursor arithmetic cannot
            // describe.
            return (
                size.columns >= digitsRequiredWidth(current.milliseconds) &&
                size.rows >= renderRegion(current, others).length + 1
            );
        },
        draw(current, others) {
            region.write(renderRegion(current, others));
        },
        clear() {
            region.wipe();
        },
    };
}

// The single line of text the app has always printed. It has no region to put
// the menu in, so the menu goes once above it and stays until another provider
// takes over the screen and reclaims the rows.
function lineOutput(terminal: Terminal): OutputProvider {
    const region = createRegion(terminal);

    return {
        // One line of text fits anywhere, so everything falls back to this.
        canDraw: () => true,
        draw(current, others) {
            // Whether the line owns a region, asked once so the gap above it and
            // the blank row under it are decided by the same answer rather than
            // by a second reading of a terminal that can change between the two.
            // Both answers are the terminal's: only a redraw that can travel
            // back to the line can own a blank row, and a one row terminal
            // cannot spare one. An unknown height is left to pad, as an unknown
            // width is left to print the menu.
            const { rows } = terminal.size();
            const display = renderLine(current, others, {
                region:
                    hasCursorMovement(terminal) &&
                    (typeof rows !== "number" || rows > 1),
                menuFits: fitsOnOneRow(terminal, hintWidth()),
                // The other timers are listed here as well as under the block
                // digits, and how many of them fit is the renderer's question
                // rather than this one: it is the only place that knows what the
                // rows of this display are. An unreported height lists them all,
                // the way an unreported width prints the menu.
                rows,
            });
            // The menu first, and only ever when the region is empty: either
            // this is the first frame or printAbove has just given back the rows
            // it printed, so the line can never be a row lower than the wipe
            // below is measured from.
            region.printAbove(display.above);
            region.write(display.rows);
        },
        clear() {
            region.clear();
        },
    };
}

// The display the app draws with, chosen on its behalf. Which providers exist
// and how they are ranked is this module's business: the app asks for a display
// and hands over a snapshot every frame, and never learns whether the one it
// asked for is the one that ends up on screen.
export type Output = {
    // Flip to the other display and hand back the one now asked for, for the app
    // to remember. A preference, not an instruction: a terminal that cannot
    // honour it still draws something, and the preference is the value the
    // settings file holds either way.
    toggle(): Display;
    // Write one frame, on whichever display this frame turns out to be drawn
    // with.
    draw(current: TimerSnapshot, others: TimerSnapshot[]): void;
};

export function createOutput(display: Display, terminal: Terminal): Output {
    // Both ways of showing the timers are built once and kept, because each one
    // remembers the rows it owns. Which is live is a question about the
    // terminal, so it is asked again every frame and can change on a resize.
    const digits = digitsOutput(terminal);
    const line = lineOutput(terminal);
    let wanted = display;
    let live: OutputProvider = line;

    return {
        toggle() {
            wanted = wanted === "digits" ? "line" : "digits";
            return wanted;
        },
        draw(current, others) {
            // Which display to use is a preference and a measurement, in that
            // order. The preference says which to try first, so the block digits
            // stay the default and pressing d pins the plain line instead; the
            // measurement gets the last word, so a preference the terminal
            // cannot honour falls back. A handover clears the rows the outgoing
            // display owned, so the incoming one never draws on top of them.
            const order = wanted === "digits" ? [digits, line] : [line, digits];
            const next =
                order.find((provider) => provider.canDraw(current, others)) ??
                line;
            if (next !== live) {
                live.clear();
                live = next;
            }
            live.draw(current, others);
        },
    };
}
