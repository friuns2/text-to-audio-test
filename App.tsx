
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { generateSpeechStream } from './services/geminiService';
import { decode, decodeAudioData } from './utils/audio';
import { VOICES } from './constants';
import { LoadingSpinner, PlayIcon, PauseIcon, SpeakerIcon } from './components/Icons';

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

const App: React.FC = () => {
  const [text, setText] = useState<string>('Hello! I am a powerful text-to-speech model from Google. I can now stream audio and highlight words as I speak.');
  const [selectedVoice, setSelectedVoice] = useState<string>(VOICES[0].value);
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
  const playbackStartTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const animationFrameIdRef = useRef<number | null>(null);

  const words = useMemo(() => text.split(/\s+/).filter(word => word.length > 0), [text]);

  useEffect(() => {
    return () => {
      audioContextRef.current?.close();
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
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
    if (resetPlaying) {
      setIsPlaying(false);
    }
    setCurrentTime(0);
    setCurrentWordIndex(-1);
    pauseOffsetRef.current = 0;
    playbackStartTimeRef.current = 0;
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

    generateSpeechStream(text, selectedVoice, onAudioChunk, onStreamEnd, onError);
  }, [text, selectedVoice, resetGeneration]);

  const updateProgress = useCallback(() => {
    if (!audioContextRef.current) return;
    
    const elapsedTime = pauseOffsetRef.current + (audioContextRef.current.currentTime - playbackStartTimeRef.current);
    setCurrentTime(Math.min(elapsedTime, totalDuration));

    const newWordIndex = wordTimings.findIndex(timing => elapsedTime >= timing.start && elapsedTime < timing.end);
    if(newWordIndex !== -1) {
        setCurrentWordIndex(newWordIndex);
    }

    animationFrameIdRef.current = requestAnimationFrame(updateProgress);
  }, [totalDuration, wordTimings]);

  const play = useCallback(async (resumeTime = 0) => {
    if (!audioContextRef.current || audioChunks.length === 0) return;

    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    } else {
      stopPlayback(false);

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

      let nextStartTime = 0;
      for (let i = startChunkIndex; i < audioChunks.length; i++) {
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioChunks[i];
        source.connect(audioContextRef.current.destination);
        const startTime = (i === startChunkIndex) ? startChunkOffset : 0;
        source.start(nextStartTime, startTime);
        nextStartTime += audioChunks[i].duration - startTime;
        audioSourcesRef.current.push(source);
      }
      
      if(audioSourcesRef.current.length > 0) {
        audioSourcesRef.current[audioSourcesRef.current.length - 1].onended = () => {
            stopPlayback();
            resetGeneration();
        };
      }
    }
    
    playbackStartTimeRef.current = audioContextRef.current.currentTime;
    pauseOffsetRef.current = resumeTime;
    setIsPlaying(true);
    animationFrameIdRef.current = requestAnimationFrame(updateProgress);

  }, [audioChunks, stopPlayback, resetGeneration, updateProgress]);

  const pause = useCallback(async () => {
    if (!audioContextRef.current) return;
    
    pauseOffsetRef.current += (audioContextRef.current.currentTime - playbackStartTimeRef.current);
    await audioContextRef.current.suspend();
    
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const handlePlayPause = () => { isPlaying ? pause() : play(pauseOffsetRef.current); };

  const onProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isGenerated || totalDuration === 0) return;
    const progressBar = e.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = progressBar.offsetWidth;
    const percentage = clickX / width;
    const newTime = totalDuration * percentage;
    play(newTime);
  };
  
  const progressPercentage = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-2xl bg-gray-800 rounded-2xl shadow-2xl p-6 md:p-8 space-y-6 transform transition-all duration-500">
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold text-cyan-400">Text to Audio Converter</h1>
          <p className="text-gray-400 mt-2">Powered by Google Gemini</p>
        </div>
        
        <div className="space-y-4">
            {!isGenerated ? (
                <textarea
                    value={text}
                    onChange={(e) => onTextChanged(e.target.value)}
                    placeholder="Enter text here..."
                    className="w-full h-40 p-4 bg-gray-700 border-2 border-gray-600 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition duration-300 text-white resize-none"
                    rows={5}
                />
            ) : (
                <div className="w-full h-40 p-4 bg-gray-700 border-2 border-gray-600 rounded-lg overflow-y-auto">
                    <p className="text-white leading-relaxed">
                        {words.map((word, index) => (
                            <span key={index} className={`transition-colors duration-200 ${index === currentWordIndex ? 'bg-cyan-600 text-white rounded' : ''}`}>
                                {word}{' '}
                            </span>
                        ))}
                    </p>
                </div>
            )}
        </div>
        
        {isGenerated && (
            <div className="space-y-2">
                <div 
                    className="w-full bg-gray-700 rounded-full h-2.5 cursor-pointer"
                    onClick={onProgressClick}
                >
                    <div 
                        className="bg-cyan-500 h-2.5 rounded-full" 
                        style={{ width: `${progressPercentage}%` }}
                    ></div>
                </div>
                <div className="text-xs text-gray-400 flex justify-between">
                    <span>{new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
                    <span>{new Date(totalDuration * 1000).toISOString().substr(14, 5)}</span>
                </div>
            </div>
        )}

        <div className="space-y-4">
            <label htmlFor="voice-select" className="block text-sm font-medium text-gray-300">Select Voice</label>
            <select
              id="voice-select"
              value={selectedVoice}
              onChange={(e) => setSelectedVoice(e.target.value)}
              className="w-full p-3 bg-gray-700 border-2 border-gray-600 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition duration-300 text-white"
            >
              {VOICES.map((voice) => (
                <option key={voice.value} value={voice.value}>{voice.label}</option>
              ))}
            </select>
        </div>

        {error && (
          <div className="bg-red-900/50 text-red-300 p-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <button
            onClick={handleGenerateAudio}
            disabled={isLoading || !text.trim() || isGenerated}
            className="w-full sm:w-auto flex-grow justify-center items-center px-6 py-3 bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-lg transition-all duration-300 transform hover:scale-105 flex gap-2"
          >
            {isLoading ? <LoadingSpinner /> : <SpeakerIcon />}
            {isLoading ? 'Generating...' : isGenerated ? 'Generated' : 'Generate Audio'}
          </button>
          
          {isGenerated && (
            <button
              onClick={handlePlayPause}
              className="w-full sm:w-auto px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow-lg transition-all duration-300 transform hover:scale-105 flex gap-2 justify-center items-center"
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          )}
        </div>
      </div>
       <footer className="text-center text-gray-500 mt-8">
        <p>Built by a world-class senior frontend React engineer.</p>
      </footer>
    </div>
  );
};

export default App;
