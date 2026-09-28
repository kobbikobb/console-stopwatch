import fs from "fs";
import os from "os";
import path from "path";
import { DEFAULT_DISPLAY, readDisplay, writeDisplay } from "../settings";

describe("settings", () => {
    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    const originalHome = process.env.HOME;

    // Assigning undefined to an environment variable sets it to the string
    // "undefined" rather than removing it, which would leave every later test
    // reading a path called undefined.
    const restore = (
        name: "XDG_CONFIG_HOME" | "HOME",
        value: string | undefined,
    ) => {
        if (value === undefined) {
            delete process.env[name];
            return;
        }
        process.env[name] = value;
    };

    let home = "";

    // The file the module writes to when it is told to use a directory. The home
    // directory is the one case with a .config in the path, which is the sort of
    // thing a test helper quietly gets wrong and then blames the module.
    const settingsFile = (base: string, underConfig = true) =>
        path.join(
            base,
            ...(underConfig ? [".config"] : []),
            "console-stopwatch",
            "settings.json",
        );

    // A spy that calls through, so a test can check that the module only ever
    // wrote inside the directory it was told to use. Getting that wrong is how a
    // test ends up leaving a file in the developer's real home directory.
    let writeSpy: jest.SpyInstance;

    const pathsWritten = () =>
        writeSpy.mock.calls.map((call) => String(call[0]));

    beforeEach(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), "stopwatch-settings-"));
        process.env.XDG_CONFIG_HOME = home;
        writeSpy = jest.spyOn(fs, "writeFileSync");
    });

    afterEach(() => {
        writeSpy.mockRestore();
        fs.rmSync(home, { recursive: true, force: true });
        restore("XDG_CONFIG_HOME", originalConfigHome);
        restore("HOME", originalHome);
    });

    describe("the default", () => {
        it("should be the display the app has always picked for itself", () => {
            // The block digits whenever the terminal is big enough for them, so
            // a first run and a run with nothing remembered behave the same.
            expect(DEFAULT_DISPLAY).toBe("advanced");
        });
    });

    describe("readDisplay", () => {
        it("should return nothing when there is no file yet", () => {
            expect(readDisplay()).toBeNull();
        });

        it("should return what was written", () => {
            writeDisplay("standard");

            expect(readDisplay()).toBe("standard");
        });

        it("should return what was written the other way round", () => {
            writeDisplay("advanced");

            expect(readDisplay()).toBe("advanced");
        });

        it("should return nothing for a file that is not json", () => {
            fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true });
            fs.writeFileSync(settingsFile(home), "not json at all");

            expect(readDisplay()).toBeNull();
        });

        it("should return nothing for a display that is not one of the two", () => {
            fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true });
            fs.writeFileSync(
                settingsFile(home),
                JSON.stringify({ display: "sideways" }),
            );

            expect(readDisplay()).toBeNull();
        });

        it("should return nothing for json that is not an object", () => {
            fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true });
            fs.writeFileSync(settingsFile(home), JSON.stringify("standard"));

            expect(readDisplay()).toBeNull();
        });

        it("should return nothing for an empty file", () => {
            fs.mkdirSync(path.dirname(settingsFile(home)), { recursive: true });
            fs.writeFileSync(settingsFile(home), "");

            expect(readDisplay()).toBeNull();
        });

        it("should return nothing when the file cannot be read", () => {
            // A directory where the file should be fails to read rather than
            // throwing, and failing to read is not worth stopping a stopwatch for.
            fs.mkdirSync(settingsFile(home), { recursive: true });

            expect(readDisplay()).toBeNull();
        });
    });

    describe("writeDisplay", () => {
        it("should create the directory it needs", () => {
            expect(fs.existsSync(path.join(home, "console-stopwatch"))).toBe(
                false,
            );

            writeDisplay("standard");

            expect(fs.existsSync(settingsFile(home, false))).toBe(true);
        });

        it("should write only the display", () => {
            writeDisplay("standard");

            expect(
                JSON.parse(fs.readFileSync(settingsFile(home, false), "utf8")),
            ).toEqual({ display: "standard" });
        });

        it("should replace a file that was already there", () => {
            writeDisplay("standard");
            writeDisplay("advanced");

            expect(readDisplay()).toBe("advanced");
        });

        it("should not throw when it cannot write", () => {
            // A path with a file where the directory should be: mkdir and write
            // both fail, and neither is worth taking the app down for.
            fs.writeFileSync(path.join(home, "console-stopwatch"), "");

            expect(() => writeDisplay("standard")).not.toThrow();
        });
    });

    describe("where it is kept", () => {
        it("should use XDG_CONFIG_HOME when it is set", () => {
            const xdg = fs.mkdtempSync(
                path.join(os.tmpdir(), "stopwatch-xdg-"),
            );
            process.env.XDG_CONFIG_HOME = xdg;

            writeDisplay("standard");

            expect(fs.existsSync(settingsFile(xdg, false))).toBe(true);
            expect(pathsWritten().every((p) => p.startsWith(xdg))).toBe(true);
            fs.rmSync(xdg, { recursive: true, force: true });
        });

        it("should use the home directory when it is not", () => {
            const fallback = fs.mkdtempSync(
                path.join(os.tmpdir(), "stopwatch-home-"),
            );
            process.env.XDG_CONFIG_HOME = "";
            // The home directory is looked up natively, and jest sandboxes
            // process.env, so setting HOME here would not move it. The lookup is
            // stubbed instead.
            const homedir = jest.spyOn(os, "homedir").mockReturnValue(fallback);

            writeDisplay("standard");

            // The home directory case has a .config in the path, which the XDG
            // one does not.
            expect(fs.existsSync(settingsFile(fallback))).toBe(true);
            expect(pathsWritten().every((p) => p.startsWith(fallback))).toBe(
                true,
            );
            homedir.mockRestore();
            fs.rmSync(fallback, { recursive: true, force: true });
        });

        it("should not keep it next to the installed module", () => {
            // npm owns the directory the module is installed in, prunes it on
            // upgrade, and on a system wide install it belongs to root, so a
            // choice kept there would not survive for most people.
            writeDisplay("standard");

            expect(fs.existsSync(settingsFile(home, false))).toBe(true);
            expect(pathsWritten()).toEqual([settingsFile(home, false)]);
        });
    });
});
