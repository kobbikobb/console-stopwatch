import {
    digitsHeight,
    digitsRequiredWidth,
    hintWidth,
    renderHint,
    renderPlainLine,
    renderRegion,
    type TimerSnapshot,
} from "./render";
import { hasDigitSupport, hasKnownSize } from "./terminal";

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
    return (
        typeof process.stdout.columns !== "number" ||
        (process.stdout.columns as number) >= hintWidth()
    );
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
    // the next redraw has to travel all the way back up.
    let drawnRows = 0;

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
            process.stdout.moveCursor(0, -drawnRows);
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
    }

    return {
        wipe,

        // Every row ends with a newline, so the cursor parks one row below them
        // and the next frame travels all the way back up.
        write(rows: string[]) {
            wipe();
            process.stdout.write(`${rows.join("\n")}\n`);
            drawnRows = rows.length;
        },

        // One row and no newline, which leaves the cursor on it. This is the one
        // thing a terminal that cannot move the cursor can redraw, so it has to
        // stay possible.
        writeLine(line: string) {
            wipe();
            process.stdout.write(line);
            drawnRows = 1;
        },

        // Clear the region and the rows above it, and start from there. For a
        // display that leaves rows above itself which the display taking over
        // knows nothing about. How far up that is depends on how many rows the
        // last frame drew and how many the display left above them, so it cannot
        // be a fixed offset: a padded line has the blank row above and below it
        // as well, and stopping on the blank one would leave the menu and the
        // line behind.
        clearIncludingRowAbove(rowsAbove: number) {
            process.stdout.cursorTo(0);
            process.stdout.moveCursor(0, -(drawnRows + rowsAbove));
            process.stdout.clearScreenDown();
            drawnRows = 0;
        },
    };
}

// The block digits. Everything the display is made of is one region - the keys, a
// blank row, the timer, a blank row, the other timers, a blank row - so the whole
// thing is redrawn in place and the wipe can take exactly the rows it wrote.
export function advancedOutput(): OutputProvider {
    const region = createRegion();

    return {
        canDraw(current, others) {
            if (!hasDigitSupport() || !hasKnownSize()) {
                return false;
            }
            const { columns, rows } = process.stdout;
            return (
                (columns as number) >=
                    digitsRequiredWidth(current.milliseconds) &&
                (rows as number) >= digitsHeight(others) + 1
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
export function standardOutput(): OutputProvider {
    const region = createRegion();
    let rowsPrintedAbove = 0;

    function printMenuAbove() {
        if (rowsPrintedAbove > 0 || !keysFitOnOneRow()) {
            return;
        }
        console.log(renderHint());
        rowsPrintedAbove = 1;
        if (padsAroundLine()) {
            // The same gap under the menu the block digits have, so the two
            // displays are not two different rhythms.
            console.log("");
            rowsPrintedAbove = 2;
        }
    }

    return {
        // One line of text fits anywhere, so this is what the app falls back to
        // when nothing else will draw.
        canDraw: () => true,
        draw(current) {
            // The wipe comes first, then the menu. The menu is rows the line does
            // not own, so printing them before the wipe would leave the line a row
            // lower than the row the next wipe is measured from, and the display
            // would step down one row every time it changed.
            region.wipe();
            printMenuAbove();
            const line = renderPlainLine(current);
            if (padsAroundLine()) {
                // The line and the blank row under it are a region like the block
                // digits are, so the blank row is cleared along with the line.
                region.write([line, ""]);
                return;
            }
            region.writeLine(line);
        },
        clear() {
            if (rowsPrintedAbove === 0) {
                region.wipe();
                return;
            }
            region.clearIncludingRowAbove(rowsPrintedAbove);
            rowsPrintedAbove = 0;
        },
    };
}
