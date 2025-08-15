from flask import Flask
import json, os, time, queue, threading, sounddevice as sd, numpy as np
from faster_whisper import WhisperModel
from pydub import AudioSegment

SESSIONS_ROOT = os.path.join(os.path.dirname(__file__), '..', 'sessions')
SESSION_DIR = sorted([os.path.join(SESSIONS_ROOT, d) for d in os.listdir(SESSIONS_ROOT)], reverse=True)[0]
AUDIO_DIR = os.path.join(SESSION_DIR, "audio", "chunks"); os.makedirs(AUDIO_DIR, exist_ok=True)
EVENTS_PATH = os.path.join(SESSION_DIR, "events.ndjson")

model = WhisperModel("medium", device="cpu", compute_type="float32")
app = Flask(__name__)
q = queue.Queue(); chunks = []; SR = 16000

def write_event(obj):
    with open(EVENTS_PATH,"a") as f: f.write(json.dumps(obj)+"\n")

def mic_loop():
    def cb(indata, frames, time_info, status): q.put(indata.copy())
    with sd.InputStream(samplerate=SR, channels=1, dtype='float32', device=0, callback=cb):
        while True:
            data = q.get()
            chunks.append(np.int16(data[:,0]*32767))
threading.Thread(target=mic_loop, daemon=True).start()

def transcribe_loop():
    buf = np.array([], dtype=np.int16); last_emit = time.time()
    sentence_buffer = []; last_speech_time = time.time()
    while True:
        if chunks:
            piece = chunks.pop(0); buf = np.concatenate([buf, piece])
        now = time.time()
        # Longer buffer for better sentence boundaries, but emit if silence detected
        if len(buf) > SR*4 or (now - last_emit > 3 and len(buf) > SR*1):
            ts = int(time.time()*1000)
            wav_path = os.path.join(AUDIO_DIR, f"{ts}.wav")
            AudioSegment(buf.tobytes(), frame_rate=SR, sample_width=2, channels=1).export(wav_path, format="wav")
            segments, info = model.transcribe(
                wav_path, 
                vad_filter=True,
                beam_size=5,
                temperature=0.0,
                condition_on_previous_text=True,
                vad_parameters=dict(min_silence_duration_ms=500)
            )
            text = " ".join([s.text.strip() for s in segments]).strip()
            if text: 
                write_event({ 
                    "t": ts, 
                    "etype": "speech.final", 
                    "text": text,
                    "confidence": info.language_probability,
                    "audio_file": wav_path
                })
            buf = np.array([], dtype=np.int16); last_emit = now
threading.Thread(target=transcribe_loop, daemon=True).start()

if __name__ == "__main__":
    app.run(port=6061)
