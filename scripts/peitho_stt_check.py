"""
Peitho STT Standalone Verification Script.

Streams a 16kHz PCM16 WAV audio stream to the active STT provider (ElevenLabs).
Strict privacy rule: Prints ONLY connection state, counts, byte sizes, and timing.
NEVER prints transcript text or audio payload.
"""
import asyncio
import io
import math
import os
import struct
import sys
import time
import wave
from dotenv import load_dotenv

# Ensure backend path is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(BASE_DIR, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from app.core.config import get_settings
from app.peitho.stt import get_stt_adapter


def generate_synthetic_pcm16_wav(duration_secs: float = 3.0, sample_rate: int = 16000) -> bytes:
    """Generate a clean synthetic 16kHz PCM16 WAV with modulated human-voice range tones (150-300Hz)."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        total_samples = int(duration_secs * sample_rate)
        frames = bytearray()
        for i in range(total_samples):
            t = float(i) / sample_rate
            # 220Hz fundamental tone with modulation to simulate speech envelope
            env = 0.5 * (1.0 + math.sin(2 * math.pi * 3.0 * t))
            val = int(env * 16000 * math.sin(2 * math.pi * 220.0 * t))
            val = max(-32767, min(32767, val))
            frames.extend(struct.pack("<h", val))
        wf.writeframes(frames)
    return buf.getvalue()


async def run_stt_check():
    settings = get_settings()
    provider_name = settings.peitho_stt_provider
    print(f"[*] Provider: {provider_name}")
    print(f"[*] Model: {settings.elevenlabs_stt_model}")

    partial_count = 0
    final_count = 0
    start_time = 0.0
    time_first_final = None

    async def on_partial(_: str):
        nonlocal partial_count
        partial_count += 1

    async def on_final(_: str):
        nonlocal final_count, time_first_final
        final_count += 1
        if time_first_final is None:
            time_first_final = time.time()

    adapter = get_stt_adapter(provider=provider_name, channel="check")
    adapter.on_partial(on_partial)
    adapter.on_final(on_final)

    print("[*] Initiating connection to provider...")
    await adapter.start()

    conn_state = "OPEN" if adapter.is_active else "FAILED"
    print(f"[*] Connection State: {conn_state}")

    if not adapter.is_active:
        print("[-] Adapter could not establish an active connection.")
        return 1

    # Generate test WAV
    wav_bytes = generate_synthetic_pcm16_wav(duration_secs=3.5, sample_rate=16000)
    print(f"[*] Generated 16kHz PCM16 audio buffer: {len(wav_bytes)} bytes")

    # Read PCM raw samples (skip 44-byte WAV header)
    pcm_data = wav_bytes[44:]
    chunk_size = 3200  # 100ms chunks at 16kHz 16-bit
    start_time = time.time()

    print("[*] Streaming audio chunks (100ms intervals)...")
    for offset in range(0, len(pcm_data), chunk_size):
        chunk = pcm_data[offset : offset + chunk_size]
        await adapter.send_audio(chunk)
        await asyncio.sleep(0.1)

    # Allow up to 3 seconds for VAD commit and finalization
    print("[*] Audio sent. Awaiting VAD commit interval...")
    for _ in range(30):
        await asyncio.sleep(0.1)
        if final_count > 0:
            break

    duration_to_final = (
        round(time_first_final - start_time, 3)
        if time_first_final and start_time
        else None
    )

    print("\n" + "=" * 50)
    print("PEITHO REALTIME STT VERIFICATION REPORT")
    print("=" * 50)
    print(f"Provider:             {provider_name}")
    print(f"Connection Status:    {'CONNECTED' if adapter.is_active else 'DISCONNECTED'}")
    print(f"Audio Bytes Streamed: {len(pcm_data)} bytes")
    print(f"Partial Events Count: {partial_count}")
    print(f"Final Events Count:   {final_count}")
    print(f"Time-to-First-Final:  {duration_to_final}s" if duration_to_final is not None else "Time-to-First-Final:  N/A")
    print("=" * 50 + "\n")

    await adapter.close()
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(run_stt_check())
    sys.exit(exit_code)
