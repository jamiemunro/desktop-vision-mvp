# Codebase Audit - Real Issues Found

## Current State Analysis

### What Actually Works ✅
- Heart button UI renders correctly with animations
- Electron app captures screen frames to individual session directories
- ASR Python process can transcribe audio when running
- Backend server provides MCP interface
- Basic file structure and session management

### Critical Issues Found ❌

#### 1. Audio/Visual NOT Synchronized
- **Problem**: Electron creates session `new Date().toISOString().replace(/[:.]/g,'-')` in main.js:5
- **Problem**: ASR finds "latest" session `sorted([...], reverse=True)[0]` in server.py:7
- **Result**: Audio and video write to DIFFERENT session directories

#### 2. Heart Button Doesn't Actually Control Recording
- **Problem**: `startAudio()` only starts the ASR process, doesn't control recording
- **Problem**: ASR process runs continuously once started (mic_loop starts immediately)
- **Result**: No actual start/stop control - audio always recording when process is alive

#### 3. Timestamp Mismatch
- **Problem**: Vision frames use `Date.now()` (JS timestamp)
- **Problem**: Audio chunks use `time.time()*1000` (Python timestamp)
- **Result**: No synchronized timeline between audio/video

#### 4. Session Directory Confusion
- **Problem**: Each Electron restart creates new session directory
- **Problem**: ASR always writes to "latest" directory (not necessarily current)
- **Result**: Data scattered across multiple sessions unpredictably

#### 5. No Unified File Format
- **Problem**: Frames are individual JPG files with timestamp names
- **Problem**: Audio chunks are individual WAV files with timestamp names
- **Problem**: Events are NDJSON but scattered across different sessions
- **Result**: Difficult to correlate and find data by date

## Required Fixes

1. **Session Synchronization**: Pass session directory from Electron to ASR process
2. **Unified Timestamping**: Use same timestamp source for all captures
3. **True Recording Control**: Make heart button actually start/stop microphone capture
4. **Metadata Enhancement**: Add proper session metadata with searchable timestamps
5. **Performance Optimization**: Reduce file I/O and improve capture speed

## Impact
Current system appears to work but captures are not synchronized and not reliably accessible for the intended AI app-building workflow.