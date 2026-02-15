# Window Controls Plugin

Custom Stream Deck plugin for macOS that:
- Lists open apps as dynamic keys with app icons.
- Shows display badges (`1`, `2`, `1+2`).
- Supports two-step flow: select app -> move all windows left/right.

## Layout
- `com.pshkrh.window-controls.sdPlugin/`: Stream Deck plugin bundle.
- `src/`: source mirrors for core modules.
- `tests/`: lightweight local validation scripts.

## Install
Run:

```bash
./scripts/install-window-controls.sh
```

This copies the native `System.node` addon from Elgato Window Mover, installs the plugin bundle, and patches the target profile so key `4,0` opens the new `Window Controls` folder.

## Notes
- Icon rendering uses `sips` and a local Python renderer (`bin/scripts/render_badged_icon.py`).
- If Pillow is unavailable in the host Python, the renderer falls back to app icons without badge overlays.
