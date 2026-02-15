#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

STREAM_DECK_HOME="${STREAM_DECK_HOME:-$HOME/Library/Application Support/com.elgato.StreamDeck}"
STREAM_DECK_PROFILE_ID="${STREAM_DECK_PROFILE_ID:-10195D1F-B171-4551-8356-8CD4BF6BBE56}"
STREAM_DECK_MAIN_PAGE_ID="${STREAM_DECK_MAIN_PAGE_ID:-AF0F75A4-A3C4-434E-8DC1-6BBEE48F492C}"

PLUGIN_UUID="com.pshkrh.window-controls"
PLUGIN_ACTION_UUID="com.pshkrh.window-controls.key"

PLUGIN_SRC_DIR="$REPO_ROOT/com.pshkrh.window-controls.sdPlugin"
PLUGIN_TARGET_DIR="$STREAM_DECK_HOME/Plugins/com.pshkrh.window-controls.sdPlugin"

WINDOW_MOVER_ADDON="$STREAM_DECK_HOME/Plugins/com.elgato.window-mover.sdPlugin/bin/addon/mac/System.node"
PLUGIN_ADDON_PATH="$PLUGIN_SRC_DIR/bin/addon/mac/System.node"

PROFILE_ROOT="$STREAM_DECK_HOME/ProfilesV3/${STREAM_DECK_PROFILE_ID}.sdProfile"
MAIN_PAGE_DIR="$PROFILE_ROOT/Profiles/${STREAM_DECK_MAIN_PAGE_ID}"
MAIN_PAGE_MANIFEST="$PROFILE_ROOT/Profiles/${STREAM_DECK_MAIN_PAGE_ID}/manifest.json"

BACKUP_DIR="$REPO_ROOT/backups/$(date +%Y%m%d-%H%M%S)"

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

uuid_lower() {
  uuidgen | tr '[:upper:]' '[:lower:]'
}

uuid_upper() {
  uuidgen | tr '[:lower:]' '[:upper:]'
}

write_json() {
  local output_file="$1"
  local content="$2"
  printf '%s\n' "$content" > "$output_file"
}

require_command jq
require_command uuidgen

if [[ ! -d "$PLUGIN_SRC_DIR" ]]; then
  echo "Plugin source not found: $PLUGIN_SRC_DIR" >&2
  exit 1
fi

if [[ ! -f "$WINDOW_MOVER_ADDON" ]]; then
  echo "Window Mover native addon not found: $WINDOW_MOVER_ADDON" >&2
  exit 1
fi

if [[ ! -f "$MAIN_PAGE_MANIFEST" ]]; then
  echo "Main profile manifest not found: $MAIN_PAGE_MANIFEST" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp "$MAIN_PAGE_MANIFEST" "$BACKUP_DIR/main-page-manifest.json"

echo "Backup created: $BACKUP_DIR"

mkdir -p "$(dirname "$PLUGIN_ADDON_PATH")"
cp "$WINDOW_MOVER_ADDON" "$PLUGIN_ADDON_PATH"
chmod 644 "$PLUGIN_ADDON_PATH"

echo "Copied System.node into plugin source bundle"

existing_child_uuid="$(jq -r '.Controllers[0].Actions["4,0"].Settings.ProfileUUID // empty' "$MAIN_PAGE_MANIFEST")"
if [[ -n "$existing_child_uuid" ]]; then
  folder_uuid_lower="$(echo "$existing_child_uuid" | tr '[:upper:]' '[:lower:]')"
else
  folder_uuid_lower="$(uuid_lower)"
fi
folder_uuid_upper="$(echo "$folder_uuid_lower" | tr '[:lower:]' '[:upper:]')"

existing_action_id="$(jq -r '.Controllers[0].Actions["4,0"].ActionID // empty' "$MAIN_PAGE_MANIFEST")"
if [[ -n "$existing_action_id" ]]; then
  action_id_main="$existing_action_id"
else
  action_id_main="$(uuid_lower)"
fi

main_key_icon_src="$PLUGIN_SRC_DIR/imgs/mainKeyIcon.png"
main_key_image="Images/window-controls-main-key.png"
if [[ -f "$main_key_icon_src" ]]; then
  mkdir -p "$MAIN_PAGE_DIR/Images"
  cp "$main_key_icon_src" "$MAIN_PAGE_DIR/$main_key_image"
else
  main_key_image="$(jq -r '
    .Controllers[0].Actions
    | to_entries
    | map(select(.key != "4,0"))
    | map(select(.value.UUID == "com.elgato.streamdeck.profile.openchild"))
    | map(.value.States[0].Image // "")
    | map(select(length > 0))
    | .[0] // ""
  ' "$MAIN_PAGE_MANIFEST")"
  if [[ -n "$main_key_image" && ! -f "$MAIN_PAGE_DIR/$main_key_image" ]]; then
    main_key_image=""
  fi
fi

tmp_main_manifest="$(mktemp)"
jq \
  --arg action_id "$action_id_main" \
  --arg child_uuid "$folder_uuid_lower" \
  --arg key_image "$main_key_image" \
  '.Controllers[0].Actions["4,0"] = {
    "ActionID": $action_id,
    "LinkedTitle": true,
    "Name": "Create Folder",
    "Plugin": {
      "Name": "Create Folder",
      "UUID": "com.elgato.streamdeck.profile.openchild",
      "Version": "1.0"
    },
    "Resources": null,
    "Settings": {
      "ProfileUUID": $child_uuid
    },
    "State": 0,
    "States": [
      {
        "FontFamily": "",
        "FontSize": 12,
        "FontStyle": "",
        "FontUnderline": false,
        "Image": $key_image,
        "OutlineThickness": 2,
        "ShowTitle": true,
        "Title": "Window\nControls",
        "TitleAlignment": "bottom",
        "TitleColor": "#ffffff"
      }
    ],
    "UUID": "com.elgato.streamdeck.profile.openchild"
  }' "$MAIN_PAGE_MANIFEST" > "$tmp_main_manifest"

cp "$tmp_main_manifest" "$MAIN_PAGE_MANIFEST"
rm -f "$tmp_main_manifest"

echo "Patched main profile key 4,0 -> Window Controls folder"

folder_dir_upper="$PROFILE_ROOT/Profiles/$folder_uuid_upper"
folder_dir_lower="$PROFILE_ROOT/Profiles/$folder_uuid_lower"

if [[ -d "$folder_dir_upper" ]]; then
  folder_dir="$folder_dir_upper"
elif [[ -d "$folder_dir_lower" ]]; then
  folder_dir="$folder_dir_lower"
else
  folder_dir="$folder_dir_upper"
fi

folder_manifest="$folder_dir/manifest.json"

if [[ -f "$folder_manifest" ]]; then
  cp "$folder_manifest" "$BACKUP_DIR/folder-manifest-$folder_uuid_lower.json"
fi

aid_home="$(uuid_lower)"
aid_prev="$(uuid_lower)"
aid_next="$(uuid_lower)"
aid_slot0="$(uuid_lower)"
aid_slot1="$(uuid_lower)"
aid_slot2="$(uuid_lower)"
aid_slot3="$(uuid_lower)"
aid_slot4="$(uuid_lower)"
aid_slot5="$(uuid_lower)"
aid_slot6="$(uuid_lower)"
aid_slot7="$(uuid_lower)"
aid_slot8="$(uuid_lower)"
aid_slot9="$(uuid_lower)"
aid_slot10="$(uuid_lower)"
aid_slot11="$(uuid_lower)"

cat > "$folder_manifest" <<JSON
{
  "Controllers": [
    {
      "Actions": {
        "0,0": {
          "ActionID": "$aid_home",
          "LinkedTitle": true,
          "Name": "Go Back to Parent",
          "Plugin": {
            "Name": "Go Back to Parent",
            "UUID": "com.elgato.streamdeck.profile.backtoparent",
            "Version": "1.0"
          },
          "Resources": null,
          "Settings": {},
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "com.elgato.streamdeck.profile.backtoparent"
        },
        "0,1": {
          "ActionID": "$aid_prev",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "page_prev",
            "slotIndex": 0,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "0,2": {
          "ActionID": "$aid_next",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "page_next",
            "slotIndex": 0,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "4,0": {
          "ActionID": "$aid_slot3",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 3,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "1,0": {
          "ActionID": "$aid_slot0",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 0,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "2,0": {
          "ActionID": "$aid_slot1",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 1,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "3,0": {
          "ActionID": "$aid_slot2",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 2,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "4,1": {
          "ActionID": "$aid_slot7",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 7,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "4,2": {
          "ActionID": "$aid_slot11",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 11,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "3,1": {
          "ActionID": "$aid_slot6",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 6,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "2,1": {
          "ActionID": "$aid_slot5",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 5,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "1,1": {
          "ActionID": "$aid_slot4",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 4,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "1,2": {
          "ActionID": "$aid_slot8",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 8,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "2,2": {
          "ActionID": "$aid_slot9",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 9,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        },
        "3,2": {
          "ActionID": "$aid_slot10",
          "LinkedTitle": true,
          "Name": "Window Controls Key",
          "Plugin": {
            "Name": "Window Controls",
            "UUID": "$PLUGIN_UUID",
            "Version": "1.0.0"
          },
          "Resources": null,
          "Settings": {
            "role": "app_slot",
            "slotIndex": 10,
            "pageSize": 12
          },
          "State": 0,
          "States": [
            {}
          ],
          "UUID": "$PLUGIN_ACTION_UUID"
        }
      },
      "Type": "Keypad"
    }
  ],
  "Icon": "",
  "Name": ""
}
JSON

echo "Wrote folder manifest: $folder_manifest"

mkdir -p "$STREAM_DECK_HOME/Plugins"
rm -rf "$PLUGIN_TARGET_DIR"
cp -R "$PLUGIN_SRC_DIR" "$PLUGIN_TARGET_DIR"
rm -rf "$PLUGIN_TARGET_DIR/bin/cache"
chmod +x "$PLUGIN_TARGET_DIR/bin/plugin.js"
chmod +x "$PLUGIN_TARGET_DIR/bin/scripts/render_badged_icon.py"
chmod +x "$PLUGIN_SRC_DIR/bin/plugin.js"
chmod +x "$PLUGIN_SRC_DIR/bin/scripts/render_badged_icon.py"

echo "Installed plugin bundle: $PLUGIN_TARGET_DIR"

echo "Done. Recommended next steps:"
echo "1) Restart Stream Deck app (or disable/enable plugin profile)"
echo "2) Open key 4,0 -> Window Controls folder"
echo "3) If prompted, allow Screen Recording and Accessibility"
