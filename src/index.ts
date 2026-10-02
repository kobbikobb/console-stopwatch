#!/usr/bin/env node
import { run } from "./app";
import { createStdoutTerminal } from "./terminal";

run(createStdoutTerminal());
