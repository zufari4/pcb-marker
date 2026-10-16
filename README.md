<p align="center">
  <img src="https://raw.githubusercontent.com/zufari4/pcb-marker/main/assets/icon.png" width="112" alt="PCB Marker — an M made of PCB traces and pads">
</p>
<h1 align="center">PCB Marker</h1>
<p align="center">PCB Marker draws PCB traces from Gerber files using a marker mounted on a Klipper-based 3D printer.</p>
<p align="center">
  <a href="https://github.com/zufari4/pcb-marker/releases/latest">Download for Windows</a> ·
  <a href="#-getting-started">Getting started</a> ·
  <a href="https://github.com/zufari4/pcb-marker/issues">Feedback</a>
</p>
<p align="center">Windows x64 · English / Russian · MIT</p>

![Board view in PCB Marker](https://raw.githubusercontent.com/zufari4/pcb-marker/main/docs/screenshots/board.png)

## ✨ What you can do

- **Open Gerber ZIP files** — drop an archive into the app or choose Open file from the menu.
- **View both sides** — switch between top, bottom, or both layers without losing your zoom level.
- **Align with four corners** — account for board position and rotation while keeping a 1:1 scale.
- **Preview before drawing** — inspect the route and run it above the board without making contact.
- **Draw tracks and pad rings** — optionally add the board boundaries.
- **Follow the progress** — see completed paths, marker position, and progress, with pause, resume, and stop close at hand.
- **Tune the motion** — set drawing, travel, Z lift, and Z lowering speeds separately.
- **Choose your language** — English, Russian, or your system language. The included font works offline.
- **Export G-code** and check for new versions from the menu.

## 📥 Installation

### Windows app

[**Download the latest release →**](https://github.com/zufari4/pcb-marker/releases/latest)

| File | How to use it |
| --- | --- |
| **PCB-Marker-Setup.exe** | Run the installer and follow the steps |
| **PCB-Marker-Windows-x64.zip** | Extract the entire archive and open `PCB Marker.exe` |

The Windows downloads include everything you need — no Python or Node.js installation required.
Both versions save settings in your Windows user profile. Builds are currently unsigned,
so Windows may display a warning on first launch.

### Install with npm

The package is **ready for publication but is not yet available on the npm registry**.
Once published, install it with Node.js 22.12 or newer:

```sh
npm install -g pcb-marker-desktop
pcb-marker
```

This opens the full desktop app. Until registry publication, download the `.tgz`
package from [Releases](https://github.com/zufari4/pcb-marker/releases/latest) and install it locally:

```sh
npm install -g ./pcb-marker-desktop-1.0.0.tgz
pcb-marker
```

The first npm launch may download the desktop runtime.

## 🚀 Getting started

1. Home the printer with the board and marker clear of its moving parts.
2. Open **Settings**, enter your printer address and SSH credentials, and connect. Set the contact Z and lift height.
3. Open a Gerber ZIP from the menu or drag it into the app.
4. Open **Corner registration**, move the marker to each corner, and read its coordinates.
5. Choose a board side, inspect **Visualization**, and perform a **Dry run**.
6. When the alignment is right, select **Start drawing**.

Register the corners again whenever you move the board or marker.
Saved coordinates do not replace homing after the motors have been disabled.

## 🖼️ A closer look

**Settings — connection, drawing, and speeds in one place.**

![PCB Marker settings](https://raw.githubusercontent.com/zufari4/pcb-marker/main/docs/screenshots/settings.png)

**Corner registration — four points and a clear view of your board's position.**

![Corner registration](https://raw.githubusercontent.com/zufari4/pcb-marker/main/docs/screenshots/corners.png)

**Visualization — inspect the marker's route before starting.**

![Route visualization](https://raw.githubusercontent.com/zufari4/pcb-marker/main/docs/screenshots/preview.png)

## 🖨️ Compatibility

The initial printer profile targets **Creality K1 SE with Klipper and SSH access**.
Its working area is X/Y: 0–220 mm and Z: 0–250 mm. Other printers need compatibility
verification; changing the printer name does not change this profile.

PCB Marker reads top and bottom copper, board outlines, and drill files from Gerber ZIP archives,
including common KiCad and EasyEDA layer names. Solid copper regions are not filled.
The bottom side is mirrored automatically.

The app does not home the printer automatically. If the connection drops, the printer
may continue the job; reconnect to see its state. Progress is an estimate, and completion
is confirmed by the printer.

## 💬 Questions and ideas

[Open an issue](https://github.com/zufari4/pcb-marker/issues) with your app version,
a description, and a screenshot. Keep passwords and private settings out of reports.

**About** shows the version and author. **Check for updates** lets you know when
a new release is available and links to its download page.

Want to contribute? See the [development guide](CONTRIBUTING.md).

---

Released under the [MIT License](LICENSE).
