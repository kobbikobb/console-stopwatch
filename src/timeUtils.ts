function formatNumber(number: number) {
    return number.toString().padStart(2, '0');
}

export function millisecondsToPrettyDuration(totalMilliseconds: number) {
    const milliseconds = Math.floor((totalMilliseconds % 1000) / 10);
    const seconds = Math.floor(totalMilliseconds / 1000) % 60;
    const minutes = Math.floor(totalMilliseconds / 1000 / 60) % 60;
    const hours = Math.floor(totalMilliseconds / 1000 / 60 / 60);

    return `${formatNumber(hours)}:${formatNumber(minutes)}:${formatNumber(
        seconds,
    )}.${formatNumber(milliseconds)}`;
}
