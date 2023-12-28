import { run } from "../app";

describe("app run", () => {
  const consoleSpy = jest.spyOn(console, "log").mockImplementation();
  const exitSpy = jest.spyOn(process, "exit").mockImplementation();
  const setRawMode = jest.fn();
  const clearLine = jest.fn();
  const cursorTo = jest.fn();
  const write = jest.fn();
  const exit = jest.fn();

  process.stdin.setRawMode = setRawMode;
  process.stdout.clearLine = clearLine;
  process.stdout.cursorTo = cursorTo;
  process.stdout.write = write;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    setRawMode.mockReset();
    clearLine.mockReset();
    cursorTo.mockReset();
    write.mockReset();
    exit.mockReset();
  });

  afterAll(() => {
    process.stdin.pause();
    process.stdin.removeAllListeners();
  });

  const expectWriteToContainTime = (time: string) => {
    expect(write).toHaveBeenCalledWith(expect.stringContaining(time));
  };

  const expectWriteToContainLastTime = (time: string) => {
    expect(write).toHaveBeenLastCalledWith(expect.stringContaining(time));
  };

  it("should write a menu", () => {
    run();

    expect(consoleSpy).toHaveBeenCalledWith("Press r to reset current timer.");
    expect(consoleSpy).toHaveBeenCalledWith("Press n to create a new timer.");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Press any other key to pause current timer.",
    );
    expect(consoleSpy).toHaveBeenCalledWith("Press ctrl+c to exit.");
  });

  it("should write elpased time", () => {
    run();
    jest.advanceTimersByTime(50);

    expectWriteToContainTime("00:00:00.05");
  });

  it("should write elpased time with color", () => {
    run();
    jest.advanceTimersByTime(50);

    expect(write).toHaveBeenCalledWith("\x1b[32m00:00:00.05\x1b[0m");
  });

  it("should write elpased time twice", () => {
    run();
    jest.advanceTimersByTime(50);
    jest.advanceTimersByTime(50);

    expectWriteToContainTime("00:00:00.05");
    expectWriteToContainTime("00:00:00.10");
  });

  it("should reset timer", () => {
    run();
    jest.advanceTimersByTime(100);

    process.stdin.emit("data", Buffer.from("r"));
    jest.advanceTimersByTime(50);

    expectWriteToContainLastTime("00:00:00.05");
  });

  it("should create new timer", () => {
    run();
    jest.advanceTimersByTime(100);

    process.stdin.emit("data", Buffer.from("n"));
    jest.advanceTimersByTime(50);

    expectWriteToContainLastTime("00:00:00.05");
  });

  it("should pause timer", () => {
    run();
    process.stdin.emit("data", Buffer.from("x"));
    jest.advanceTimersByTime(100);

    expectWriteToContainLastTime("00:00:00.00");
  });

  it("should close the application", () => {
    run();
    process.stdin.emit("data", Buffer.from("\x03"));

    expect(exitSpy).toHaveBeenCalled();
  });
});
