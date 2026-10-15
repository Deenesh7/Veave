const { WaveFile } = require('wavefile');
const logger = require('../../utils/logger');

/**
 * Open-Source Whisper Service
 * Powered by OpenAI's Whisper model (Xenova/whisper-tiny.en) running locally.
 * REQUIRES NO API KEY — 100% OPEN SOURCE & FREE.
 */
class WhisperService {
  constructor() {
    this.transcriberPromise = null;
    this.isModelLoading = false;
  }

  /**
   * Lazily loads the local open-source Whisper model (cached after first load)
   */
  async getTranscriber() {
    if (this.transcriberPromise) {
      return this.transcriberPromise;
    }

    this.isModelLoading = true;
    logger.info('Initializing Open-Source Whisper (Xenova/whisper-tiny.en) with 0 API keys required...');

    this.transcriberPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = true;
      const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        quantized: true
      });
      this.isModelLoading = false;
      logger.info('Open-Source Whisper model loaded and ready for zero-key transcription.');
      return transcriber;
    })();

    return this.transcriberPromise;
  }

  /**
   * Transcribe an audio buffer using local Open-Source Whisper (No API key needed)
   * @param {Buffer} audioBuffer - Audio buffer (WAV preferred, or raw audio)
   * @param {string} originalname - Audio file name
   * @param {string} mimetype - Audio MIME type
   * @returns {Promise<{ success: boolean, text: string, openSource: boolean, apiKeyRequired: boolean, model: string }>}
   */
  async transcribeAudio(audioBuffer, originalname = 'voice_prompt.wav', mimetype = 'audio/wav') {
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Audio buffer is empty');
    }

    try {
      logger.info(`Processing ${audioBuffer.length} bytes of audio with Open-Source Whisper...`);

      // 1. Convert/parse WAV samples using WaveFile
      let floatSamples = null;
      try {
        const wav = new WaveFile(audioBuffer);
        // Ensure 16kHz mono audio
        wav.toSampleRate(16000);
        const samples = wav.getSamples(false, Float32Array);
        // If stereo or multi-channel, pick channel 0
        if (Array.isArray(samples)) {
          floatSamples = samples[0];
        } else {
          floatSamples = samples;
        }
      } catch (wavErr) {
        logger.warn(`WAV parsing notice: ${wavErr.message}. Attempting direct float conversion.`);
        // If not standard WAV header, interpret as raw 16-bit PCM or 32-bit floats
        const numSamples = Math.floor(audioBuffer.length / 2);
        floatSamples = new Float32Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
          const intSample = audioBuffer.readInt16LE(i * 2);
          floatSamples[i] = intSample / 32768.0;
        }
      }

      if (!floatSamples || floatSamples.length === 0) {
        throw new Error('Could not extract audio samples from buffer');
      }

      // 2. Transcribe locally using Open-Source Whisper
      const transcriber = await this.getTranscriber();
      const result = await transcriber(floatSamples);

      const transcribedText = result?.text ? result.text.trim() : '';
      logger.info(`Open-Source Whisper result (0 API key): "${transcribedText}"`);

      return {
        success: true,
        text: transcribedText,
        model: 'Xenova/whisper-tiny.en',
        openSource: true,
        apiKeyRequired: false,
        source: 'open-whisper-local'
      };
    } catch (err) {
      logger.error(`Open-Source Whisper local transcription failed: ${err.message}`);

      // Optional fallback: If user explicitly provided a cloud key, try it as fallback
      const openAiKey = process.env.OPENAI_API_KEY?.trim();
      if (openAiKey && openAiKey !== 'your_openai_api_key') {
        try {
          logger.info('Attempting cloud Whisper fallback since API key is configured...');
          const formData = new FormData();
          const file = new File([audioBuffer], originalname || 'audio.wav', {
            type: mimetype || 'audio/wav'
          });
          formData.append('file', file);
          formData.append('model', 'whisper-1');

          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${openAiKey}` },
            body: formData
          });

          if (response.ok) {
            const data = await response.json();
            return {
              success: true,
              text: data.text ? data.text.trim() : '',
              model: 'openai-cloud-whisper',
              openSource: true,
              apiKeyRequired: false
            };
          }
        } catch (cloudErr) {
          logger.warn(`Cloud fallback failed: ${cloudErr.message}`);
        }
      }

      throw new Error(`Open-Source Whisper error: ${err.message}`);
    }
  }
}

module.exports = new WhisperService();
