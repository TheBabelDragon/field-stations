"""Camera-channel simulator.

Not a photorealistic renderer. It applies the damage the protocol
claims to survive: ambient, saturation, motion blur, dropped samples,
partial observation, modest clock skew.
"""

from __future__ import annotations

import random


def symbols_to_waveform(symbols: list[int], samples_per_symbol: int = 4, on: float = 1.0, off: float = 0.05) -> list[float]:
    wave: list[float] = []
    for bit in symbols:
        level = on if bit else off
        wave.extend([level] * samples_per_symbol)
    return wave


def add_ambient(samples: list[float], ambient: float = 0.08) -> list[float]:
    return [min(1.0, s + ambient) for s in samples]


def add_saturation(samples: list[float], ceiling: float = 0.95) -> list[float]:
    return [min(ceiling, s) for s in samples]


def motion_blur(samples: list[float], width: int = 2) -> list[float]:
    if width <= 1:
        return list(samples)
    out: list[float] = []
    for i in range(len(samples)):
        window = samples[max(0, i - width + 1) : i + 1]
        out.append(sum(window) / len(window))
    return out


def drop_prefix(samples: list[float], count: int) -> list[float]:
    return samples[count:]


def jitter_gain(samples: list[float], amount: float = 0.05, rng: random.Random | None = None) -> list[float]:
    rng = rng or random.Random(0)
    out = []
    for s in samples:
        g = 1.0 + rng.uniform(-amount, amount)
        out.append(max(0.0, min(1.0, s * g)))
    return out


def camera_observe(
    symbols: list[int],
    samples_per_symbol: int = 4,
    ambient: float = 0.08,
    blur: int = 2,
    drop: int = 0,
    gain: float = 0.04,
    seed: int = 1,
) -> list[float]:
    wave = symbols_to_waveform(symbols, samples_per_symbol=samples_per_symbol)
    wave = add_ambient(wave, ambient)
    wave = add_saturation(wave, 0.97)
    wave = motion_blur(wave, blur)
    wave = jitter_gain(wave, gain, random.Random(seed))
    if drop:
        wave = drop_prefix(wave, drop)
    return wave
