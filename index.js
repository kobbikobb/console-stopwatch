const { millisecondsToPrettyDuration } = require("./timeUtils");

function replaceLine(line) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(line);
}

const start = new Date();

setInterval(() => {
  const now = new Date();
  const diff = now - start;

  replaceLine(millisecondsToPrettyDuration(diff));
}, 50);
