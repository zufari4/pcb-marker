const { app, BrowserWindow, nativeImage } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const logo = require("../src/shared/logo.json");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="5" y="5" width="246" height="246" rx="52" fill="#102129"/><g transform="translate(38 32) scale(6)" fill="none" stroke="#19e2db" stroke-width="${logo.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><path d="${logo.path}"/>${logo.pads
  .map(
    ([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="${logo.padRadius}" fill="#102129"/>`,
  )
  .join("")}</g></svg>`;
app.disableHardwareAcceleration();
app
  .whenReady()
  .then(async () => {
    const dir = join(__dirname, "../assets");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "icon.svg"), svg);
    const win = new BrowserWindow({
      width: 256,
      height: 256,
      useContentSize: true,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: { offscreen: true },
    });
    await win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<style>html,body{margin:0;width:256px;height:256px;background:transparent}</style>${svg}`,
        ),
    );
    // The first offscreen paint can be empty. Rasterize the decoded SVG
    // explicitly instead of capturing that transient frame.
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg))};
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      canvas.getContext("2d").drawImage(image, 0, 0, 256, 256);
      return canvas.toDataURL("image/png");
    })()`);
    const source = nativeImage.createFromDataURL(dataUrl);
    const png = source.toPNG();
    await writeFile(join(dir, "icon.png"), png);
    const sizes = [16, 24, 32, 48, 64, 128, 256];
    const images = sizes.map((size) =>
      source.resize({ width: size, height: size, quality: "best" }).toPNG(),
    );
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    let offset = header.length;
    sizes.forEach((size, index) => {
      const entry = 6 + index * 16;
      header[entry] = header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(images[index].length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      offset += images[index].length;
    });
    await writeFile(join(dir, "icon.ico"), Buffer.concat([header, ...images]));
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
