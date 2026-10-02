function formatNumber(number: number) {
    return number.toString().padStart(2, "0");
}

export function millisecondsToPrettyDuration(totalMilliseconds: number) {
    const centiseconds = formatNumber(
        Math.floor((totalMilliseconds % 1000) / 10),
    );
    const seconds = formatNumber(Math.floor(totalMilliseconds / 1000) % 60);
    const minutes = formatNumber(
        Math.floor(totalMilliseconds / 1000 / 60) % 60,
    );
    const hours = Math.floor(totalMilliseconds / 1000 / 60 / 60);

    // Hours are only spent once there are any, which keeps a fresh stopwatch
    // eight characters wide instead of eleven.
    const time = `${minutes}:${seconds}.${centiseconds}`;
    return hours > 0 ? `${hours}:${time}` : time;
}

// The same time without the hundredths, which is all a window title has room
// for.
export function millisecondsToClock(totalMilliseconds: number) {
    return millisecondsToPrettyDuration(totalMilliseconds).split(".")[0];
}
