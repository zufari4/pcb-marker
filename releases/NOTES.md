## What's new in 1.0.1

- **Read contact Z from the printer.** A new crosshair button beside Contact Z reads the current Z position into the field. Save when ready to keep the value.
- **Smarter connection button.** Connect stays disabled while already connected with unchanged connection details. Editing the address, username, or password enables it again; changing drawing settings or the printer name does not.
- **Use the printer's actual travel limits.** Drawing, dry runs, G-code export, and pause/stop moves now use the limits reported by Klipper, including coordinate offsets. This fixes false out-of-bounds errors caused by the former fixed 220 mm X/Y limit.
- **Clearer movement errors.** Out-of-bounds messages identify the affected axis and its allowed range. The route is checked again immediately before launch.

## Downloads

- **PCB-Marker-Setup.exe** — Windows x64 installer.
- **PCB-Marker-Windows-x64.zip** — extract the entire archive and launch `PCB Marker.exe`.
- **pcb-marker-desktop-1.0.1.tgz** — npm package archive; install with `npm install -g ./pcb-marker-desktop-1.0.1.tgz`, then run `pcb-marker`.
- **SHA256SUMS.txt** — checksums for the installer and ZIP.

Windows builds include the desktop runtime and are unsigned. Existing settings are preserved.
