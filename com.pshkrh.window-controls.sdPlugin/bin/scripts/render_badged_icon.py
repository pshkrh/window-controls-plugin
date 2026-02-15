#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import tempfile
import shutil
import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont

    HAS_PIL = True
except Exception:
    HAS_PIL = False


KEY_SIZE = 72
DEFAULT_ICON_PACK = Path.home() / "Library/Application Support/com.elgato.StreamDeck/Plugins/com.elgato.keycreator.sdPlugin/static/com.elgato.defaulticonswhite.sdIconPack/icons"
CONTROL_ICON_FILES = {
    "home": "IconHome-White.svg",
    "page_prev": "IconChevronsLeft-White.svg",
    "page_next": "IconChevronsRight-White.svg",
    "move_left": "IconChevronLeft-White.svg",
    "move_right": "IconChevronRight-White.svg",
    "mode_back": "IconUndo-White.svg",
    "refresh": "IconRefresh-White.svg",
}


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def save_png_atomic(image: Image.Image, output_path: Path) -> None:
    ensure_parent(output_path)
    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            dir=output_path.parent,
            delete=False,
        ) as temp:
            temp_file = Path(temp.name)

        image.save(temp_file, format="PNG")
        os.replace(temp_file, output_path)
    finally:
        if temp_file and temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass


def copy_file_atomic(source: Path, output_path: Path) -> None:
    ensure_parent(output_path)
    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{output_path.name}.",
            suffix=".tmp",
            dir=output_path.parent,
            delete=False,
        ) as temp:
            temp_file = Path(temp.name)

        shutil.copyfile(source, temp_file)
        os.replace(temp_file, output_path)
    finally:
        if temp_file and temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass


def run_command(command: list[str]) -> None:
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def read_defaults_value(plist_path: Path, key: str) -> str:
    try:
        output = subprocess.check_output(
            ["defaults", "read", str(plist_path), key],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return output.strip()
    except Exception:
        return ""


def resolve_app_icon_icns(app_path: Path) -> Path | None:
    info_plist = app_path / "Contents" / "Info"
    icon_file = read_defaults_value(info_plist, "CFBundleIconFile")
    if icon_file:
        icon_path = app_path / "Contents" / "Resources" / icon_file
        if icon_path.suffix.lower() != ".icns":
            icon_path = icon_path.with_suffix(".icns")
        if icon_path.exists():
            return icon_path

    for fallback in [
        app_path / "Contents" / "Resources" / "AppIcon.icns",
        app_path / "Contents" / "Resources" / "app.icns",
    ]:
        if fallback.exists():
            return fallback

    return None


def extract_app_icon_png(app_path: str, output_png: Path) -> bool:
    app = Path(app_path)
    if app.exists() and app.is_dir():
        icon_icns = resolve_app_icon_icns(app)
        if icon_icns and icon_icns.exists():
            try:
                run_command(["sips", "-s", "format", "png", "-Z", str(KEY_SIZE), str(icon_icns), "--out", str(output_png)])
                return True
            except Exception:
                pass

    # Fallback to generic app icon from CoreTypes.
    generic = Path("/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericApplicationIcon.icns")
    if generic.exists():
        try:
            run_command(["sips", "-s", "format", "png", "-Z", str(KEY_SIZE), str(generic), "--out", str(output_png)])
            return True
        except Exception:
            return False

    return False


def draw_badge(image: Image.Image, badge: str) -> None:
    if not badge:
        return

    draw = ImageDraw.Draw(image)
    font_size = 11 if len(badge) == 1 else 9
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()

    text_bbox = draw.textbbox((0, 0), badge, font=font)
    text_w = text_bbox[2] - text_bbox[0]
    text_h = text_bbox[3] - text_bbox[1]

    badge_w = max(18, text_w + 10)
    badge_h = 18
    x1 = KEY_SIZE - 4
    x0 = x1 - badge_w
    y0 = 4
    y1 = y0 + badge_h

    if badge == "1":
        fill = (21, 108, 196, 245)
    elif badge == "2":
        fill = (0, 138, 98, 245)
    else:
        fill = (23, 130, 153, 245)

    draw.rounded_rectangle([x0, y0, x1, y1], radius=5, fill=fill, outline=(255, 255, 255, 210), width=1)

    tx = x0 + (badge_w - text_w) // 2
    ty = y0 + (badge_h - text_h) // 2 - 1
    draw.text((tx, ty), badge, fill=(255, 255, 255, 255), font=font)


def draw_arrow_icon(draw: ImageDraw.ImageDraw, direction: str, color: tuple[int, int, int, int]) -> None:
    y = KEY_SIZE // 2
    if direction == "left":
        draw.line([(50, y), (26, y)], fill=color, width=6)
        draw.polygon([(22, y), (34, y - 10), (34, y + 10)], fill=color)
    else:
        draw.line([(22, y), (46, y)], fill=color, width=6)
        draw.polygon([(50, y), (38, y - 10), (38, y + 10)], fill=color)


def draw_back_icon(draw: ImageDraw.ImageDraw, color: tuple[int, int, int, int]) -> None:
    draw.line([(52, 20), (30, 20), (30, 50)], fill=color, width=6)
    draw.polygon([(18, 20), (32, 10), (32, 30)], fill=color)


def draw_refresh_icon(draw: ImageDraw.ImageDraw, color: tuple[int, int, int, int]) -> None:
    draw.arc([16, 16, 56, 56], start=30, end=325, fill=color, width=6)
    draw.polygon([(54, 18), (60, 30), (47, 28)], fill=color)


def resolve_control_icon_svg(role: str) -> Path | None:
    filename = CONTROL_ICON_FILES.get(role)
    if not filename:
        return None

    icon_path = DEFAULT_ICON_PACK / filename
    if icon_path.exists():
        return icon_path

    # Fallback for non-standard HOME values.
    home = os.environ.get("HOME")
    if home:
        fallback = Path(home) / "Library/Application Support/com.elgato.StreamDeck/Plugins/com.elgato.keycreator.sdPlugin/static/com.elgato.defaulticonswhite.sdIconPack/icons" / filename
        if fallback.exists():
            return fallback

    return None


def paste_svg_icon(image: Image.Image, svg_path: Path) -> bool:
    if not HAS_PIL:
        return False

    try:
        with tempfile.TemporaryDirectory(prefix="wc-ctrl-icon-") as temp_dir:
            png_path = Path(temp_dir) / "icon.png"
            run_command(["sips", "-s", "format", "png", "-Z", "44", str(svg_path), "--out", str(png_path)])
            if not png_path.exists():
                return False

            icon = Image.open(png_path).convert("RGBA")
            x = (KEY_SIZE - icon.width) // 2
            y = (KEY_SIZE - icon.height) // 2
            image.alpha_composite(icon, (x, y))
            return True
    except Exception:
        return False


def render_app_mode(app_path: str, badge: str, selected: bool, output_path: Path) -> int:
    with tempfile.TemporaryDirectory(prefix="wc-icon-") as temp_dir:
        extracted = Path(temp_dir) / "app.png"
        if not extract_app_icon_png(app_path, extracted):
            return 2

        if not HAS_PIL:
            copy_file_atomic(extracted, output_path)
            return 0

        image = Image.open(extracted).convert("RGBA")
        image = image.resize((KEY_SIZE, KEY_SIZE), Image.Resampling.LANCZOS)
        if selected:
            border = ImageDraw.Draw(image)
            border.rounded_rectangle(
                [2, 2, KEY_SIZE - 3, KEY_SIZE - 3],
                radius=9,
                outline=(255, 214, 10, 255),
                width=3,
            )
        draw_badge(image, badge)
        save_png_atomic(image, output_path)
        return 0


def default_control_label(role: str) -> str:
    mapping = {
        "page_prev": "<",
        "page_next": ">",
        "refresh": "R",
        "mode_back": "BACK",
        "move_left": "LEFT",
        "move_right": "RIGHT",
        "selected_preview": "APP",
    }
    return mapping.get(role, role.upper())


def render_control_mode(role: str, label: str, output_path: Path) -> int:
    if not HAS_PIL:
        # Generic fallback icon when Pillow is unavailable.
        return render_app_mode("", "", False, output_path)

    if role == "idle":
        image = Image.new("RGBA", (KEY_SIZE, KEY_SIZE), (0, 0, 0, 255))
        save_png_atomic(image, output_path)
        return 0

    text = label or default_control_label(role)
    image = Image.new("RGBA", (KEY_SIZE, KEY_SIZE), (0, 0, 0, 255))
    draw = ImageDraw.Draw(image)

    icon_svg = resolve_control_icon_svg(role)
    if icon_svg and paste_svg_icon(image, icon_svg):
        save_png_atomic(image, output_path)
        return 0

    icon_color = (255, 255, 255, 255)
    if role == "page_prev":
        draw_arrow_icon(draw, "left", icon_color)
    elif role == "page_next":
        draw_arrow_icon(draw, "right", icon_color)
    elif role == "move_left":
        draw_arrow_icon(draw, "left", icon_color)
    elif role == "move_right":
        draw_arrow_icon(draw, "right", icon_color)
    elif role == "mode_back":
        draw_back_icon(draw, icon_color)
    elif role == "refresh":
        draw_refresh_icon(draw, icon_color)
    else:
        font_size = 18 if len(text) <= 4 else 14
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

        text_bbox = draw.textbbox((0, 0), text, font=font)
        text_w = text_bbox[2] - text_bbox[0]
        text_h = text_bbox[3] - text_bbox[1]
        tx = (KEY_SIZE - text_w) // 2
        ty = (KEY_SIZE - text_h) // 2
        draw.text((tx, ty), text, fill=icon_color, font=font)

    save_png_atomic(image, output_path)
    return 0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        return 1

    mode = argv[1]

    if mode == "app":
        if len(argv) < 6:
            return 1
        app_path = argv[2]
        badge = argv[3]
        selected = argv[4] == "1"
        output = Path(argv[5])
        return render_app_mode(app_path, badge, selected, output)

    if mode == "control":
        if len(argv) < 5:
            return 1
        role = argv[2]
        label = argv[3]
        output = Path(argv[4])
        return render_control_mode(role, label, output)

    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
