import readline from "readline";
import { Timers } from "./Timers";
import { millisecondsToPrettyDuration } from "./timeUtils";

export function run() {
    console.log("Press r to reset current timer.");
    console.log("Press n to create a new timer.");
    console.log("Press any other key to pause current timer.");
    console.log("Press ctrl+c to exit.");
    console.log();

    const timers = new Timers();
    timers.startCurrentTimer();

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    function replaceLine(line: string) {
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`\x1b[31m${line}\x1b[0m`);
    }

    setInterval(() => {
        const timer = timers.getCurrentTimer();
        if (timer) {
            replaceLine(millisecondsToPrettyDuration(timer.getMilliseconds()));
        }
    }, 50);

    process.stdin.on("keypress", (str, key) => {
        if (key.ctrl && key.name === "c") {
            process.exit();
        } else if (key.name === "r") {
            timers.resetCurrentTimer();
        } else if (key.name === "n") {
            timers.addTimerAfterCurrent();
            timers.startCurrentTimer();
        } else {
            timers.toggleCurrentTimer();
        }
    });
}
