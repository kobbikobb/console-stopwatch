const { millisecondsToPrettyDuration } = require("../timeUtils");

describe("timeUtils", () => {
  it("should format to one seconds", () => {
    const milliseconds = 1000;

    const result = millisecondsToPrettyDuration(milliseconds);

    expect(result).toBe("00:00:01.00");
  });

  it("should format to one minute", () => {
    const milliseconds = 60 * 1000;

    const result = millisecondsToPrettyDuration(milliseconds);

    expect(result).toBe("00:01:00.00");
  });
});
