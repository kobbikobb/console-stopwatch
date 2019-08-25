const readline = require("readline");
const Timer = require("./Timer");
const { millisecondsToPrettyDuration } = require("./timeUtils");

console.log("Press r to reset current timer.");
console.log("Press n to create a new timer.");
console.log("Press any other key to pause current timer.");
console.log("Press ctrl+c to exit.");
console.log();

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
    } else if (key.name === "n") {
      const wasRunnig = timer.isRunning();
      timer.stop();
      console.log();
      timer.reset();
      if (wasRunnig) {
        timer.start();
      }
    } else {
      timer.toggle();
    }
  }
});
