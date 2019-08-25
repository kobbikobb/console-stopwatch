const readline = require("readline");
const Timer = require("./Timer");
const { millisecondsToPrettyDuration } = require("./timeUtils");

console.log("(Press r to reset, press any other key to stop)");

const timer = new Timer();
timer.start();

readline.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

function replaceLine(line) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(line);
}

setInterval(() => {
  replaceLine(millisecondsToPrettyDuration(timer.getMilliseconds()));
}, 50);

process.stdin.on("keypress", (str, key) => {
  if (key.ctrl && key.name === "c") {
    process.exit();
  } else {
    if (key.name === "r") {
      timer.reset();
    } else {
      timer.toggle();
    }
  }
});
