
import { GoogleGenAI, Modality } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export const generateSpeechStream = async (
  text: string,
  voice: string,
  tone: string,
  onAudioChunk: (chunk: string) => void,
  onStreamEnd: () => void,
  onError: (error: Error) => void
): Promise<void> => {
  try {
    const response = await ai.models.generateContentStream({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `Say ${tone}: ${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voice },
          },
        },
      },
    });

    for await (const chunk of response) {
      const base64Audio = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        onAudioChunk(base64Audio);
      }
    }
    onStreamEnd();
  } catch (error) {
    console.error("Error generating speech with Gemini API:", error);
    if (error instanceof Error) {
        onError(error);
    } else {
        onError(new Error('An unknown error occurred during speech generation.'));
    }
  }
};
