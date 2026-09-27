import {
    millisecondsToClock,
    millisecondsToPrettyDuration,
} from "../timeUtils";

describe("timeUtils", () => {
    it("should format ten milliseconds", () => {
        const milliseconds = 10;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("00:00.01");
    });

    it("should format to almost one second", () => {
        const milliseconds = 999;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("00:00.99");
    });

    it("should format to one seconds", () => {
        const milliseconds = 1000;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("00:01.00");
    });

    it("should format to almost one minute", () => {
        const milliseconds = 60 * 1000 - 1;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("00:59.99");
    });

    it("should format to one minute", () => {
        const milliseconds = 60 * 1000;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("01:00.00");
    });

    it("should format to almost one hour", () => {
        const milliseconds = 60 * 60 * 1000 - 1;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("59:59.99");
    });

    it("should leave the hours out until there are any", () => {
        const milliseconds = 60 * 60 * 1000;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("1:00:00.00");
    });

    it("should not pad the hours", () => {
        const milliseconds = 60 * 60 * 1000 * 11;
        const result = millisecondsToPrettyDuration(milliseconds);
        expect(result).toBe("11:00:00.00");
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

describe("millisecondsToClock", () => {
    it("should drop the hundredths", () => {
        expect(millisecondsToClock(10)).toBe("00:00");
    });

    it("should keep the minutes and seconds", () => {
        expect(millisecondsToClock(60 * 1000 + 500)).toBe("01:00");
    });

    it("should keep the hours once there are any", () => {
        expect(millisecondsToClock(60 * 60 * 1000 + 61 * 1000 + 500)).toBe(
            "1:01:01",
        );
    });

    it("should keep three digits of hours", () => {
        expect(millisecondsToClock(100 * 60 * 60 * 1000)).toBe("100:00:00");
    });
});
