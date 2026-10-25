import { _electron as electron } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k, v]) => v !== undefined && k !== "ELECTRON_RUN_AS_NODE",
  ),
);
const app = await electron.launch({
  executablePath: join(
    process.cwd(),
    "node_modules/electron/dist/electron.exe",
  ),
  args: ["."],
  env: {
    ...env,
    ORBIT_DATA_DIR: join(process.cwd(), ".orbit-local/icon-generation"),
  },
});
try {
  await app.firstWindow();
  const source = await readFile("resources/orbit.svg", "utf8");
  const pending = app.waitForEvent("window");
  await app.evaluate(async ({ BrowserWindow }, html) => {
    const w = new BrowserWindow({
      width: 256,
      height: 256,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { sandbox: true },
    });
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }, `<html><body style="margin:0;background:transparent">${source}</body></html>`);
  const page = await pending;
  const encoded = await page.evaluate(async (svg) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    canvas.getContext("2d").drawImage(img, 0, 0, 256, 256);
    return canvas.toDataURL("image/png").split(",")[1];
  }, source);
  const png = Buffer.from(encoded, "base64");
  await writeFile("resources/orbit.png", png);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await writeFile("resources/orbit.ico", Buffer.concat([header, png]));
} finally {
  await app.close();
}
