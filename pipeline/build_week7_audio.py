#!/usr/bin/env python3
"""Download a small licensed stadium audio kit for the Week 7 viewer.

Sources are pinned to their publisher URLs, not scraped from Madden. Creates
browser-friendly OGG files and a SHA-256 manifest; requires ffmpeg.
"""
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "audio"
ARCHIVES = {
    "impact": "https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
    "rpg": "https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip",
    "interface": "https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
    "crowd": "https://opengameart.org/sites/default/files/gregor_quendel_-_free_crowd_cheering_sounds_-_mp3.zip",
    "whistles": "https://opengameart.org/sites/default/files/whistles.zip",
}

def acquire(url: str) -> zipfile.ZipFile:
    req = urllib.request.Request(url, headers={"User-Agent": "GridironPhysics/0.1 (public free SFX attribution)"})
    with urllib.request.urlopen(req, timeout=60) as response:
        data = response.read()
    print("SOURCE", url, len(data), hashlib.sha256(data).hexdigest(), flush=True)
    return zipfile.ZipFile(io.BytesIO(data))

def candidates(archive: zipfile.ZipFile):
    return [n for n in archive.namelist() if not n.endswith("/")
            and n.lower().endswith((".wav", ".ogg", ".mp3", ".flac")) and "__macosx/" not in n.lower()]

def pick(names, *hints, fallback=0):
    for hint in hints:
        match = next((name for name in names if re.search(hint, Path(name).stem.lower())), None)
        if match: return match
    return names[min(fallback, len(names) - 1)] if names else None

def transcode(archive, filename, destination, seconds, channels):
    if not filename: raise RuntimeError(f"Missing required sound: {destination}")
    data = archive.read(filename)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", "pipe:0",
           "-t", str(seconds), "-ar", "44100", "-ac", str(channels),
           "-c:a", "libvorbis", "-q:a", "4", str(destination)]
    result = subprocess.run(cmd, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f"FFmpeg failed {filename}: {result.stderr.decode(errors='replace')}")
    print("SELECTED", filename, "->", destination.name, destination.stat().st_size, flush=True)
    return {"filename": destination.name, "from": filename,
            "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            "bytes": destination.stat().st_size}

def build():
    if not shutil.which("ffmpeg"): raise RuntimeError("ffmpeg is required")
    OUT.mkdir(parents=True, exist_ok=True)
    zips = {name: acquire(url) for name, url in ARCHIVES.items()}
    audio = {key: candidates(archive) for key, archive in zips.items()}
    for key, names in audio.items():
        print("ARCHIVE", key, "audio files:", len(names), "sample:", names[:12], flush=True)
        if not names: raise RuntimeError(f"Empty audio archive: {key}")
    recipe = [
        ("stadium-bed.ogg", "crowd", [r"10.*ambien", r"ambien"], 30, 2),
        ("crowd-cheer.ogg", "crowd", [r"05.*cheer", r"soft.*cheer"], 13, 2),
        ("crowd-big-cheer.ogg", "crowd", [r"03.*cheer", r"strong.*cheer"], 13, 2),
        ("crowd-murmur.ogg", "crowd", [r"07.*chatter", r"10.*ambien"], 13, 2),
        # whistle.ogg is NOT generated here any more: since 2026-10-25 it is the
        # first blast cut from a user-supplied referee whistle MP3 (see
        # docs/AUDIO-SOUND-PACK-2026-10-24.md). Keep this entry only if you mean
        # to revert that replacement.
        # ("whistle.ogg", "whistles", [r"whistle.*1", r"whistle"], 1.4, 1),
        ("pads-1.ogg", "impact", [r"impactsoft.*1", r"impactsoft", r"impactgeneric", r"impactpunch"], 1.5, 1),
        ("pads-2.ogg", "impact", [r"impactsoft.*2", r"impactpunch", r"impactgeneric", r"impactwood"], 1.5, 1),
        ("snap.ogg", "impact", [r"impactwood.*1", r"impactgeneric.*1", r"impactsoft"], 0.65, 1),
        ("cleat-1.ogg", "rpg", [r"footstep00", r"footstep0", r"footstep"], 0.8, 1),
        ("cleat-2.ogg", "rpg", [r"footstep02", r"footstep0", r"footstep"], 0.8, 1),
        ("ui-select.ogg", "interface", [r"click.*1", r"click", r"select"], 0.5, 1),
    ]
    manifest = {"provenance": ARCHIVES, "files": []}
    for dest, bundle, hints, seconds, channels in recipe:
        selected = pick(audio[bundle], *hints)
        # Fail if key clips accidentally alias the same source file.
        manifest["files"].append({
            "source_pack": bundle,
            **transcode(zips[bundle], selected, OUT / dest, seconds, channels),
        })
    (OUT / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("WROTE", OUT / "MANIFEST.json", flush=True)

if __name__ == "__main__":
    build()
