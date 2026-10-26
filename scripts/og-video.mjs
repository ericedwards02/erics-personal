// Renders public/og.mp4 (og:video) and public/og.png (og:image poster).
// "ERIC" scrambles into random ASCII and back, one character at a time.
// Frames are screenshotted in real Chrome so Paper Mono renders exactly as on the site.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 1200;
const HEIGHT = 630;
const FPS = 30;

const WORD = "ERIC";
const TARGET_GLYPHS = "!#$%&*+/<=>?@[]^_{|}~\\";
const NOISE_GLYPHS = `${TARGET_GLYPHS}ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`;

const HOLD_WORD = 30; // frames ERIC rests before scrambling
const HOLD_ASCII = 24; // frames the ASCII rests before scrambling back
const STAGGER = 3; // frames between each character starting to scramble
const SCRAMBLE = 12; // frames each character spends scrambling
const FLICKER = 2; // frames each noise glyph is held
const CYCLES = 2; // distinct ASCII targets per loop
const SWAP = (WORD.length - 1) * STAGGER + SCRAMBLE;

// Seeded so re-renders are reproducible.
let seed = 0x45524943;
/** @returns {number} */
function random() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** @param {string} glyphs @returns {string} */
function pick(glyphs) {
    return glyphs[Math.floor(random() * glyphs.length)];
}

/** @typedef {{ char: string, state: "word" | "noise" | "ascii" }} Cell */

/** @returns {Cell[][]} */
function buildFrames() {
    const frames = [];
    const hold = (text, state, length) => {
        for (let f = 0; f < length; f++) frames.push([...text].map((char) => ({ char, state })));
    };
    const swap = (from, to, fromState, toState) => {
        const noise = [...from].map(() => Array.from({ length: SCRAMBLE / FLICKER }, () => pick(NOISE_GLYPHS)));
        for (let f = 0; f < SWAP; f++) {
            frames.push(
                [...from].map((char, i) => {
                    const local = f - i * STAGGER;
                    if (local < 0) return { char, state: fromState };
                    if (local >= SCRAMBLE) return { char: to[i], state: toState };
                    return { char: noise[i][Math.floor(local / FLICKER)], state: "noise" };
                }),
            );
        }
    };

    for (let cycle = 0; cycle < CYCLES; cycle++) {
        const ascii = Array.from(WORD, () => pick(TARGET_GLYPHS)).join("");
        hold(WORD, "word", HOLD_WORD);
        swap(WORD, ascii, "word", "ascii");
        hold(ascii, "ascii", HOLD_ASCII);
        swap(ascii, WORD, "ascii", "word");
    }
    return frames;
}

const font = await readFile(new URL("../public/fonts/PaperMono-Variable.woff2", import.meta.url));
const fontUrl = `data:font/woff2;base64,${font.toString("base64")}`;
const html = /* html */ `<!doctype html>
<style>
    @font-face {
        font-family: "Paper Mono";
        src: url("${fontUrl}") format("woff2-variations");
        font-weight: 100 800;
    }
    html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
    body {
        display: grid;
        place-items: center;
        background: oklch(94% 0.018 63);
        font-family: "Paper Mono", monospace;
        font-weight: 600;
        color: oklch(22% 0.02 63);
    }
    #word { font-size: 240px; line-height: 1; white-space: pre; }
    #word span { display: inline-block; width: 1ch; text-align: center; }
    .noise { color: oklch(62% 0.03 63); }
    .ascii { color: #2563eb; }
    #url {
        position: absolute;
        left: 56px;
        bottom: 48px;
        font-size: 28px;
        font-weight: 500;
        color: oklch(55% 0.03 63);
    }
</style>
<div id="word"></div>
<div id="url">ericedwards.dev</div>`;

const frames = buildFrames();
const outDir = new URL("../public/", import.meta.url);

const browser = await puppeteer.launch({
    executablePath: CHROME,
    args: ["--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT });
await page.goto(`data:text/html,${encodeURIComponent(html)}`);
await page.evaluate(() => document.fonts.load('600 240px "Paper Mono"'));

/** @param {Cell[]} cells */
function render(cells) {
    return page.evaluate((cells) => {
        document.querySelector("#word").replaceChildren(
            ...cells.map(({ char, state }) => {
                const span = document.createElement("span");
                span.className = state;
                span.textContent = char;
                return span;
            }),
        );
    }, cells);
}

const ffmpeg = spawn(
    "ffmpeg",
    [
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-tune", "animation",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        fileURLToPath(new URL("og.mp4", outDir)),
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
);

for (const [i, cells] of frames.entries()) {
    await render(cells);
    const png = await page.screenshot({ type: "png" });
    if (i === 0) await writeFile(new URL("og.png", outDir), png);
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, "drain");
}
ffmpeg.stdin.end();
await browser.close();

const [code] = await once(ffmpeg, "exit");
if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
console.log(`Rendered ${frames.length} frames (${(frames.length / FPS).toFixed(1)}s) to public/og.mp4 and public/og.png`);
