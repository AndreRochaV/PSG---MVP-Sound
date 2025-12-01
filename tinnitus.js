// ========== ARQUITETURA DO SISTEMA ==========

// CAMADA DE INTERFACE - Gerenciamento de Configurações
class TherapyConfig {
  constructor() {
    this.frequency = 440;
    this.duration = 2;
    this.interval = 1;
    this.technique = "acrn";
    this.ttsText = "";
    this.panning = 0;
    this.volume = 0.5;
    this.lowpassFreq = 5000;
    this.highpassFreq = 100;
  }

  update(param, value) {
    this[param] = value;
  }
}

// CAMADA DE SÍNTESE - Geração de Áudio
class AudioSynthesizer {
  constructor(audioContext) {
    this.ctx = audioContext;
  }

  // Oscilador para tons puros
  createPureTone(frequency, duration, startTime) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + 0.01);
    gain.gain.linearRampToValueAtTime(0, startTime + duration - 0.01);

    osc.connect(gain);

    return { oscillator: osc, gainNode: gain };
  }

  // 4 tons harmônicos
  createACRN(baseFreq, duration, startTime) {
    const tones = [];
    const freqs = [
      baseFreq * 0.77,
      baseFreq * 0.9,
      baseFreq * 1.1,
      baseFreq * 1.23,
    ];

    freqs.forEach((freq, i) => {
      const tone = this.createPureTone(freq, duration, startTime + i * 0.1);
      tones.push(tone);
    });

    return tones;
  }

  // Ruído Branco
  createWhiteNoise(duration, startTime) {
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(1, startTime + 0.1);
    gain.gain.linearRampToValueAtTime(0, startTime + duration - 0.1);

    source.connect(gain);

    return { source, gainNode: gain };
  }

  // Síntese Vocal (TTS)
  speakText(text) {
    if ("speechSynthesis" in window && text.trim()) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "pt-BR";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
      return true;
    }
    return false;
  }
}

// CAMADA DE PROCESSAMENTO - Efeitos e Espacialização
class AudioProcessor {
  constructor(audioContext) {
    this.ctx = audioContext;
    this.setupProcessingChain();
  }

  setupProcessingChain() {
    // Panner para espacialização (IID/ITD)
    this.panner = this.ctx.createStereoPanner();

    // Filtros
    this.lowpassFilter = this.ctx.createBiquadFilter();
    this.lowpassFilter.type = "lowpass";
    this.lowpassFilter.frequency.value = 5000;

    this.highpassFilter = this.ctx.createBiquadFilter();
    this.highpassFilter.type = "highpass";
    this.highpassFilter.frequency.value = 100;

    // Gain Master
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.5;

    // Conectar cadeia de processamento
    this.panner.connect(this.lowpassFilter);
    this.lowpassFilter.connect(this.highpassFilter);
    this.highpassFilter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  connectSource(sourceNode) {
    sourceNode.connect(this.panner);
  }

  updateSpatial(panValue) {
    this.panner.pan.value = panValue;
  }

  updateVolume(volume) {
    this.masterGain.gain.value = volume;
  }

  updateLowpass(freq) {
    this.lowpassFilter.frequency.value = freq;
  }

  updateHighpass(freq) {
    this.highpassFilter.frequency.value = freq;
  }
}

// CAMADA DE REPRODUÇÃO - Sequenciador e Gerenciador de Sessão
class SessionManager {
  constructor() {
    this.isRunning = false;
    this.isPaused = false;
    this.startTime = null;
    this.pauseTime = null;
    this.elapsedTime = 0;
    this.stimuliCount = 0;
    this.timerInterval = null;
    this.audioContext = null;
    this.synthesizer = null;
    this.processor = null;
    this.config = new TherapyConfig();
    this.sequenceTimeout = null;
  }

  async initialize() {
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    this.synthesizer = new AudioSynthesizer(this.audioContext);
    this.processor = new AudioProcessor(this.audioContext);
  }

  start() {
    if (!this.audioContext) return;

    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }

    this.isRunning = true;
    this.isPaused = false;
    this.startTime = Date.now() - this.elapsedTime;

    this.updateUI("active");
    this.startTimer();
    this.playSequence();
  }

  pause() {
    this.isPaused = true;
    this.audioContext.suspend();
    this.stopTimer();
    this.updateUI("paused");
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
    }
  }

  resume() {
    this.isPaused = false;
    this.audioContext.resume();
    this.startTimer();
    this.playSequence();
    this.updateUI("active");
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.elapsedTime = 0;
    this.stimuliCount = 0;
    this.stopTimer();

    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
    }

    // Limpar todos os nós de áudio
    if (this.audioContext) {
      this.audioContext.close().then(() => {
        this.initialize();
      });
    }

    this.updateUI("inactive");
    this.updateStats();
  }

  playSequence() {
    if (!this.isRunning || this.isPaused) return;

    const now = this.audioContext.currentTime;
    const technique = this.config.technique;

    // Atualizar processamento
    this.processor.updateSpatial(this.config.panning);
    this.processor.updateVolume(this.config.volume);
    this.processor.updateLowpass(this.config.lowpassFreq);
    this.processor.updateHighpass(this.config.highpassFreq);

    if (technique === "acrn") {
      const tones = this.synthesizer.createACRN(
        this.config.frequency,
        this.config.duration,
        now,
      );

      tones.forEach((tone) => {
        this.processor.connectSource(tone.gainNode);
        tone.oscillator.start(now);
        tone.oscillator.stop(now + this.config.duration);
      });
    } else if (technique === "notch") {
      const tone = this.synthesizer.createPureTone(
        this.config.frequency,
        this.config.duration,
        now,
      );
      this.processor.connectSource(tone.gainNode);
      tone.oscillator.start(now);
      tone.oscillator.stop(now + this.config.duration);
    } else if (technique === "white") {
      const noise = this.synthesizer.createWhiteNoise(
        this.config.duration,
        now,
      );
      this.processor.connectSource(noise.gainNode);
      noise.source.start(now);
    } else if (technique === "tts" && this.config.ttsText) {
      this.synthesizer.speakText(this.config.ttsText);
    }

    this.stimuliCount++;
    this.updateStats();

    // Agendar próximo estímulo
    const nextDelay = (this.config.duration + this.config.interval) * 1000;
    this.sequenceTimeout = setTimeout(() => this.playSequence(), nextDelay);
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      this.elapsedTime = Date.now() - this.startTime;
      this.updateStats();
    }, 100);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateStats() {
    const minutes = Math.floor(this.elapsedTime / 60000);
    const seconds = Math.floor((this.elapsedTime % 60000) / 1000);
    document.getElementById("timeElapsed").textContent =
      `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    document.getElementById("stimuliCount").textContent = this.stimuliCount;

    const progress = Math.min(
      100,
      Math.floor((this.elapsedTime / 600000) * 100),
    ); // 10 min = 100%
    document.getElementById("progressPercent").textContent = `${progress}%`;
  }

  updateUI(status) {
    const statusIndicator = document.getElementById("statusIndicator");
    const startBtn = document.getElementById("startBtn");
    const pauseBtn = document.getElementById("pauseBtn");
    const stopBtn = document.getElementById("stopBtn");

    if (status === "active") {
      statusIndicator.className = "status-indicator status-active";
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      pauseBtn.textContent = "⏸ Pausar";
      stopBtn.disabled = false;
    } else if (status === "paused") {
      statusIndicator.className = "status-indicator status-active";
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      pauseBtn.textContent = "▶ Retomar";
      stopBtn.disabled = false;
    } else {
      statusIndicator.className = "status-indicator status-inactive";
      startBtn.disabled = false;
      pauseBtn.disabled = true;
      pauseBtn.textContent = "⏸ Pausar";
      stopBtn.disabled = true;
    }
  }
}

// ========== INICIALIZAÇÃO E EVENTOS DA UI ==========

const manager = new SessionManager();
manager.initialize();

// Atualizar displays dos controles
function updateDisplay(id, value, suffix = "") {
  document.getElementById(id).textContent = value + suffix;
}

// Eventos dos controles de configuração
document.getElementById("frequency").addEventListener("input", (e) => {
  const val = e.target.value;
  manager.config.update("frequency", parseFloat(val));
  updateDisplay("freqDisplay", val);
});

document.getElementById("duration").addEventListener("input", (e) => {
  const val = e.target.value;
  manager.config.update("duration", parseFloat(val));
  updateDisplay("durDisplay", val);
});

document.getElementById("interval").addEventListener("input", (e) => {
  const val = e.target.value;
  manager.config.update("interval", parseFloat(val));
  updateDisplay("intervalDisplay", val);
});

document.getElementById("technique").addEventListener("change", (e) => {
  manager.config.update("technique", e.target.value);
});

document.getElementById("ttsText").addEventListener("input", (e) => {
  manager.config.update("ttsText", e.target.value);
});

document.getElementById("panning").addEventListener("input", (e) => {
  const val = parseFloat(e.target.value);
  manager.config.update("panning", val);
  updateDisplay("panDisplay", val.toFixed(1));

  // Atualizar visualizador espacial
  const pointer = document.getElementById("spatialPointer");
  const offset = val * 90; // -90 a +90 pixels
  pointer.style.transform = `translate(calc(-50% + ${offset}px), -50%)`;
});

document.getElementById("volume").addEventListener("input", (e) => {
  const val = parseInt(e.target.value);
  manager.config.update("volume", val / 100);
  updateDisplay("volumeDisplay", val, "%");
});

document.getElementById("lowpass").addEventListener("input", (e) => {
  const val = e.target.value;
  manager.config.update("lowpassFreq", parseFloat(val));
  updateDisplay("lpfDisplay", val);
});

document.getElementById("highpass").addEventListener("input", (e) => {
  const val = e.target.value;
  manager.config.update("highpassFreq", parseFloat(val));
  updateDisplay("hpfDisplay", val);
});

// Eventos dos botões de controle
document.getElementById("startBtn").addEventListener("click", () => {
  manager.start();
});

document.getElementById("pauseBtn").addEventListener("click", () => {
  if (manager.isPaused) {
    manager.resume();
  } else {
    manager.pause();
  }
});

document.getElementById("stopBtn").addEventListener("click", () => {
  manager.stop();
});
