import fs from "fs";
import os from "os";
import path from "path";

// Which display the user last asked for. Two states and no more: the block
// digits when the terminal is big enough for them, or the single line. The
// choice is the same either way, so it is one small value rather than a
// settings file full of things.
export type Display = "advanced" | "standard";

// The display to use when nothing has been chosen yet, which is also what an
// unreadable or unrecognised file falls back to. This is the display the app has
// always picked for itself, so a first run looks like the last one.
export const DEFAULT_DISPLAY: Display = "advanced";

const DIRECTORY = "console-stopwatch";
const FILE = "settings.json";

// XDG_CONFIG_HOME when it is set, ~/.config otherwise, which is the same on
// Linux and on macOS. Not the directory the module is installed in: npm owns
// that, prunes it on upgrade, and on a system wide install it belongs to root.
function settingsFile() {
    const base =
        process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME !== ""
            ? process.env.XDG_CONFIG_HOME
            : path.join(os.homedir(), ".config");
    return path.join(base, DIRECTORY, FILE);
}

// Is this one of the two displays, checked as a value rather than asserted as a
// property: the key is read by name, but nothing here claims the name is right,
// so a misspelling arrives as undefined and falls through to the default.
function isDisplay(value: unknown): value is Display {
    return value === "advanced" || value === "standard";
}

// The remembered display, or null when there is nothing remembered yet. Never
// throws: a missing file is the normal case, and a file someone has edited by
// hand, or a home directory that cannot be read, is not worth failing a
// stopwatch over. Anything unrecognised reads as nothing remembered, so the
// default applies rather than a display that is not one of the two.
export function readDisplay(): Display | null {
    let saved: unknown;
    try {
        saved = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    } catch {
        return null;
    }
    if (typeof saved !== "object" || saved === null) {
        return null;
    }
    const display = (saved as Record<string, unknown>).display;
    return isDisplay(display) ? display : null;
}

// Remember the display, so it survives the next run. Also never throws, for the
// same reason: a read only home directory should cost the choice, not the
// stopwatch. Nothing is written until the user actually presses the key, so a
// run that never changes anything never creates the file.
export function writeDisplay(display: Display) {
    try {
        fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
        fs.writeFileSync(
            settingsFile(),
            `${JSON.stringify({ display }, null, 2)}\n`,
        );
    } catch {
        // Nothing. The display is still switched for this run; only the
        // remembering is lost, and there is nowhere to complain to that would not
        // land in the middle of the redraw.
    }
}
