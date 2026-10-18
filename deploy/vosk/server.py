# Streaming speech recognition for live keyword spotting (Kaldi, via Vosk), private to this server.
# The app opens one WebSocket per listening phone and sends 16 kHz 16-bit mono PCM; every chunk gets back
# either {"partial": "..."} (words so far) or {"text": "...", "result": [...]} when an utterance ends.
# Nothing is written to disk.
import asyncio, json, os
import websockets
from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
MODEL = Model(os.environ.get('MODEL', '/model'))
RATE = 16000


async def listen(ws):
    rec = KaldiRecognizer(MODEL, RATE)
    rec.SetWords(True)
    async for msg in ws:
        if isinstance(msg, str):
            if json.loads(msg).get('eof'):
                await ws.send(rec.FinalResult())
                break
            continue
        # Kaldi is CPU-bound; a thread keeps one phone from stalling the others.
        done = await asyncio.to_thread(rec.AcceptWaveform, msg)
        await ws.send(rec.Result() if done else rec.PartialResult())


async def main():
    async with websockets.serve(listen, '0.0.0.0', 2700, max_size=2**20):
        await asyncio.Future()

asyncio.run(main())
