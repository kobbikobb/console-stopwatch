[![Build Status](https://github.com/kobbikobb/console-stopwatch/actions/workflows/on_push.yaml/badge.svg)](https://github.com/kobbikobb/console-stopwatch/actions)

# console-stopwatch

Simple stopwatch for the console. Simple and quick 🚀

## Install & run in console

-   Install globally with `npm i console-stopwatch --global`
-   Run `stopwatch` in console.

## Instructions

-   Press `r` to reset current timer ✨
-   Press `n` to create a new timer ✨
-   Press `space` to pause current timer ✨
-   Press `↑` or `↓` to switch between timers ✨
-   Press `d` to switch between the block digits and a single line of text ✨
-   Press `ctrl+c` or `escape` to exit ✨

The elapsed time is drawn in block digits, redrawn in place, and mirrored in
the window title. Any other timers are listed underneath, and the up and down
arrows switch between them. The hours are only shown once there are any. The
keys you can press are listed at the top, with the timer a row below them.

```
  r reset · n new · d display · ␣ pause · esc quit

   █   █     █  ███   █ █  █
 █ █  █  █  █  █ █   █ █ █ █
 █ █  █     █  ███   ███ █ █
 █ █  █  █  █  █ █     █ █ █
  █   █     █  ███ █   █  █

```

If the terminal is too small for the digits, the display falls back to a single
line of text, with the keys above it and a blank row underneath.

`d` switches between the two and remembers the choice, so the next run starts on
the one you left it on. It is kept in `~/.config/console-stopwatch/settings.json`
(or `$XDG_CONFIG_HOME` when that is set), and nothing is written there until you
press the key. A terminal too small for whichever display you asked for still
gets the single line rather than something drawn off the edge.
