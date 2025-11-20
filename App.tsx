
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { generateSpeechStream } from './services/geminiService';
import { decode, decodeAudioData, exportToWav } from './utils/audio';
import { VOICES, TONES } from './constants';
import { LoadingSpinner, PlayIcon, PauseIcon, SpeakerIcon, DownloadIcon } from './components/Icons';

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

const App: React.FC = () => {
  const [text, setText] = useState<string>('Hello! I am a powerful text-to-speech model from Google. I can now stream audio and highlight words as I speak.');
  const [selectedVoice, setSelectedVoice] = useState<string>(VOICES[0].value);
  const [selectedTone, setSelectedTone] = useState<string>(TONES[0].value);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const [audioChunks, setAudioChunks] = useState<AudioBuffer[]>([]);
  const [isGenerated, setIsGenerated] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentWordIndex, setCurrentWordIndex] = useState<number>(-1);
  const [wordTimings, setWordTimings] = useState<WordTiming[]>([]);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const playbackStartTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const animationFrameIdRef = useRef<number | null>(null);
  const visualizerFrameIdRef = useRef<number | null>(null);

  const words = useMemo(() => text.split(/\s+/).filter(word => word.length > 0), [text]);

  useEffect(() => {
    return () => {
      audioContextRef.current?.close();
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      if (visualizerFrameIdRef.current) {
        cancelAnimationFrame(visualizerFrameIdRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isGenerated && totalDuration > 0) {
      const newWordTimings: WordTiming[] = [];
      const totalChars = text.replace(/\s+/g, '').length;
      if (totalDuration === 0) return;
      const charsPerSecond = totalChars / totalDuration;
      let accumulatedTime = 0;
      
      words.forEach(word => {
        const wordDuration = word.length / charsPerSecond;
        const startTime = accumulatedTime;
        const endTime = accumulatedTime + wordDuration;
        newWordTimings.push({ word, start: startTime, end: endTime });
        accumulatedTime = endTime;
      });
      setWordTimings(newWordTimings);
    }
  }, [isGenerated, totalDuration, text, words]);

  const stopPlayback = useCallback((resetPlaying = true) => {
    audioSourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) {}
      source.disconnect();
    });
    audioSourcesRef.current = [];
    
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (visualizerFrameIdRef.current) {
      cancelAnimationFrame(visualizerFrameIdRef.current);
      visualizerFrameIdRef.current = null;
    }
    
    if (resetPlaying) {
      setIsPlaying(false);
    }
    setCurrentTime(0);
    setCurrentWordIndex(-1);
    pauseOffsetRef.current = 0;
    playbackStartTimeRef.current = 0;
    
    // Clear canvas
    if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  const resetGeneration = useCallback(() => {
    stopPlayback();
    setIsGenerated(false);
    setAudioChunks([]);
    setTotalDuration(0);
    setWordTimings([]);
    setError(null);
  }, [stopPlayback]);

  const onTextChanged = (newText: string) => {
    setText(newText);
    if(isGenerated) {
        resetGeneration();
    }
  }

  const handleGenerateAudio = useCallback(async () => {
    if (!text.trim()) {
      setError('Please enter some text.');
      return;
    }
    resetGeneration();
    setIsLoading(true);

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if(audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    const tempChunks: AudioBuffer[] = [];
    let tempDuration = 0;

    const onAudioChunk = async (base64Audio: string) => {
      if (!audioContextRef.current) return;
      try {
        const audioData = decode(base64Audio);
        const buffer = await decodeAudioData(audioData, audioContextRef.current, 24000, 1);
        tempChunks.push(buffer);
        tempDuration += buffer.duration;
      } catch (e) {
        console.error("Error decoding audio chunk", e);
        setError("Failed to process an audio chunk.");
      }
    };
    
    const onStreamEnd = () => {
      setAudioChunks(tempChunks);
      setTotalDuration(tempDuration);
      setIsLoading(false);
      setIsGenerated(true);
    };
    
    const onError = (error: Error) => {
      setError(`Failed to generate audio: ${error.message}`);
      setIsLoading(false);
    };

    generateSpeechStream(text, selectedVoice, selectedTone, onAudioChunk, onStreamEnd, onError);
  }, [text, selectedVoice, selectedTone, resetGeneration]);

  const drawVisualizer = useCallback(() => {
    if (!analyserRef.current || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
        if (!isPlaying) return;
        visualizerFrameIdRef.current = requestAnimationFrame(draw);
        
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for(let i = 0; i < bufferLength; i++) {
            barHeight = dataArray[i] / 2;
            
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#22d3ee'); // Cyan 400
            gradient.addColorStop(1, '#0891b2'); // Cyan 600
            
            ctx.fillStyle = gradient;
            ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
    };
    
    draw();
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying) {
        drawVisualizer();
    }
  }, [isPlaying, drawVisualizer]);

  const updateProgress = useCallback(() => {
    if (!audioContextRef.current) return;
    
    const elapsedTime = pauseOffsetRef.current + (audioContextRef.current.currentTime - playbackStartTimeRef.current);
    setCurrentTime(Math.min(elapsedTime, totalDuration));

    const newWordIndex = wordTimings.findIndex(timing => elapsedTime >= timing.start && elapsedTime < timing.end);
    if(newWordIndex !== -1) {
        setCurrentWordIndex(newWordIndex);
    }

    if (elapsedTime < totalDuration) {
        animationFrameIdRef.current = requestAnimationFrame(updateProgress);
    } else {
        setIsPlaying(false);
        setCurrentTime(totalDuration);
        if (visualizerFrameIdRef.current) cancelAnimationFrame(visualizerFrameIdRef.current);
        // Clear canvas on end
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    }
  }, [totalDuration, wordTimings]);

  const play = useCallback(async (resumeTime = 0) => {
    if (!audioContextRef.current || audioChunks.length === 0) return;

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    } else {
      audioSourcesRef.current.forEach(source => {
          try { source.stop(); } catch(e) {}
          source.disconnect();
      });
      audioSourcesRef.current = [];
    }

    // Create Master Gain and Analyser
    const masterGain = audioContextRef.current.createGain();
    const analyser = audioContextRef.current.createAnalyser();
    analyser.fftSize = 64; // Lower FFT size for chunkier bars
    masterGain.connect(analyser);
    analyser.connect(audioContextRef.current.destination);
    analyserRef.current = analyser;

    let accumulatedDuration = 0;
    let startChunkIndex = 0;
    let startChunkOffset = 0;

    for(let i=0; i < audioChunks.length; i++) {
      const chunkDuration = audioChunks[i].duration;
      if (accumulatedDuration + chunkDuration > resumeTime) {
          startChunkIndex = i;
          startChunkOffset = resumeTime - accumulatedDuration;
          break;
      }
      accumulatedDuration += chunkDuration;
    }

    const now = audioContextRef.current.currentTime;
    let nextStartTime = now;

    for (let i = startChunkIndex; i < audioChunks.length; i++) {
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioChunks[i];
      // Connect to master gain instead of destination
      source.connect(masterGain);
      
      const offset = (i === startChunkIndex) ? startChunkOffset : 0;
      const duration = audioChunks[i].duration - offset;
      
      source.start(nextStartTime, offset);
      nextStartTime += duration;
      
      audioSourcesRef.current.push(source);
    }
      
    if(audioSourcesRef.current.length > 0) {
      const lastSource = audioSourcesRef.current[audioSourcesRef.current.length - 1];
      lastSource.onended = () => {
          const estEndTime = playbackStartTimeRef.current + (totalDuration - pauseOffsetRef.current);
          if (audioContextRef.current && audioContextRef.current.currentTime >= estEndTime - 0.1) {
               setIsPlaying(false);
               setCurrentTime(totalDuration);
          }
      };
    }
    
    playbackStartTimeRef.current = audioContextRef.current.currentTime;
    pauseOffsetRef.current = resumeTime;
    setIsPlaying(true);
    animationFrameIdRef.current = requestAnimationFrame(updateProgress);

  }, [audioChunks, totalDuration, updateProgress]);

  const pause = useCallback(async () => {
    if (!audioContextRef.current) return;
    
    pauseOffsetRef.current += (audioContextRef.current.currentTime - playbackStartTimeRef.current);
    
    audioSourcesRef.current.forEach(source => {
        try { source.stop(); } catch (e) {}
    });
    
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    if (visualizerFrameIdRef.current) {
      cancelAnimationFrame(visualizerFrameIdRef.current);
      visualizerFrameIdRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const handleDownload = useCallback(() => {
    if (audioChunks.length === 0) return;
    const blob = exportToWav(audioChunks, 24000);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'generated-speech.wav';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  }, [audioChunks]);

  const handlePlayPause = () => { isPlaying ? pause() : play(pauseOffsetRef.current); };

  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isGenerated || totalDuration === 0) return;
    const progressBar = e.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = progressBar.offsetWidth;
    const percentage = Math.max(0, Math.min(1, clickX / width));
    const newTime = totalDuration * percentage;
    
    if (isPlaying) {
        play(newTime);
    } else {
        pauseOffsetRef.current = newTime;
        setCurrentTime(newTime);
        const newWordIndex = wordTimings.findIndex(timing => newTime >= timing.start && newTime < timing.end);
        setCurrentWordIndex(newWordIndex);
    }
  };
  
  const progressPercentage = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-2xl p-6 md:p-8 space-y-6 transform transition-all duration-500 border border-gray-700">
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-cyan-400 tracking-tight">Gemini TTS Pro</h1>
          <p className="text-gray-400 mt-2 text-sm uppercase tracking-wider">Advanced Speech Synthesis</p>
        </div>
        
        <div className="space-y-4">
            {!isGenerated ? (
                <textarea
                    value={text}
                    onChange={(e) => onTextChanged(e.target.value)}
                    placeholder="Enter text to convert to speech..."
                    className="w-full h-40 p-4 bg-gray-900/50 border border-gray-600 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition duration-300 text-white resize-none placeholder-gray-500"
                    rows={5}
                />
            ) : (
                <div className="relative">
                    <div className="w-full h-48 p-4 bg-gray-900/50 border border-gray-600 rounded-xl overflow-y-auto scrollbar-thin scrollbar-thumb-gray-700 relative z-10">
                        <p className="text-gray-300 leading-relaxed text-lg">
                            {words.map((word, index) => (
                                <span key={index} className={`transition-colors duration-100 rounded px-0.5 ${index === currentWordIndex ? 'bg-cyan-500/30 text-cyan-200 font-bold shadow-[0_0_10px_rgba(34,211,238,0.3)]' : ''}`}>
                                    {word}{' '}
                                </span>
                            ))}
                        </p>
                    </div>
                    <canvas 
                        ref={canvasRef}
                        width="600"
                        height="100"
                        className="absolute bottom-0 left-0 w-full h-24 pointer-events-none opacity-30 rounded-b-xl z-0"
                    />
                </div>
            )}
        </div>
        
        {isGenerated && (
            <div className="space-y-3 bg-gray-700/30 p-4 rounded-xl border border-gray-700/50">
                <div 
                    className="w-full bg-gray-700 rounded-full h-2 cursor-pointer group relative overflow-hidden"
                    onClick={onProgressClick}
                >
                    <div 
                        className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full relative transition-all duration-100 ease-linear" 
                        style={{ width: `${progressPercentage}%` }}
                    >
                         <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    </div>
                </div>
                <div className="text-xs font-mono text-gray-400 flex justify-between">
                    <span>{new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
                    <span>{new Date(totalDuration * 1000).toISOString().substr(14, 5)}</span>
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <div className="space-y-1">
                <label htmlFor="voice-select" className="block text-xs font-medium text-gray-400 uppercase tracking-wider">Voice</label>
                <div className="relative">
                    <select
                        id="voice-select"
                        value={selectedVoice}
                        onChange={(e) => setSelectedVoice(e.target.value)}
                        className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-cyan-500 text-white appearance-none cursor-pointer hover:bg-gray-600 transition-colors"
                    >
                    {VOICES.map((voice) => (
                        <option key={voice.value} value={voice.value}>{voice.label}</option>
                    ))}
                    </select>
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400">
                        <i className="fas fa-chevron-down text-xs"></i>
                    </div>
                </div>
            </div>
            
             <div className="space-y-1">
                <label htmlFor="tone-select" className="block text-xs font-medium text-gray-400 uppercase tracking-wider">Tone</label>
                <div className="relative">
                    <select
                        id="tone-select"
                        value={selectedTone}
                        onChange={(e) => setSelectedTone(e.target.value)}
                        className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg focus:ring-2 focus:ring-cyan-500 text-white appearance-none cursor-pointer hover:bg-gray-600 transition-colors"
                    >
                    {TONES.map((tone) => (
                        <option key={tone.value} value={tone.value}>{tone.label}</option>
                    ))}
                    </select>
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2 pointer-events-none text-gray-400">
                        <i className="fas fa-chevron-down text-xs"></i>
                    </div>
                </div>
             </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm flex items-center gap-2 animate-pulse">
            <i className="fas fa-exclamation-circle"></i>
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          {!isGenerated ? (
               <button
                onClick={handleGenerateAudio}
                disabled={isLoading || !text.trim()}
                className="w-full flex justify-center items-center px-6 py-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-lg shadow-cyan-900/20 transition-all duration-200 active:scale-[0.98] flex gap-2"
              >
                {isLoading ? <LoadingSpinner /> : <SpeakerIcon />}
                {isLoading ? 'Generating Audio...' : 'Generate Speech'}
              </button>
          ) : (
              <>
                <button
                  onClick={() => resetGeneration()}
                  className="px-5 py-3 bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium rounded-xl transition-colors duration-200 border border-gray-600"
                >
                  New
                </button>
                
                <button
                  onClick={handlePlayPause}
                  className={`flex-1 px-6 py-3.5 font-bold rounded-xl shadow-lg transition-all duration-200 active:scale-[0.98] flex gap-2 justify-center items-center ${
                      isPlaying 
                      ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-amber-900/20' 
                      : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-green-900/20'
                  }`}
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  {isPlaying ? 'Pause' : 'Play Audio'}
                </button>

                <button
                  onClick={handleDownload}
                  className="px-5 py-3.5 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded-xl transition-all duration-200 active:scale-[0.98] flex gap-2 justify-center items-center border border-gray-600 group"
                  title="Download WAV"
                >
                  <DownloadIcon />
                </button>
              </>
          )}
        </div>
      </div>
       <footer className="text-center text-gray-600 mt-8 text-xs">
        <p>Built with Google Gemini 2.5 Flash • React 19 • Tailwind CSS</p>
      </footer>
    </div>
  );
};

export default App;
