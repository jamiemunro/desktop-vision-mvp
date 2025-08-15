from flask import Flask
import json, os, time, queue, threading, sounddevice as sd, numpy as np
from faster_whisper import WhisperModel
from pydub import AudioSegment

# Use session directory passed from Electron, fallback to latest if not provided
SESSION_DIR = os.environ.get('SESSION_DIR')
if not SESSION_DIR:
    SESSIONS_ROOT = os.path.join(os.path.dirname(__file__), '..', 'sessions')
    SESSION_DIR = sorted([os.path.join(SESSIONS_ROOT, d) for d in os.listdir(SESSIONS_ROOT) if d != 'archived'], reverse=True)[0]

AUDIO_DIR = os.path.join(SESSION_DIR, "audio", "chunks"); os.makedirs(AUDIO_DIR, exist_ok=True)
EVENTS_PATH = os.path.join(SESSION_DIR, "events.ndjson")

model = WhisperModel("medium", device="cpu", compute_type="float32")
app = Flask(__name__)
q = queue.Queue(); chunks = []; SR = 16000

# Recording state management
recording_active = False
mic_stream = None
transcribe_thread = None

def write_event(obj):
    with open(EVENTS_PATH,"a") as f: f.write(json.dumps(obj)+"\n")

def mic_callback(indata, frames, time_info, status):
    if recording_active:
        q.put(indata.copy())

def start_microphone():
    global mic_stream, recording_active
    if mic_stream is None:
        recording_active = True
        mic_stream = sd.InputStream(samplerate=SR, channels=1, dtype='float32', device=0, callback=mic_callback)
        mic_stream.start()
        return True
    return False

def stop_microphone():
    global mic_stream, recording_active
    recording_active = False
    if mic_stream:
        mic_stream.stop()
        mic_stream.close()
        mic_stream = None
        return True
    return False

def transcribe_loop():
    global transcribe_thread
    buf = np.array([], dtype=np.int16); last_emit = time.time()
    
    while recording_active:
        if chunks:
            piece = chunks.pop(0); buf = np.concatenate([buf, piece])
        now = time.time()
        
        # Process buffer when we have enough data or after timeout
        if len(buf) > SR*3 or (now - last_emit > 2 and len(buf) > SR*0.5):
            if len(buf) > 0:
                # Use synchronized timestamp (milliseconds since epoch)
                ts = int(now * 1000)
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
        
        time.sleep(0.1)  # Prevent busy loop

def start_transcription():
    global transcribe_thread
    if transcribe_thread is None or not transcribe_thread.is_alive():
        transcribe_thread = threading.Thread(target=transcribe_loop, daemon=True)
        transcribe_thread.start()
        return True
    return False

# HTTP endpoints for recording control
@app.route('/start', methods=['POST'])
def start_recording():
    try:
        mic_started = start_microphone()
        transcribe_started = start_transcription()
        
        if mic_started and transcribe_started:
            write_event({
                "t": int(time.time() * 1000),
                "etype": "recording.started",
                "source": "audio"
            })
            return {"success": True, "message": "Audio recording started"}
        else:
            return {"success": False, "message": "Recording already active"}, 400
    except Exception as e:
        return {"success": False, "message": str(e)}, 500

@app.route('/stop', methods=['POST'])
def stop_recording():
    try:
        mic_stopped = stop_microphone()
        
        if mic_stopped:
            write_event({
                "t": int(time.time() * 1000),
                "etype": "recording.stopped", 
                "source": "audio"
            })
            return {"success": True, "message": "Audio recording stopped"}
        else:
            return {"success": False, "message": "Recording not active"}, 400
    except Exception as e:
        return {"success": False, "message": str(e)}, 500

@app.route('/status', methods=['GET'])
def get_status():
    return {
        "recording": recording_active,
        "session_dir": SESSION_DIR,
        "audio_dir": AUDIO_DIR
    }

if __name__ == "__main__":
    app.run(port=6061, debug=False)
