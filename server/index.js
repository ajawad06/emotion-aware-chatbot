const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const {
  logMessage,
  getRecentMessages,
  getEmotionStats,
  getConversations,
  deleteConversation,
  hasTitle,
  setTitle,
} = require("./db");

const envPath = path.resolve(__dirname, "../.env");
dotenv.config({ path: envPath });

const app = express();

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

const VOICE_ID = "onwK4e9ZLuTAKqWW03F9"; // Daniel - professional male voice
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_CHAT_MODEL = "openai/gpt-oss-120b"; // main conversation (quality)
const GROQ_TITLE_MODEL = "openai/gpt-oss-20b"; // fast, cheap titles

// Shared Groq (OpenAI-compatible) chat-completions call. Returns the
// assistant's text, throws on a non-OK response.
async function callGroq({
  messages,
  model,
  temperature = 0.7,
  max_tokens = 1024,
  reasoning_effort,
}) {
  // gpt-oss are reasoning models; reasoning tokens count toward max_tokens,
  // so keep budgets generous and use low effort where speed matters.
  const body = { model, temperature, max_tokens, messages };
  if (reasoning_effort) body.reasoning_effort = reasoning_effort;

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(
      `Groq request failed (${resp.status}): ${detail.slice(0, 300)}`,
    );
  }

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// Generate a short chat title from the user's first message using Groq.
// Falls back to a trimmed copy of the message if the request fails.
async function generateChatTitle(userText) {
  const fallback = String(userText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);

  if (!process.env.GROQ_API_KEY) return fallback;

  try {
    const raw = await callGroq({
      model: GROQ_TITLE_MODEL,
      temperature: 0.3,
      max_tokens: 128,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content:
            "You write very short chat titles. Given the user's first message, reply with ONLY a 2-5 word title in Title Case that captures the topic. No quotes, no trailing punctuation, no preamble.",
        },
        { role: "user", content: String(userText || "").slice(0, 500) },
      ],
    });
    const title = raw
      ?.trim()
      ?.replace(/^["']|["']$/g, "")
      ?.replace(/[.]+$/, "");
    return title ? title.slice(0, 60) : fallback;
  } catch {
    return fallback;
  }
}

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

// Convert chat history + system prompt to OpenAI/Groq message format.
function toGroqMessages(messages, systemPrompt) {
  const turns = (Array.isArray(messages) ? messages : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string",
    )
    .map((m) => ({ role: m.role, content: m.content }));

  return [{ role: "system", content: systemPrompt }, ...turns];
}

// Chat endpoint: generates emotion-aware responses using Groq
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, systemPrompt, emotion, sessionId } = req.body || {};

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({ error: "Missing GROQ_API_KEY in .env" });
    }
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "`messages` must be an array" });
    }
    if (typeof systemPrompt !== "string") {
      return res.status(400).json({ error: "`systemPrompt` must be a string" });
    }

    const lastMessage = messages[messages.length - 1];
    let firstUserText = null;
    if (lastMessage && lastMessage.role === "user") {
      // Keep the original (untagged) text for title generation.
      firstUserText = lastMessage.content;

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

    const text = await callGroq({
      model: GROQ_CHAT_MODEL,
      temperature: 0.7,
      max_tokens: 1024,
      reasoning_effort: "low",
      messages: toGroqMessages(messages, systemPrompt),
    });

    // Persist the assistant's reply so the full conversation is durable.
    logMessage({ sessionId, role: "assistant", content: text });

    // First message of a new chat → generate a concise title (Groq).
    if (sessionId && firstUserText && !hasTitle(sessionId)) {
      const title = await generateChatTitle(firstUserText);
      setTitle(sessionId, title);
    }

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

// List saved conversations for the sidebar (id, title, last activity, count).
app.get("/api/conversations", (req, res) => {
  try {
    return res.json({ conversations: getConversations() });
  } catch (err) {
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

// Delete a conversation (its messages + title).
app.delete("/api/conversations/:id", (req, res) => {
  try {
    deleteConversation(req.params.id);
    return res.json({ ok: true });
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
