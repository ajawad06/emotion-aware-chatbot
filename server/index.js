const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const dotenv = require("dotenv");
const path = require("path");
const { logMessage, getRecentMessages, getEmotionStats } = require("./db");

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

const app = express();

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

const GEMINI_MODEL = "gemini-2.5-flash";
const VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // Daniel - professional male voice

// Return emotion-adjusted voice settings for ElevenLabs TTS
function getVoiceSettings(emotion) {
  const baseSettings = {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.5,
    use_speaker_boost: true,
  };

  const emotionAdjustments = {
    happy: {
      stability: 0.4,
      style: 0.7,
    },
    sad: {
      stability: 0.7,
      style: 0.2,
    },
    angry: {
      stability: 0.3,
      style: 0.8,
    },
    fearful: {
      stability: 0.5,
      style: 0.6,
    },
    disgusted: {
      stability: 0.6,
      style: 0.4,
    },
    surprised: {
      stability: 0.35,
      style: 0.75,
    },
    neutral: {
      stability: 0.5,
      style: 0.5,
    },
  };

  const adjustments = emotionAdjustments[emotion] || emotionAdjustments.neutral;

  return {
    ...baseSettings,
    ...adjustments,
  };
}

// Text-to-speech endpoint: converts text to emotion-aware audio via ElevenLabs
app.post("/api/speak", async (req, res) => {
  try {
    const { text, emotion = "neutral" } = req.body;

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    if (!process.env.ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY" });
    }

    const voiceSettings = getVoiceSettings(emotion);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: voiceSettings,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        error: "TTS request failed",
        details: errorText,
      });
    }

    const audioBuffer = await response.arrayBuffer();

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.byteLength,
    });

    res.send(Buffer.from(audioBuffer));
  } catch (err) {
    res.status(500).json({
      error: "Failed to generate speech",
      message: err.message,
    });
  }
});

// Convert chat message history to Gemini API format
function toGeminiHistory(messages) {
  const filtered = Array.isArray(messages)
    ? messages.filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
    : [];

  const history = filtered.map((m) => {
    if (m.role === "user") {
      return { role: "user", parts: [{ text: m.content }] };
    }
    return { role: "model", parts: [{ text: m.content }] };
  });

  if (history.length === 0) {
    return [{ role: "user", parts: [{ text: "" }] }];
  }
  if (history[0].role !== "user") {
    history.unshift({ role: "user", parts: [{ text: "" }] });
  }

  return history;
}

// Chat endpoint: generates emotion-aware responses using Gemini
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, systemPrompt, emotion, sessionId } = req.body || {};

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Missing GEMINI_API_KEY in .env" });
    }
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "`messages` must be an array" });
    }
    if (typeof systemPrompt !== "string") {
      return res.status(400).json({ error: "`systemPrompt` must be a string" });
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === "user") {
      // Persist the user's turn with the emotion detected at send time,
      // before we wrap the content with the model-facing emotion tag.
      logMessage({
        sessionId,
        role: "user",
        content: lastMessage.content,
        emotion: emotion?.label,
        confidence: emotion?.score,
      });

      if (emotion) {
        lastMessage.content = `
    [USER_TEXT]: ${lastMessage.content}
    [USER_FACIAL_EXPRESSION]: ${emotion.label} (Confidence: ${emotion.score})
  `.trim();
      }
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent({
      contents: toGeminiHistory(messages),
    });

    const text = result?.response?.text?.() || "";

    // Persist the assistant's reply so the full conversation is durable.
    logMessage({ sessionId, role: "assistant", content: text });

    return res.json({ text });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || String(err),
    });
  }
});

// Return recent conversation history so the client can restore prior
// sessions on startup (the avatar "remembers" earlier conversations).
app.get("/api/history", (req, res) => {
  try {
    const sessionId = req.query.sessionId || "default";
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const messages = getRecentMessages(sessionId, limit).map((m) => ({
      role: m.role,
      content: m.content,
      emotion: m.emotion,
      confidence: m.confidence,
      ts: m.ts,
    }));
    return res.json({ messages });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

// Aggregate psychosocial metrics (emotion distribution + timeline) —
// the raw material for the long-term analytics conveyed to care staff.
app.get("/api/stats", (req, res) => {
  try {
    const sessionId = req.query.sessionId || null;
    return res.json(getEmotionStats(sessionId));
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

// Start server on port 3001
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
