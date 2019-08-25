function replaceLine(line) {
  process.stdout.clearLine();
  process.stdout.cursorTo(0);
  process.stdout.write(line);
}

const start = new Date();

setInterval(() => {
  const now = new Date();
  const diff = now - start;

  const seconds = diff / 1000;
  const milliseconds = (diff % 1000) / 10;

  replaceLine(
    `${parseInt(seconds)
      .toString()
      .padStart(2, "0")}:${parseInt(milliseconds)
      .toString()
      .padStart(2, "0")}`
  );
}, 50);
