#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
export WRT_SOURCE_DIR="${WRT_SOURCE_DIR:-$repo_root/.work/source}"
export WRT_BUILDER_DIR="${WRT_BUILDER_DIR:-$repo_root/.work/builder}"
export WRT_LUCI_DIR="${WRT_LUCI_DIR:-$repo_root/.work/luci-daed}"
mkdir -p "$repo_root/reports"
node "$repo_root/scripts/build.mjs" sources > "$repo_root/reports/sources.tsv"

while IFS=$'\t' read -r name url revision sparse_path; do
  case "$name" in
    source) checkout_dir="$WRT_SOURCE_DIR" ;;
    builder) checkout_dir="$WRT_BUILDER_DIR" ;;
    luci-daed) checkout_dir="$WRT_LUCI_DIR" ;;
    *) echo "Unexpected source name: $name" >&2; exit 1 ;;
  esac
  if [ -e "$checkout_dir" ]; then
    echo "Use a fresh build directory: $checkout_dir already exists" >&2
    exit 1
  fi
  git init -q "$checkout_dir"
  git -C "$checkout_dir" remote add origin "$url"
  if [ -n "$sparse_path" ]; then
    git -C "$checkout_dir" fetch --depth=1 --filter=blob:none origin "$revision"
    git -C "$checkout_dir" sparse-checkout init --cone
    git -C "$checkout_dir" sparse-checkout set "$sparse_path"
  else
    git -C "$checkout_dir" fetch --depth=1 origin "$revision"
  fi
  git -C "$checkout_dir" checkout -q --detach FETCH_HEAD
  test "$(git -C "$checkout_dir" rev-parse HEAD)" = "$revision"
done < "$repo_root/reports/sources.tsv"

node "$repo_root/scripts/build.mjs" feeds
cd "$WRT_SOURCE_DIR"
./scripts/feeds update -a
./scripts/feeds install -a
./scripts/feeds install -f python3-pysocks python3-unidecode
node "$repo_root/scripts/build.mjs" customize

export GITHUB_WORKSPACE="$repo_root"
export WRT_PROFILE=PLUS WRT_TARGET=qualcommax WRT_CONFIG=IPQ60XX-WIFI-YES
export WRT_IP=192.168.10.1 WRT_NAME=OWRT WRT_SSID=OWRT WRT_WORD=12345678
export WRT_MARK=daed-plus WRT_DATE="$(date -u +%Y-%m-%d)" WRT_PACKAGE=''
: > "$repo_root/package-versions.txt"
cd "$WRT_SOURCE_DIR/package"
# Original pinned script has optional positional arguments: no `set -u` here.
bash -eo pipefail "$repo_root/reports/Packages.pinned.sh"
cd "$WRT_SOURCE_DIR"
bash -eo pipefail "$WRT_BUILDER_DIR/Scripts/Settings.sh"
node "$repo_root/scripts/build.mjs" normalize
make defconfig
node "$repo_root/scripts/build.mjs" verify-config
cp "$repo_root/package-versions.txt" "$repo_root/reports/external-package-versions.txt"
./scripts/feeds list -s > "$repo_root/reports/feeds-list.txt"
