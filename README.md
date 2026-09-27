[![Build Status](https://github.com/kobbikobb/console-stopwatch/actions/workflows/on_push.yaml/badge.svg)](https://github.com/kobbikobb/console-stopwatch/actions)

# console-stopwatch

Simple stopwatch for the console. Simple and quick 🚀

## Install & run in console

-   Install globally with `npm i console-stopwatch --global`
-   Run `stopwatch` in console.

## Instructions

-   Press `r` to reset current timer ✨
-   Press `n` to create a new timer ✨
-   Press `up` or `down` to switch between timers ✨
-   Press `any` other key to pause current timer ✨
-   Press `ctrl+c` or `escape` to exit ✨

## The display

The current timer is drawn in large block digits inside a frame, with the
elapsed time also mirrored in the terminal window title. A shimmer sweeps
across the digits every couple of seconds, the colons blink, and the colour
carries the state:

-   green sweeping to gold while running
-   grey to pale blue while paused
-   dark red to red past an hour

Timers other than the current one are listed underneath, dimmed, with a marker
for whether they are running.

Terminals that cannot draw the frame — no VT support, `TERM=dumb`, or too few
columns or rows to hold it — fall back to a single line showing the current
timer's elapsed time. In that fallback the other timers are not listed, so
switching between them shows one at a time. A terminal that has not reported
its size yet gets nothing drawn for up to a second, rather than a frame in the
wrong place.
