function formatNumber(number) {
  return number.toString().padStart(2, "0");
}

export function millisecondsToPrettyDuration(totalMilliseconds) {
  const milliseconds = parseInt((totalMilliseconds % 1000) / 10);
  const seconds = parseInt(totalMilliseconds / 1000) % 60;
  const minutes = parseInt(totalMilliseconds / 1000 / 60) % 60;
  const hours = parseInt(totalMilliseconds / 1000 / 60 / 60);

  return `${formatNumber(hours)}:${formatNumber(minutes)}:${formatNumber(
    seconds
  )}.${formatNumber(milliseconds)}`;
}
