const axios = require('axios');
const { AIError } = require('../../utils/errors');

// Turns a short voice recording into text with OpenRouter's speech-to-text endpoint.
const MODEL = process.env.TRANSCRIBE_MODEL || 'openai/whisper-large-v3-turbo';

async function transcribe({ buffer, format = 'wav', language }) {
  if (!process.env.OPENROUTER_API_KEY) throw new AIError('Voice input is not configured on the server.');
  try {
    const { data } = await axios.post(`${process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'}/audio/transcriptions`, {
      model: MODEL,
      input_audio: { data: buffer.toString('base64'), format },
      ...(language ? { language } : {})
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer': process.env.CLIENT_URL || 'http://localhost:5173', 'X-Title': 'VEAVE Voice Input', 'Content-Type': 'application/json' },
      timeout: 60000,
      maxBodyLength: Infinity
    });
    return String(data?.text || '').trim();
  } catch (error) {
    throw new AIError(`Voice transcription failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

module.exports = { transcribe, MODEL };
