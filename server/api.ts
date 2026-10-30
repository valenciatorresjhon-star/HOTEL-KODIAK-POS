import { Router, Request, Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

export const apiRouter = Router();

// Lazy initialization of GoogleGenAI to ensure we don't crash if the key is missing on startup
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set. Please add it in Settings > Secrets.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

apiRouter.get('/health', (req: Request, res: Response): void => {
  res.json({
    hasApiKey: !!process.env.GEMINI_API_KEY,
  });
});

apiRouter.post('/gemini/generate', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      prompt,
      systemInstruction,
      temperature,
      topP,
      topK,
      responseSchema,
      responseMimeType,
      model = 'gemini-3.5-flash',
    } = req.body;

    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required' });
      return;
    }

    const ai = getGeminiClient();

    // Prepare configuration
    const config: any = {};

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    if (typeof temperature === 'number') {
      config.temperature = temperature;
    }
    if (typeof topP === 'number') {
      config.topP = topP;
    }
    if (typeof topK === 'number') {
      config.topK = topK;
    }
    if (responseMimeType) {
      config.responseMimeType = responseMimeType;
    }
    if (responseSchema && responseMimeType === 'application/json') {
      config.responseSchema = responseSchema;
    }

    const startTime = Date.now();
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config,
    });
    const duration = Date.now() - startTime;

    const text = response.text;

    res.json({
      text,
      duration,
      model,
      config: {
        systemInstruction,
        temperature,
        topP,
        topK,
        responseMimeType,
        responseSchema,
      },
    });
  } catch (error: any) {
    console.error('Gemini API Error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred while generating content from Gemini',
    });
  }
});
