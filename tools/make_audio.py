#!/usr/bin/env python3
"""Deterministic generator for the procedural audio kit in assets/audio/.

Emits five tiny original CC0 22050 Hz mono 16-bit PCM WAV stand-ins
(see docs/CREDITS):
  engine.wav, skid.wav, wind.wav, click.wav, music_menu.wav
Every loopable file holds an integer number of sine cycles so it loops
seamlessly with no click at the seam; no timestamps, no randomness
beyond fixed seeds, so re-runs are byte-identical. Kept small (KBs)
for repo size and offline headless imports.
"""
import math
import os
import random
import struct
import wave

SAMPLE_RATE = 22050
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "audio")


def _write_wav(path, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = 0.7 / peak if peak > 0.7 else 1.0
    frames = b"".join(
        struct.pack("<h", max(-32768, min(32767, int(round(s * scale * 32767)))))
        for s in samples
    )
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(frames)
    print("wrote %s (%d bytes)" % (path, os.path.getsize(path)))


def _sine_phase(cycles, n):
    return [2.0 * math.pi * cycles * i / n for i in range(n)]


def make_engine():
    # 1.0 s loop: every partial completes an integer number of cycles in
    # 22050 samples, so LOOP_FORWARD never clicks. 55 Hz harmonic stack
    # plus a 2 Hz throb (2 cycles) for idle texture.
    n = SAMPLE_RATE
    partials = [(55, 0.50), (110, 0.90), (165, 0.50), (220, 0.30), (275, 0.15)]
    samples = [0.0] * n
    for freq, amp in partials:
        for i, ph in enumerate(_sine_phase(freq, n)):
            samples[i] += amp * math.sin(ph)
    for i in range(n):
        samples[i] *= 1.0 + 0.12 * math.sin(2.0 * math.pi * 2 * i / n)
    return samples


def make_skid():
    # 1.0 s loopable tire hiss: integer-Hz partials (800-6000 Hz) with
    # fixed-seed random phases and a 1/f falloff, so the sum loops
    # seamlessly by construction.
    rng = random.Random(1234)
    n = SAMPLE_RATE
    partials = []
    f = 800
    while f <= 6000:
        partials.append((f, rng.uniform(0.0, 2.0 * math.pi)))
        f += rng.randint(90, 210)
    samples = [0.0] * n
    for freq, phase in partials:
        amp = 1.0 / math.sqrt(freq / 800.0)
        for i, ph in enumerate(_sine_phase(freq, n)):
            samples[i] += amp * math.sin(ph + phase)
    return samples


def make_wind():
    # 2.0 s loopable wind rush: 0.5 Hz-quantized partials (40-900 Hz,
    # integer cycles in 44100 samples) with a 1/f falloff, fixed-seed
    # phases, and a slow 0.5 Hz swell (1 cycle) for gusts.
    rng = random.Random(77)
    n = 2 * SAMPLE_RATE
    partials = []
    f = 40.0
    while f <= 900.0:
        partials.append((f, rng.uniform(0.0, 2.0 * math.pi)))
        f += rng.uniform(18.0, 55.0)
    samples = [0.0] * n
    for freq, phase in partials:
        amp = 1.0 / ((freq / 40.0) ** 1.5)
        for i, ph in enumerate(_sine_phase(2.0 * freq, n)):
            samples[i] += amp * math.sin(ph + phase)
    for i in range(n):
        samples[i] *= 1.0 + 0.25 * math.sin(2.0 * math.pi * i / n)
    return samples


def make_click():
    # 0.12 s one-shot UI tick: 1250 Hz sine under an exponential decay
    # envelope with a 5 ms raised-cosine attack to avoid an onset click.
    n = int(0.12 * SAMPLE_RATE)
    samples = []
    for i in range(n):
        t = i / SAMPLE_RATE
        attack = min(1.0, i / (0.005 * SAMPLE_RATE))
        attack = attack * attack * (3.0 - 2.0 * attack)
        samples.append(math.sin(2.0 * math.pi * 1250.0 * t) * math.exp(-t * 55.0) * attack)
    return samples


def make_music():
    # 8.0 s looping menu pad: every partial is a multiple of 0.125 Hz
    # (integer cycles in 176400 samples) and every LFO divides 8 s, so
    # the track loops seamlessly. A-major-ish stack (A2/C#3/E3/A3/C#4)
    # over a 55 Hz bass with a 0.5 Hz breathing pulse.
    n = 8 * SAMPLE_RATE
    partials = [(55.0, 0.45), (110.0, 0.60), (137.5, 0.40), (165.0, 0.40),
                (220.0, 0.35), (275.0, 0.22), (330.0, 0.12)]
    samples = [0.0] * n
    for freq, amp in partials:
        for i, ph in enumerate(_sine_phase(8.0 * freq, n)):
            samples[i] += amp * math.sin(ph)
    for i in range(n):
        samples[i] *= 1.0 + 0.18 * math.sin(2.0 * math.pi * 4 * i / n)
    return samples


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    _write_wav(os.path.join(OUT_DIR, "engine.wav"), make_engine())
    _write_wav(os.path.join(OUT_DIR, "skid.wav"), make_skid())
    _write_wav(os.path.join(OUT_DIR, "wind.wav"), make_wind())
    _write_wav(os.path.join(OUT_DIR, "click.wav"), make_click())
    _write_wav(os.path.join(OUT_DIR, "music_menu.wav"), make_music())


if __name__ == "__main__":
    main()
