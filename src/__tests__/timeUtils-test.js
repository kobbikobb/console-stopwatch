const { millisecondsToPrettyDuration } = require("../timeUtils");

describe("timeUtils", () => {
  it("should format ten milliseconds", () => {
    const milliseconds = 10;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("00:00:00.01");
  });

  it("should format to almost one second", () => {
    const milliseconds = 999;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("00:00:00.99");
  });

  it("should format to one seconds", () => {
    const milliseconds = 1000;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("00:00:01.00");
  });

  it("should format to almost one minute", () => {
    const milliseconds = 60 * 1000 - 1;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("00:00:59.99");
  });

  it("should format to one minute", () => {
    const milliseconds = 60 * 1000;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("00:01:00.00");
  });

  it("should format to almost one hour", () => {
    const milliseconds = 60 * 60 * 1000 - 1;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("00:59:59.99");
  });

  it("should format to one hour", () => {
    const milliseconds = 60 * 60 * 1000;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("01:00:00.00");
  });

  it("should format to almost 1000 hours", () => {
    const milliseconds = 60 * 60 * 1000 * 1000 - 1;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("999:59:59.99");
  });

  it("should format to 1000 hours", () => {
    const milliseconds = 60 * 60 * 1000 * 1000;
    const result = millisecondsToPrettyDuration(milliseconds);
    expect(result).toBe("1000:00:00.00");
  });
});
