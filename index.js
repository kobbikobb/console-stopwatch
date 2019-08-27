#!/usr/bin/env node

const readline = require("readline");
const Timers = require("./src/Timers");
const { millisecondsToPrettyDuration } = require("./src/timeUtils");

console.log("Press r to reset current timer.");
console.log("Press n to create a new timer.");
console.log("Press any other key to pause current timer.");
console.log("Press ctrl+c to exit.");
console.log();

const timers = new Timers();
timers.startCurrentTimer();

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

function replaceLine(line) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(line);
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
    // } else if (key.name === "up") {
    //   timers.moveUp();
    // } else if (key.name === "down") {
    //   timers.moveDown();
  } else {
    timers.toggleCurrentTimer();
  }
});
