import {
    digitsHeight,
    digitsRequiredWidth,
    hintWidth,
    renderHint,
    renderPlainLine,
    renderRegion,
    type TimerSnapshot,
} from "./render";
import { hasDigitSupport, terminalSize } from "./terminal";

// One way of putting the timers on the screen. The app keeps one of these live,
// hands it a snapshot every frame, and swaps it for another when the terminal
// turns out to want a different one.
//
// What the display looks like lives in render, how it reaches the terminal lives
// here, and the app is left with the clock, the keys and the window title.
export type OutputProvider = {
    // Whether this provider can draw on the terminal as it is right now.
    // Measured rather than guessed, so it can be asked again after a resize,
    // which is the only reason switching between providers is possible at all.
    canDraw(current: TimerSnapshot, others: number): boolean;
    // Write one frame.
    draw(current: TimerSnapshot, others: TimerSnapshot[]): void;
    // Give back every row the display owns, including anything it left outside
    // them. The app calls this before handing over to another provider, so the
    // incoming one starts on a screen with nothing left on it.
    clear(): void;
};

// Whether the keys can be printed on one row. A hint that wraps takes a second
// row the plain line knows nothing about, and the plain line is exactly what a
// terminal too narrow for the keys gets. An unknown width is left to print them:
// there is nothing to measure against.
function keysFitOnOneRow() {
    // The width on its own, not the size: a terminal with a width and no height
    // is measured for the keys, and a width of zero is an answer that leaves no
    // room for them rather than an unknown one.
    const { columns } = process.stdout;
    if (typeof columns !== "number") {
        return true;
    }
    return columns >= hintWidth();
}

// Whether the plain line gets the blank rows above and below it that the block
// digits have. They have to be rows the display owns, so only a redraw that can
// travel back up to the line can have them: a terminal that cannot move the
// cursor keeps the single line it has always had. A terminal one row tall cannot
// either, because every extra row scrolls the screen a row per frame. An unknown
// height is left to pad, for the same reason an unknown width prints the menu:
// there is nothing to measure against.
function padsAroundLine() {
    if (!hasDigitSupport()) {
        return false;
    }
    return typeof process.stdout.rows !== "number" || process.stdout.rows > 1;
}

// The rows the last frame wrote, and the arithmetic to get back to the top of
// them. A provider owns one of these and nothing else below the app touches the
// cursor, so the rows a display owns are exactly the rows it clears.
function createRegion() {
    // How many rows below the top of the region the cursor has ended up. Every
    // region row ends with a newline, so the cursor is parked that far down and
    // the next redraw has to travel all the way back up. A line written without
    // one leaves the cursor on the row itself, so this is not the number of rows
    // the region is tall and is kept apart from it for exactly that reason.
    let cursorRows = 0;
    // How many rows the last frame wrote below the top of the region. These are
    // the rows the region owns, and the only ones a redraw may take back.
    let drawnRows = 0;
    // How many rows the display has printed above the top of the region. The
    // region cannot redraw them, so it only ever gives them back whole, and it
    // keeps the count itself rather than being told it: a count from outside is
    // a number that can go out of step with the rows on the screen.
    let rowsAbove = 0;

    function wipe() {
        process.stdout.cursorTo(0);
        if (drawnRows === 0) {
            return;
        }
        // Clearing to the end of the screen would take rows this display does not
        // own - the plain line's keys above it, for one - so the wipe clears
        // exactly the rows the last draw owned.
        //
        // Moving down and back up is only needed when the region is more than
        // one row tall, and a display that never drew more than one row never had
        // moveCursor to begin with.
        const taller = drawnRows > 1;
        if (taller) {
            process.stdout.moveCursor(0, -cursorRows);
        }
        for (let row = 0; row < drawnRows; row++) {
            // 1 erases from the cursor to the end of the row, so a row that is
            // wider than what is drawn now is left clean.
            process.stdout.clearLine(1);
            if (row < drawnRows - 1) {
                process.stdout.moveCursor(0, 1);
            }
        }
        if (taller) {
            process.stdout.moveCursor(0, -(drawnRows - 1));
        }
        drawnRows = 0;
        cursorRows = 0;
    }

    // Give back every row the display owns: the rows above the region as well as
    // the region itself, for a display that leaves rows above itself which the
    // display taking over knows nothing about. How far up that is depends on how
    // many rows were printed above the region and how far below them the cursor
    // ended up - a padded line is a region of two rows with the cursor parked
    // below it, a plain one a single row with the cursor left on it - so it is
    // arithmetic on what was written, and not a number the caller has to remember
    // to get right.
    function clear() {
        if (drawnRows === 0 && rowsAbove === 0) {
            // Nothing was printed, so there is nothing to give back. Clearing from
            // the cursor would take the rows above the display, which belong to
            // whatever printed them.
            return;
        }
        process.stdout.cursorTo(0);
        process.stdout.moveCursor(0, -(cursorRows + rowsAbove));
        process.stdout.clearScreenDown();
        drawnRows = 0;
        cursorRows = 0;
        rowsAbove = 0;
    }

    return {
        wipe,
        clear,

        // The rows a display leaves above the region: written once, at the top of
        // the display, and then left where they are because a redraw cannot reach
        // them. How many there are is a question about the terminal as it is now,
        // so a resize can answer it differently - and when it does, the rows
        // written before are a different set of rows, so they have to be given
        // back before the new ones go out. Asking for the same number again is
        // what keeps the menu from being reprinted every frame, and comparing the
        // number rather than remembering whether the menu was printed is what
        // keeps the two from ever disagreeing about what is on the screen.
        //
        // Every row ends with a newline, exactly as the region rows do, so the
        // menu and the region above which it sits are written and counted the
        // same way. console.log would reach the same file descriptor, but not
        // through the one path this file accounts for its rows on.
        printAbove(rows: string[]) {
            if (rows.length === rowsAbove) {
                return;
            }
            clear();
            for (const row of rows) {
                process.stdout.write(`${row}\n`);
            }
            rowsAbove = rows.length;
        },

        // Every row ends with a newline, so the cursor parks one row below them
        // and the next frame travels all the way back up.
        write(rows: string[]) {
            wipe();
            process.stdout.write(`${rows.join("\n")}\n`);
            drawnRows = rows.length;
            cursorRows = rows.length;
        },

        // One row and no newline, which leaves the cursor on it. This is the one
        // thing a terminal that cannot move the cursor can redraw, so it has to
        // stay possible.
        writeLine(line: string) {
            wipe();
            process.stdout.write(line);
            drawnRows = 1;
            cursorRows = 0;
        },
    };
}

// The block digits. Everything the display is made of is one region - the keys, a
// blank row, the timer, a blank row, the other timers, a blank row - so the whole
// thing is redrawn in place and the wipe can take exactly the rows it wrote.
export function digitsOutput(): OutputProvider {
    const region = createRegion();

    return {
        canDraw(current, others) {
            if (!hasDigitSupport()) {
                return false;
            }
            // One reading of the size, so the gate below and the arithmetic that
            // has to follow it cannot be answered by two different terminals.
            const size = terminalSize();
            if (size === null) {
                return false;
            }
            return (
                size.columns >= digitsRequiredWidth(current.milliseconds) &&
                size.rows >= digitsHeight(others) + 1
            );
        },
        draw(current, others) {
            region.write(renderRegion(current, others));
        },
        clear() {
            // Nothing is ever drawn above the region, so there is nothing else to
            // give back.
            region.wipe();
        },
    };
}

// The single line of text the app has always printed. It has no region to put
// the menu in, so the menu goes once above it and stays there until another
// provider takes over the screen and reclaims the rows.
export function lineOutput(): OutputProvider {
    const region = createRegion();

    // The rows the line leaves above itself. Nothing when the menu would wrap,
    // since the line would then be a row lower than the next wipe expects and
    // the display would step down a row every time it changed; otherwise the
    // menu, and the same gap under it that the block digits have, so the two
    // displays are not two different rhythms. Both are answered by the terminal
    // as it is now, and the region takes the rows it printed before back when
    // the answer changes.
    function menuRows(padded: boolean) {
        if (!keysFitOnOneRow()) {
            return [];
        }
        return padded ? [renderHint(), ""] : [renderHint()];
    }

    return {
        // One line of text fits anywhere, so this is what the app falls back to
        // when nothing else will draw.
        canDraw: () => true,
        draw(current) {
            // Asked once, so the gap above the line and the blank row under it
            // are decided by the same answer rather than by a second reading of
            // a terminal that can change between the two.
            const padded = padsAroundLine();
            // The menu first, and only ever when the region is empty: either
            // this is the first frame or printAbove has just given back the rows
            // it printed, so it can never leave the line a row lower than the
            // row the wipe below is measured from.
            region.printAbove(menuRows(padded));
            region.wipe();
            const line = renderPlainLine(current);
            if (padded) {
                // The line and the blank row under it are a region like the block
                // digits are, so the blank row is cleared along with the line.
                region.write([line, ""]);
                return;
            }
            region.writeLine(line);
        },
        clear() {
            region.clear();
        },
    };
}
