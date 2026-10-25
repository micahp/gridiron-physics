#!/usr/bin/env python3
"""Synthesize the on-field contact sounds the stadium audio director plays.

The four sounds that used to ship here were generic library impacts (a soft
thump for pads, a wooden knock for the snap, a coach's whistle). Those read as
placeholders next to 22 rigged players, so this script builds them from
scratch instead of sampling a recording:

  snap.ogg      center snap: leather slap, short thump, small ring
  pads-1.ogg    shoulder pad contact on a hit
  pads-2.ogg    a tackle: heavier body thud plus a second landing impact
  whistle.ogg   referee pea whistle with the pea rattle and a breathy tail

Everything is additive noise and decaying sines with a small synthetic room,
so the output carries no third-party samples and no attribution burden.

Usage:
  python3 scripts/make_stadium_sfx.py --out web/audio
  python3 scripts/make_stadium_sfx.py --out web/audio --only whistle
"""
import argparse
import json
import zlib
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44100
PEAK = 0.70  # -3 dBFS


def rng_for(name):
    # Deterministic per-sound noise so rebuilds are byte-identical.
    return np.random.default_rng(zlib.crc32(name.encode()))


def band(x, lo, hi, soft=0.18):
    """Smooth band limit in the frequency domain (no scipy dependency)."""
    n = len(x)
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    mask = np.ones_like(freqs)
    if lo > 0:
        mask *= np.clip((freqs - lo * (1 - soft)) / (lo * soft + 1e-9), 0, 1)
    if hi < SR / 2:
        mask *= np.clip((hi * (1 + soft) - freqs) / (hi * soft + 1e-9), 0, 1)
    return np.fft.irfft(spec * mask, n)


def env(n, attack, decay, curve=1.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    return a * np.exp(-(t / max(decay, 1e-6)) ** curve)


def noise(rng, n):
    return rng.standard_normal(n)


def sweep(f0, f1, n, decay):
    t = np.arange(n) / SR
    f = f0 + (f1 - f0) * np.clip(t / (n / SR), 0, 1)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t / decay)


def room(x, wet=0.12, length=0.16):
    """Tiny synthetic room so the hit sits in a stadium instead of a vacuum."""
    rng = np.random.default_rng(11)
    n = int(length * SR)
    ir = band(noise(rng, n), 120, 5200) * np.exp(-np.arange(n) / (0.045 * SR))
    ir /= np.abs(ir).sum() + 1e-9
    wet_sig = np.convolve(x, ir)[: len(x)]
    return x * (1 - wet) + wet_sig * wet * np.abs(x).max()


def finish(x):
    x = band(x, 45, 16000)
    peak = np.abs(x).max()
    if peak > 0:
        x = x / peak * PEAK
    # Half-millisecond fade: enough to kill a click, short enough to keep the
    # transient of a snap or a pad hit intact.
    fade = int(0.0005 * SR)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x


def make_snap():
    rng = rng_for("snap")
    n = int(0.22 * SR)
    out = np.zeros(n)
    click = band(noise(rng, n), 2000, 9500) * env(n, 0.0005, 0.0045)
    slap = band(noise(rng, n), 520, 2300) * env(n, 0.0008, 0.018)
    thud = sweep(170, 105, n, 0.022) * 0.40
    ring = np.sin(2 * np.pi * 1180 * np.arange(n) / SR) * env(n, 0.001, 0.022) * 0.14
    out += click * 1.15 + slap * 1.0 + thud * 0.3 + ring
    return finish(room(out, wet=0.07))


def make_pad_hit():
    rng = rng_for("pads-1")
    n = int(0.30 * SR)
    out = np.zeros(n)
    clack = band(noise(rng, n), 950, 3000) * env(n, 0.0008, 0.022) * 1.2
    thud = sweep(210, 140, n, 0.05) * 0.6
    shell = np.sin(2 * np.pi * 640 * np.arange(n) / SR) * env(n, 0.001, 0.03) * 0.18
    body = band(noise(rng, n), 150, 700) * env(n, 0.001, 0.045) * 0.4
    out += clack + thud + shell + body
    return finish(room(out, wet=0.14))


def make_tackle():
    rng = rng_for("pads-2")
    n = int(0.52 * SR)
    out = np.zeros(n)
    clack = band(noise(rng, n), 900, 3200) * env(n, 0.0008, 0.028) * 1.0
    thud = sweep(135, 62, n, 0.13) * 0.95
    body = band(noise(rng, n), 110, 850) * env(n, 0.001, 0.075) * 0.55
    out += clack + thud + body

    # Second impact: both bodies and the pads landing just after the hit.
    delay = int(0.085 * SR)
    land_n = n - delay
    land = (sweep(95, 55, land_n, 0.085) * 0.55
            + band(noise(rng, land_n), 90, 480) * env(land_n, 0.002, 0.06) * 0.35)
    out[delay:] += land
    return finish(room(out, wet=0.16, length=0.22))


def make_whistle():
    rng = rng_for("whistle")
    n = int(0.62 * SR)
    t = np.arange(n) / SR

    # The pea bouncing in the chamber: amplitude rattle around 22-30 Hz plus
    # jitter, which is what makes a whistle read as a referee's and not a sine.
    rattle_hz = 26 + 4 * np.sin(2 * np.pi * 3.1 * t + 0.4)
    phase = 2 * np.pi * np.cumsum(rattle_hz) / SR
    rattle = 0.58 + 0.42 * np.abs(np.sin(phase))
    jitter = 1 + 0.06 * band(noise(rng, n), 8, 60) / (np.abs(noise(rng, n)).max() + 1e-9)

    # Slight downward glide as the referee runs out of breath.
    glide = 3480 * (1 - 0.018 * np.clip((t - 0.42) / 0.2, 0, 1))
    phase_f = 2 * np.pi * np.cumsum(glide) / SR
    tone = (np.sin(phase_f) * 0.80
            + np.sin(2 * phase_f) * 0.12
            + np.sin(0.5 * phase_f) * 0.04)

    # Just enough air to stop the tone sounding like a test signal.
    breath = band(noise(rng, n), 2800, 6500) * 0.05
    body = (tone + breath) * rattle * jitter

    ceiling = np.clip(t / 0.018, 0, 1)                      # fast attack
    tail = np.clip((0.62 - t) / 0.11, 0, 1) ** 1.4          # breathy release
    return finish(body * ceiling * tail)


SOUNDS = {
    "snap.ogg": make_snap,
    "pads-1.ogg": make_pad_hit,
    "pads-2.ogg": make_tackle,
    "whistle.ogg": make_whistle,
}


def write_ogg(samples, target, ffmpeg, quality=4):
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = Path(tmp) / "take.wav"
        pcm = np.clip(samples, -1, 1)
        with wave.open(str(wav_path), "w") as fh:
            fh.setnchannels(1)
            fh.setsampwidth(2)
            fh.setframerate(SR)
            fh.writeframes((pcm * 32767).astype("<i2").tobytes())
        subprocess.run(
            [ffmpeg, "-v", "error", "-y", "-i", str(wav_path),
             "-c:a", "libvorbis", "-q:a", str(quality), str(target)],
            check=True,
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/audio")
    ap.add_argument("--only", action="append", default=None)
    ap.add_argument("--ffmpeg", default=shutil.which("ffmpeg") or "ffmpeg")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    summary = {}
    for name, build in SOUNDS.items():
        if args.only and name.split(".")[0] not in args.only:
            continue
        samples = build()
        write_ogg(samples, out / name, args.ffmpeg)
        summary[name] = {
            "seconds": round(len(samples) / SR, 3),
            "peak": round(float(np.abs(samples).max()), 3),
            "rms": round(float(np.sqrt((samples ** 2).mean())), 4),
            "bytes": (out / name).stat().st_size,
        }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
