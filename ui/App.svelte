<script>
  let isRecording = false;
  let isStarting = false;

  async function toggleRecording() {
    if (isStarting) return;
    
    isStarting = true;
    
    try {
      if (!isRecording) {
        const response = await fetch('/api/start', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
          isRecording = true;
        }
      } else {
        const response = await fetch('/api/stop', { method: 'POST' });
        const result = await response.json();
        if (result.success) {
          isRecording = false;
        }
      }
    } catch (error) {
      console.error('Recording toggle failed:', error);
    } finally {
      isStarting = false;
    }
  }
</script>

<main>
  <div class="app">
    <button 
      class="heart-button" 
      class:recording={isRecording}
      class:starting={isStarting}
      on:click={toggleRecording}
      disabled={isStarting}
    >
      <div class="heart">❤️</div>
    </button>
  </div>
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #000;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .app {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100vw;
    height: 100vh;
  }

  .heart-button {
    width: 120px;
    height: 120px;
    border: none;
    border-radius: 50%;
    background: linear-gradient(45deg, #ff6b6b, #ee5a52);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    box-shadow: 0 8px 32px rgba(255, 107, 107, 0.3);
    position: relative;
    overflow: hidden;
  }

  .heart-button:hover {
    transform: scale(1.1);
    box-shadow: 0 12px 40px rgba(255, 107, 107, 0.5);
  }

  .heart-button:active {
    transform: scale(0.95);
  }

  .heart-button.recording {
    background: linear-gradient(45deg, #ff1744, #d50000);
    animation: pulse 2s infinite;
  }

  .heart-button.starting {
    background: linear-gradient(45deg, #ffab00, #ff6f00);
  }

  .heart {
    font-size: 48px;
    transition: all 0.3s ease;
    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
  }

  .recording .heart {
    animation: heartbeat 1.5s infinite;
  }

  @keyframes pulse {
    0% { box-shadow: 0 8px 32px rgba(255, 107, 107, 0.3); }
    50% { box-shadow: 0 8px 32px rgba(255, 107, 107, 0.8); }
    100% { box-shadow: 0 8px 32px rgba(255, 107, 107, 0.3); }
  }

  @keyframes heartbeat {
    0% { transform: scale(1); }
    14% { transform: scale(1.1); }
    28% { transform: scale(1); }
    42% { transform: scale(1.1); }
    70% { transform: scale(1); }
  }

  .heart-button::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 50%;
    background: linear-gradient(45deg, rgba(255,255,255,0.2), transparent);
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .heart-button:hover::before {
    opacity: 1;
  }
</style>