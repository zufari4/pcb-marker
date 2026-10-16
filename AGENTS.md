# Working on PCB Marker

PCB Marker is a Windows desktop application for plotting Gerber artwork on a
Klipper-based 3D printer. Author: zufari. Keep the UI friendly and bilingual.

## Structure
- `src/core`: Gerber processing, routing, registration and motion compilation.
- `src/main`: Electron, SSH transport, persistence, job lifecycle and updates.
- `src/renderer`: React pages and Canvas views.
- `src/shared`: typed contracts, validation, translations metadata and logo geometry.
- `scripts`: build, release and isolated UI verification.

## Changes
- Keep modules small and typed. Use Prettier for touched files.
- Add RU and EN strings together. Settings, About, calibration and job views
  are workspace pages, not floating/native message boxes.
- Reuse `src/shared/logo.json` for every logo format.
- Validate IPC arguments and sender. Keep Node, SSH and filesystem out of renderer.
- Never log credentials, upload local printer profiles, or commit `.artifacts`.
- Preserve existing settings when adding fields; supply migration defaults.
- Keep drawing at 1:1. Preview, export and printer must share the motion compiler.
- Physical progress must follow observed telemetry; never treat buffered file
  position as proof of completed motion. Interpolate along the route, not chords.
- Do not send motion, heating, homing, pause/stop or other hardware commands
  during automated checks. Tests use isolated profiles and simulated transport.
- Do not stop or restart the user's running application or print job.

## Validation and release
- Run `npm test` and `npm run build` for behavior changes.
- For UI changes use `npm run test:ui` or a focused isolated Electron check.
- Use `npm run pack:win` for a local app, `npm run release:win` for installer + ZIP.
- Inspect `npm pack --dry-run` before npm publication. Never publish to npm
  without an explicit request. npm installation must launch the complete UI.
- Keep installer/ZIP in GitHub Releases, not Git history. `releases/README.md`
  is the user-facing download directory. Tags `vX.Y.Z` trigger release CI.
- Update README screenshots using the synthetic demo board, not private input.
- Public release notes and README describe user capabilities; development detail
  belongs in CONTRIBUTING.md. Keep version numbers consistent with package.json.
