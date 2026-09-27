[![Build Status](https://github.com/kobbikobb/console-stopwatch/actions/workflows/on_push.yaml/badge.svg)](https://github.com/kobbikobb/console-stopwatch/actions)

# console-stopwatch

Simple stopwatch for the console. Simple and quick 🚀

## Install & run in console

-   Install globally with `npm i console-stopwatch --global`
-   Run `stopwatch` in console.

## Instructions

-   Press `r` to reset current timer ✨
-   Press `n` to create a new timer ✨
-   Press `any` other key to pause current timer ✨
-   Press `↑` or `↓` to switch between timers ✨
-   Press `ctrl+c` or `escape` to exit ✨

The elapsed time is drawn in block digits, redrawn in place, and mirrored in
the window title. Any other timers are listed underneath, and the up and down
arrows switch between them. The hours are only shown once there are any, and
the keys you can press are listed under the timer.

```
  █   █     █   █    ███ ███
█ █ █ █ █ █ █ █ █     █ █ █
█ █ █ █   █ █ █ █     █ ███
█ █ █ █ █ █ █ █ █     █ █ █
 █   █     █   █  █   █ ███
  r reset · n new · ␣ pause · esc quit
```

If the terminal is too small for the digits, the display falls back to a single
line of text.
