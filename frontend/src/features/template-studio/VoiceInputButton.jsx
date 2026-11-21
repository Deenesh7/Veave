import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { templateSiteService } from '../../services/templateSiteService';

const MAX_SECONDS = 90;
const TARGET_RATE = 16000;

// Browsers record webm/ogg/mp4; the speech model takes WAV, so the clip is decoded and re-encoded as 16 kHz mono PCM.
async function toWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.ceil(decoded.duration * TARGET_RATE);
    const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const samples = (await offline.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
    const text = (offset, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    samples.forEach((value, i) => { const clamped = Math.max(-1, Math.min(1, value)); view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true); });
    return new Blob([view], { type: 'audio/wav' });
  } finally { ctx.close(); }
}

// A mic for the AI instruction box: record, transcribe on the server, hand the text to onText.
export default function VoiceInputButton({ onText, disabled }) {
  const [state, setState] = useState('idle'); // idle | recording | transcribing
  const [error, setError] = useState('');
  const recorder = useRef(null);
  const stream = useRef(null);
  const timer = useRef(null);

  const release = () => { clearTimeout(timer.current); stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; };
  useEffect(() => () => { if (recorder.current?.state === 'recording') recorder.current.ondataavailable = recorder.current.onstop = null; release(); }, []);

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Voice input is not supported in this browser.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch { setError('Microphone access was blocked.'); return; }
    const chunks = [];
    const rec = new MediaRecorder(stream.current);
    recorder.current = rec;
    rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    rec.onstop = async () => {
      release();
      setState('transcribing');
      try {
        const wav = await toWav(new Blob(chunks, { type: rec.mimeType }));
        const { data } = await templateSiteService.transcribeVoice(wav);
        const text = (data?.text || '').trim();
        if (text) onText(text); else setError('No speech was heard.');
      } catch (err) {
        setError(err?.response?.data?.error?.message || 'The recording could not be transcribed.');
      } finally { setState('idle'); }
    };
    rec.start();
    setState('recording');
    timer.current = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_SECONDS * 1000);
  };

  const stop = () => recorder.current?.state === 'recording' && recorder.current.stop();
  const recording = state === 'recording';
  const busy = state === 'transcribing';

  return (
    <div className="flex items-center gap-2">
      {error ? <span role="alert" className="text-[11px] text-[#A4493A]">{error}</span> : null}
      {recording ? <span className="text-[11px] text-[#A4493A]">Listening… tap to stop</span> : null}
      {busy ? <span className="text-[11px] text-[#7A7366]">Transcribing…</span> : null}
      <button type="button" onClick={recording ? stop : start} disabled={disabled || busy}
        aria-label={recording ? 'Stop recording' : 'Dictate instruction with your voice'} title={recording ? 'Stop recording' : 'Speak your instruction'}
        className={`flex h-8 w-8 items-center justify-center rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5E7B5F] disabled:opacity-50 ${recording ? 'animate-pulse border-[#A4493A] bg-[#A4493A] text-white' : 'border-[#DDD6C8] bg-white text-[#3F5E41] hover:bg-[#E8F0E8]'}`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
      </button>
    </div>
  );
}
