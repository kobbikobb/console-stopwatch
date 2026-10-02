// Every key the stopwatch answers to, and which of them the menu names: one list,
// read by the handler that acts on a keypress and by the renderer that prints the
// menu, so the two cannot drift apart. Data and nothing else, so it imports
// neither of them.

export type KeyAction =
    | "reset"
    | "newTimer"
    | "toggleDisplay"
    | "toggle"
    | "quit"
    | "moveUp"
    | "moveDown";

// Written out rather than imported from readline, whose Key reports a keypress
// with no name at all: the names are data, and this need not know which library
// hands them over.
export type PressedKey = {
    name?: string;
    ctrl?: boolean;
};

// A modifier is asked for and never forbidden, so ctrl+r answers to a plain r too,
// which is what the handler has always done with the letter keys.
type Stroke = {
    name: string;
    ctrl?: boolean;
};

export type KeyBinding = {
    // More than one key is one thing to do rather than a mistake: esc and ctrl+c
    // both quit, and a user only has to find one of them.
    keys: Stroke[];
    // What the menu prints in place of readline's name for the key. Without it
    // the menu prints the first key as it is.
    shownAs?: string;
    label: string;
    action: KeyAction;
    // The menu is a deliberate subset, and it is also the width gate: every entry
    // it names costs its columns in every terminal in the world. This is the one
    // place that says which half is which.
    inMenu: boolean;
};

export const BINDINGS: KeyBinding[] = [
    {
        keys: [{ name: "r" }],
        label: "reset",
        action: "reset",
        inMenu: true,
    },
    {
        keys: [{ name: "n" }],
        label: "new",
        action: "newTimer",
        inMenu: true,
    },
    {
        keys: [{ name: "d" }],
        label: "display",
        action: "toggleDisplay",
        inMenu: true,
    },
    {
        // The key pauses a running timer and resumes a paused one, so the menu
        // names the whole of it rather than half of it.
        keys: [{ name: "space" }],
        shownAs: "\u2423",
        label: "toggle",
        action: "toggle",
        inMenu: true,
    },
    {
        // The menu names esc, the shorter of the two to print.
        keys: [{ name: "escape" }, { name: "c", ctrl: true }],
        shownAs: "esc",
        label: "quit",
        action: "quit",
        inMenu: true,
    },
    // The two the menu leaves out, a decision and not an oversight: the arrows
    // work and the README says so, but naming them costs the gate more columns
    // than the block digits are worth.
    {
        keys: [{ name: "up" }],
        shownAs: "\u2191",
        label: "switch",
        action: "moveUp",
        inMenu: false,
    },
    {
        keys: [{ name: "down" }],
        shownAs: "\u2193",
        label: "switch",
        action: "moveDown",
        inMenu: false,
    },
];

// Between two entries, with a space either side because a bare middot runs the
// words together at this size.
const SEPARATOR = " \u00b7 ";

export function menuText() {
    return BINDINGS.filter((binding) => binding.inMenu)
        .map(
            (binding) =>
                `${binding.shownAs ?? binding.keys[0].name} ${binding.label}`,
        )
        .join(SEPARATOR);
}

function matches(press: PressedKey, key: Stroke) {
    return (
        press.name === key.name && (key.ctrl !== true || press.ctrl === true)
    );
}

export function findBinding(press: PressedKey) {
    return BINDINGS.find((binding) =>
        binding.keys.some((key) => matches(press, key)),
    );
}
