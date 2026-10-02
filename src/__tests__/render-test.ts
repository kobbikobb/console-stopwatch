import { buildDigitRows, digitsWidth, GLYPH_HEIGHT } from "../blockDigits";
import { BINDINGS } from "../keys";
import {
    digitsRequiredWidth,
    hintWidth,
    PADDING,
    renderDigits,
    renderHint,
    renderLine,
    renderListedTimer,
    renderPlainLine,
    renderRegion,
} from "../render";

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
// The two colour codes, written out. Building the expected escape out of the
// same helper the renderer calls with proves only that the two calls disagree,
// so any other pair of codes would pass; these are the codes themselves.
const RUNNING = `${ESC}[38;5;214m`;
const STOPPED = `${ESC}[38;5;244m`;
const stripAnsi = (text: string) =>
    text.split(RUNNING).join("").split(STOPPED).join("").split(RESET).join("");

describe("render", () => {
    describe("renderDigits", () => {
        it("should draw one row per glyph row", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            expect(rows).toHaveLength(GLYPH_HEIGHT);
        });

        it("should colour the glyphs, not an empty string before them", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });
            const first = rows[0];

            // The colour opens at the very start and the glyphs follow it
            // immediately. An empty coloured string would reset the colour again
            // before a single glyph was drawn, leaving the digits plain.
            expect(first.startsWith(RUNNING)).toBe(false);
            expect(first.startsWith(`${" ".repeat(PADDING)}${RUNNING}`)).toBe(
                true,
            );
            expect(first.endsWith(RESET)).toBe(true);
        });

        it("should colour a running timer orange, as the plain line does", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            expect(rows[0]).toContain(RUNNING);
        });

        it("should draw a paused timer in a different colour", () => {
            const running = renderDigits({ milliseconds: 50, isRunning: true });
            const paused = renderDigits({ milliseconds: 50, isRunning: false });

            expect(paused[0]).toContain(STOPPED);
            // Pinned to both codes, not just to "not the running one": a stopped
            // timer that went grey in a shade nobody chose still has to fail.
            expect(paused[0]).not.toContain(RUNNING);
            expect(paused[0]).not.toBe(running[0]);
        });

        it("should draw the elapsed time", () => {
            const oneMinute = renderDigits({
                milliseconds: 60 * 1000,
                isRunning: true,
            });
            const oneMinuteOne = renderDigits({
                milliseconds: 61 * 1000,
                isRunning: true,
            });

            // The block is exactly as wide as the time needs plus the padding,
            // and a different time draws a different block. The gate is wider
            // than this on purpose, to cover the hours appearing later.
            expect(stripAnsi(oneMinute[0]).length).toBe(
                PADDING + digitsWidth("01:00.00"),
            );
            expect(oneMinute).not.toEqual(oneMinuteOne);
        });

        it("should leave the hours out until there are any", () => {
            const zero = stripAnsi(
                renderDigits({ milliseconds: 0, isRunning: true })[0],
            );
            const oneHour = stripAnsi(
                renderDigits({
                    milliseconds: 60 * 60 * 1000,
                    isRunning: true,
                })[0],
            );

            // The hour brings a three wide glyph, a separator and two gaps.
            expect(zero).toHaveLength(oneHour.length - 6);
        });

        it("should inset every row by the padding", () => {
            const rows = renderDigits({ milliseconds: 50, isRunning: true });

            rows.forEach((row) => {
                expect(stripAnsi(row).startsWith(" ".repeat(PADDING))).toBe(
                    true,
                );
            });
        });
    });

    describe("renderListedTimer", () => {
        it("should mark a running timer", () => {
            const row = renderListedTimer({
                milliseconds: 50,
                isRunning: true,
            });

            expect(stripAnsi(row)).toContain("▶");
        });

        it("should mark a stopped timer", () => {
            const row = renderListedTimer({
                milliseconds: 50,
                isRunning: false,
            });

            expect(stripAnsi(row)).toContain("⏸");
        });

        it("should show the elapsed time", () => {
            const row = renderListedTimer({
                milliseconds: 12340,
                isRunning: true,
            });

            expect(stripAnsi(row)).toContain("00:12.34");
        });

        it("should line up with the digits", () => {
            const row = renderListedTimer({ milliseconds: 0, isRunning: true });
            const digits = renderDigits({ milliseconds: 0, isRunning: true });

            // Both start at the padding, so the listed timers sit under the
            // left edge of the block rather than against the terminal.
            expect(stripAnsi(row).startsWith(" ".repeat(PADDING))).toBe(true);
            expect(stripAnsi(digits[0]).startsWith(" ".repeat(PADDING))).toBe(
                true,
            );
        });
    });

    describe("renderHint", () => {
        it("should be indented like the rest of the display", () => {
            expect(stripAnsi(renderHint())).toMatch(/^ {2}\S/);
        });

        it("should be the dim colour of the listed timers", () => {
            expect(renderHint()).toContain(STOPPED);
        });

        it("should name every key", () => {
            const hint = stripAnsi(renderHint());

            // The label for the space key is the one the table gives it, not the
            // one it used to have: the key pauses a running timer and starts a
            // paused one, so a menu that said "pause" described half of it.
            ["r reset", "n new", "d display", "␣ toggle", "esc quit"].forEach(
                (key) => {
                    expect(hint).toContain(key);
                },
            );
        });
    });

    describe("digitsRequiredWidth", () => {
        it("should cover the width the digits draw at zero", () => {
            // The gate is a max over the widths of the rows the display draws,
            // so comparing it to a drawn row proves nothing: the row it is
            // compared to is one of the things the max is made of. What is worth
            // pinning here is the drawn width itself, which the gate is not built
            // out of.
            //
            // Eight characters of mm:ss.cc, five glyphs of three columns and two
            // of one, with a column between each pair, then the padding.
            const drawn = stripAnsi(
                renderDigits({ milliseconds: 0, isRunning: true })[0],
            );

            expect(drawn).toBe(
                " ".repeat(PADDING) + buildDigitRows("00:00.00")[0],
            );
            expect(drawn).toHaveLength(PADDING + 27);
        });

        it("should cover the hours appearing an hour in", () => {
            const under = digitsRequiredWidth(59 * 60 * 1000);
            const over = digitsRequiredWidth(60 * 60 * 1000);

            // The digits grow by six columns when the first hour appears (a three
            // wide digit, a separator, and the two gaps either side), and the gate
            // has to already allow for it or the display would drop to the plain
            // line at that point. Both sides are the same gate call, so this fails
            // if the gate starts growing with the hours.
            expect(over).toBe(under);
        });

        it("should be set by the menu, which is now the widest row", () => {
            // The menu grew wider than the timer when it started naming the key
            // that switches display, and the gate follows the widest row, so a
            // terminal that fits the menu fits the timer too.
            //
            // This is the cross check that works: it compares the gate against
            // the width of the menu, which the gate is not built out of, so it
            // fails if either side moves past the other. Comparing the gate
            // against the rows it is drawn from cannot fail, because the gate is
            // a max of those very widths.
            expect(digitsRequiredWidth(0)).toBe(hintWidth());
        });

        it("should still cover three digit hours", () => {
            // The menu is wider than three digit hours, so the gate does not grow
            // for them. Pinned as an explicit figure: the gate is 51 columns, and
            // 100 hours of digits draw 43, so there is real headroom rather than
            // a comparison that would hold whatever the two numbers were.
            const milliseconds = 100 * 60 * 60 * 1000;
            const drawn = stripAnsi(
                renderDigits({ milliseconds, isRunning: true })[0],
            );

            expect(drawn).toHaveLength(43);
            expect(digitsRequiredWidth(milliseconds)).toBe(51);
        });
    });

    describe("the menu", () => {
        it("should be the whole row, written out", () => {
            // The row as a user reads it, in the order they read it, written here
            // rather than taken from the table: an expectation built out of the
            // thing under test cannot fail when that thing is wrong. A change to
            // any label is a change to this line, on purpose.
            expect(stripAnsi(renderHint())).toBe(
                "  r reset · n new · d display · ␣ toggle · esc quit",
            );
        });

        it("should be the entries the key table marks, and nothing else", () => {
            // Which bindings the menu names and which it deliberately leaves out.
            // Both sides are pinned by action rather than by text, so a key added
            // to the table has to be put on one side of this or the test fails:
            // a key that is bound and invisible is a decision nobody made, and
            // this is what stops it being the silent default.
            const actions = (inMenu: boolean) =>
                BINDINGS.filter((binding) => binding.inMenu === inMenu).map(
                    (binding) => binding.action,
                );

            expect(actions(true)).toEqual([
                "reset",
                "newTimer",
                "toggleDisplay",
                "toggle",
                "quit",
            ]);
            // The two that work, are in the README, and are not in the menu. They
            // are the price of the gate: naming them is twenty-two more columns.
            expect(actions(false)).toEqual(["moveUp", "moveDown"]);
        });

        it("should name every key the menu marks, in the table's order", () => {
            // The row is made of the entries, one "key verb" each, joined by the
            // separator. Checked against the table rather than a literal so that
            // the claim being made is that the menu is generated rather than
            // restated, which is the whole reason the table exists.
            const marked = BINDINGS.filter((binding) => binding.inMenu);

            marked.forEach((binding) => {
                expect(stripAnsi(renderHint())).toContain(
                    `${binding.shownAs ?? binding.keys[0].name} ${
                        binding.label
                    }`,
                );
            });
            // And in that order, so an entry that moved in the table moved on the
            // screen with it.
            expect(
                stripAnsi(renderHint())
                    .split(" · ")
                    .map((entry) => entry.trim()),
            ).toEqual(
                marked.map(
                    (binding) =>
                        `${binding.shownAs ?? binding.keys[0].name} ${
                            binding.label
                        }`,
                ),
            );
        });

        it("should pin the gate to the number of columns the menu takes", () => {
            // Forty-nine characters of menu and two of indent. This is the number
            // that decides which terminals get the block digits at all, so a
            // wording change that moved it has to be made here on purpose rather
            // than discovered later as a terminal that lost its digits.
            expect(stripAnsi(renderHint())).toHaveLength(51);
            // The width the display asks for and the width of the row it prints,
            // which the gate is not built out of, so this fails if either moves
            // on its own.
            expect(hintWidth()).toBe(51);
            expect(digitsRequiredWidth(0)).toBe(51);
        });
    });

    describe("renderRegion", () => {
        const current = { milliseconds: 5000, isRunning: true };
        const digits = renderDigits(current);

        it("should be the menu, two gaps, the glyph height and the blank row", () => {
            // The height of the display is the length of the rows it renders and
            // nothing else. It used to be a formula of its own, which meant the
            // rows and the number they claimed to be were two things that had to
            // agree; asking the rows is how they cannot disagree.
            expect(renderRegion(current, []).length).toBe(GLYPH_HEIGHT + 4);
        });

        it("should add a row per other timer", () => {
            expect(
                renderRegion(current, [
                    { milliseconds: 1000, isRunning: true },
                    { milliseconds: 2000, isRunning: false },
                ]).length,
            ).toBe(GLYPH_HEIGHT + 4 + 2);
        });

        it("should be the menu, a gap, the timer, a gap and a blank row", () => {
            const rows = renderRegion(current, []);

            expect(rows).toHaveLength(GLYPH_HEIGHT + 4);
            expect(stripAnsi(rows[0])).toContain("esc quit");
            expect(rows[1]).toBe("");
            // The five digit rows come next, with nothing else between them.
            for (let row = 0; row < GLYPH_HEIGHT; row++) {
                expect(rows[2 + row]).toBe(digits[row]);
            }
            // The gap under the timer, and the blank row under the display.
            expect(rows[GLYPH_HEIGHT + 2]).toBe("");
            expect(rows[GLYPH_HEIGHT + 3]).toBe("");
        });

        it("should keep the gap under the timer when others are listed", () => {
            const rows = renderRegion(current, [
                { milliseconds: 1000, isRunning: true },
                { milliseconds: 2000, isRunning: false },
            ]);

            expect(rows).toHaveLength(GLYPH_HEIGHT + 6);
            expect(stripAnsi(rows[0])).toContain("esc quit");
            expect(rows[1]).toBe("");
            // The gap stays directly under the timer, so asking for a new one
            // does not take the padding away. It used to sit above the keys,
            // where a listed timer took its place instead.
            expect(rows[GLYPH_HEIGHT + 2]).toBe("");
            expect(stripAnsi(rows[GLYPH_HEIGHT + 3])).toContain("00:01.00");
            expect(stripAnsi(rows[GLYPH_HEIGHT + 4])).toContain("00:02.00");
            expect(rows[GLYPH_HEIGHT + 5]).toBe("");
        });
    });

    describe("renderLine", () => {
        const current = { milliseconds: 5000, isRunning: true };
        const line = renderPlainLine(current);

        it("should be the line on its own, with the keys above it", () => {
            const { above, rows } = renderLine(current, [], {
                region: false,
                menuFits: true,
            });

            // One row, which is the whole point of the unpadded form: whether a
            // row gets a newline after it is a question about the bytes and lives
            // with the writer, and it can only hold if a display that owns a
            // region is never a single row. A newline here would park the cursor
            // on the row below and scroll the screen a row per frame.
            expect(rows).toEqual([line]);
            expect(above).toEqual([renderHint()]);
        });

        it("should be the line and a blank row when it is a region", () => {
            const { above, rows } = renderLine(current, [], {
                region: true,
                menuFits: true,
            });

            // The two displays are the same rhythm at two scales: the keys, a gap,
            // the timer, a blank row under it. The blank row under the display is
            // the one the block digits end with, and the gap under the keys is the
            // one they put under their menu - so both are compared to the digits'
            // own rows rather than to a literal, and a gap that moved in one of
            // the two renderers fails here.
            const digits = renderRegion(current, []);
            expect(rows).toEqual([line, ""]);
            expect(rows[rows.length - 1]).toBe(digits[digits.length - 1]);
            expect(above).toEqual(digits.slice(0, 2));
            expect(above[1]).toBe("");
        });

        it("should leave nothing above the line when the menu would wrap", () => {
            // Both ways of drawing, because the menu is a row the region counts
            // when it is printed above the line and not counted at all when it
            // is inside it. Either way the line keeps its two rows and only the
            // rows above it are dropped, so a menu that does not fit can never
            // change what the display itself takes up.
            expect(
                renderLine(current, [], {
                    region: true,
                    menuFits: false,
                }).rows,
            ).toHaveLength(2);
            expect(
                renderLine(current, [], { region: true, menuFits: false })
                    .above,
            ).toEqual([]);
            expect(
                renderLine(current, [], {
                    region: false,
                    menuFits: false,
                }).above,
            ).toEqual([]);
        });

        it("should list the other timers, as the block digits do", () => {
            // The bug this pins: the digits listed the other timers and the plain
            // line could not, because it was never handed any, so switching to it
            // with d made every timer but the current one disappear. The line and
            // the digits are two ways of showing the same timers, so the same
            // timers have to be on the screen either way.
            const others = [
                { milliseconds: 1000, isRunning: true },
                { milliseconds: 2000, isRunning: false },
            ];
            const { rows } = renderLine(current, others, {
                region: true,
                menuFits: true,
                rows: 40,
            });

            // The rhythm the block digits have at their scale: the timer, the gap
            // under it, a row per listed timer, and the blank row the display ends
            // with. The listed rows and the row they end with are the digits' own,
            // so a change to one display's layout that the other does not follow
            // fails here rather than on a screen.
            const digits = renderRegion(current, others);
            expect(rows).toHaveLength(5);
            expect(rows[0]).toBe(line);
            expect(rows[1]).toBe("");
            expect(rows[2]).toBe(digits[digits.length - 3]);
            expect(rows[3]).toBe(digits[digits.length - 2]);
            expect(rows[4]).toBe(digits[digits.length - 1]);
            expect(stripAnsi(rows[2])).toContain("▶ 00:01.00");
            expect(stripAnsi(rows[3])).toContain("⏸ 00:02.00");
        });

        it("should keep the gap under the line when others are listed", () => {
            // The padding the digits keep directly under the timer is kept here
            // for the same reason: asking for a new timer must not take it away.
            const { rows } = renderLine(
                current,
                [{ milliseconds: 1000, isRunning: true }],
                { region: true, menuFits: true, rows: 40 },
            );

            expect(rows[1]).toBe("");
            expect(stripAnsi(rows[2])).toContain("00:01.00");
        });

        it("should list only as many others as there are rows for", () => {
            // A listed timer is a row of the display, so listing more of them than
            // the terminal has rows for scrolls it a row every frame. The plain
            // line is what a terminal too short for the block digits gets, so it
            // is exactly here that the fitting matters.
            const others = [
                { milliseconds: 1000, isRunning: true },
                { milliseconds: 2000, isRunning: true },
                { milliseconds: 3000, isRunning: true },
            ];
            // The menu, the gap, the line, the blank row and the row the cursor
            // parks on are six rows whatever is listed, so seven rows is room for
            // one listed timer and two more.
            const { rows } = renderLine(current, others, {
                region: true,
                menuFits: true,
                rows: 7,
            });

            expect(stripAnsi(rows.join("\n"))).toContain("00:01.00");
            expect(stripAnsi(rows.join("\n"))).not.toContain("00:02.00");
            expect(rows).toHaveLength(4);
        });

        it("should list none when the terminal has no rows to spare", () => {
            const others = [{ milliseconds: 1000, isRunning: true }];
            const { rows } = renderLine(current, others, {
                region: true,
                menuFits: true,
                rows: 4,
            });

            expect(rows).toEqual([line, ""]);
        });

        it("should list them all when the height is unknown", () => {
            // An unreported height is left to list them all, the way an unreported
            // width is left to print the menu: guessing a number of rows for a
            // terminal that has not reported one is how a display ends up drawn in
            // the wrong place.
            const others = [
                { milliseconds: 1000, isRunning: true },
                { milliseconds: 2000, isRunning: true },
            ];
            const { rows } = renderLine(current, others, {
                region: true,
                menuFits: true,
            });

            expect(rows).toHaveLength(5);
        });

        it("should list none when the line is not a region", () => {
            // A display that is not a region is one row the cursor is left on, and
            // a redraw can reach no other. A second row of listed timers would take
            // a row a wipe cannot come back to.
            const others = [{ milliseconds: 1000, isRunning: true }];
            const { rows } = renderLine(current, others, {
                region: false,
                menuFits: true,
                rows: 40,
            });

            expect(rows).toEqual([line]);
        });

        it("should give the room the menu took back to the listed timers", () => {
            // The rows above the line are rows of the display too, so a menu that
            // is not printed leaves a listed timer room that would otherwise go
            // unused.
            const others = [
                { milliseconds: 1000, isRunning: true },
                { milliseconds: 2000, isRunning: true },
            ];
            const { rows } = renderLine(current, others, {
                region: true,
                menuFits: false,
                rows: 6,
            });

            expect(rows).toHaveLength(5);
        });
    });

    describe("renderPlainLine", () => {
        it("should be the same output as before this change", () => {
            expect(renderPlainLine({ milliseconds: 50, isRunning: true })).toBe(
                "  \x1b[38;5;214m00:00.05\x1b[0m",
            );
        });

        it("should be inset like every other row of the display", () => {
            // The bug this pins: the line was the one row of the display with no
            // padding, so it sat against the left edge of the terminal while the
            // listed timers underneath it were stepped in - two displays rather
            // than one, on the display that is the fallback for a terminal too
            // small for the digits. The padding is asked of the renderer rather
            // than written out, so a change to it moves all four rows at once.
            const line = renderPlainLine({ milliseconds: 50, isRunning: true });
            expect(stripAnsi(line).startsWith(" ".repeat(PADDING))).toBe(true);
            expect(stripAnsi(line).length).toBe(PADDING + "00:00.05".length);
        });

        it("should line up with the listed timers under it", () => {
            // The whole point of the padding: two rows of one display start in the
            // same column. Compared to the listed timers rather than to a column
            // number, so a padding that moved for one row and not the other fails
            // here.
            const rows = renderLine(
                { milliseconds: 5000, isRunning: true },
                [{ milliseconds: 1000, isRunning: false }],
                { region: true, menuFits: true, rows: 40 },
            );

            expect(stripAnsi(rows.rows[0]).search(/\S/)).toBe(PADDING);
            expect(stripAnsi(rows.rows[2]).search(/\S/)).toBe(PADDING);
        });

        it("should grey a stopped timer, as the block digits do", () => {
            // It used to be the running colour whatever the state, so the same
            // stopped timer was orange on the line and grey in the digits. The
            // codes are written out rather than asked of the renderer, so this
            // pins 244 and not merely "some other colour than 214".
            expect(
                renderPlainLine({ milliseconds: 50, isRunning: false }),
            ).not.toBe(renderPlainLine({ milliseconds: 50, isRunning: true }));
            expect(
                renderPlainLine({ milliseconds: 50, isRunning: false }),
            ).toBe("  \x1b[38;5;244m00:00.05\x1b[0m");
        });
    });
});
