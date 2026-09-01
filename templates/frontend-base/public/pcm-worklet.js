class PCMWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    // Batch interval: acumula N ms de audio antes de enviar (reduce mensajes ~25x)
    const batchMs = opts.batchMs ?? 200;
    this.batchSamples = Math.floor((sampleRate * batchMs) / 1000);
    this.accum = [];
    this.accumLen = 0;

    // El hilo principal pide vaciar el acumulador al soltar el botón: lo que
    // aún no alcanzó los batchMs es el final de la última palabra, y sin esto
    // se descartaba al cerrar el grafo de audio.
    this.port.onmessage = event => {
      if (event.data && event.data.type === 'flush') this._flush();
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    // Se acumula TODO, incluido el silencio. Antes un umbral de amplitud
    // (energy < 0.004) descartaba esos frames, y eso rompía el reconocimiento
    // de dos formas: Transcribe nunca recibía las pausas, así que no cerraba
    // ningún segmento y solo emitía resultados parciales — que por diseño van
    // atrasados respecto de lo hablado, de modo que el final de la frase no
    // llegaba nunca; y descartar frames empalma la línea de tiempo del audio,
    // que el reconocedor asume como PCM contiguo a 16 kHz.
    const pcm16 = new Int16Array(channelData.length);
    for (let i = 0; i < channelData.length; i++) {
      const s = Math.max(-1, Math.min(1, channelData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.accum.push(pcm16);
    this.accumLen += pcm16.length;

    if (this.accumLen >= this.batchSamples) this._flush();

    return true;
  }

  _flush() {
    if (this.accumLen === 0) return;
    const merged = new Int16Array(this.accumLen);
    let offset = 0;
    for (const chunk of this.accum) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.port.postMessage({ buffer: merged.buffer }, [merged.buffer]);
    this.accum = [];
    this.accumLen = 0;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
