import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import ChatInput from "./components/ChatInput.jsx";
import ChatWindow from "./components/ChatWindow.jsx";
import EmotionDetector from "./components/EmotionDetector.jsx";
import Avatar from "./components/Avatar.jsx";
import { buildSystemPrompt } from "./utils/buildPrompt.js";
import useSpeech from "./hooks/useSpeech.js";

const GREETING = {
  role: "assistant",
  content:
    "Hi there! I'm your emotionally intelligent assistant. I can see how you're feeling through your camera and I'll do my best to respond in a way that suits your mood. Feel free to share whatever's on your mind. I'm here to listen and help.",
  emotion: null,
};

// Stable per-browser session id so the conversation persists across reloads.
function getSessionId() {
  let id = localStorage.getItem("adina_session_id");
  if (!id) {
    id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("adina_session_id", id);
  }
  return id;
}

// Main app component - coordinates emotion detection, chat, and audio response
export default function App() {
  const { speak, stop, isSpeaking } = useSpeech();
  const sessionId = useMemo(getSessionId, []);
  const [messages, setMessages] = useState([GREETING]);

  // Restore prior conversation from the server on startup so the avatar
  // "remembers" earlier sessions. Falls back to the greeting if empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(
          `http://localhost:3001/api/history?sessionId=${encodeURIComponent(sessionId)}&limit=100`,
        );
        if (!resp.ok) return;
        const data = await resp.json();
        if (!cancelled && Array.isArray(data.messages) && data.messages.length) {
          setMessages([
            GREETING,
            ...data.messages.map((m) => ({
              role: m.role,
              content: m.content,
              emotion: m.emotion ?? null,
            })),
          ]);
        }
      } catch {
        // Offline / server not up yet — keep the default greeting.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  const [currentEmotion, setCurrentEmotion] = useState({
    emotion: "neutral",
    confidence: 0,
  });

  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState(null);

  const handleEmotionChange = useCallback((next) => {
    // Update current user emotion detected from webcam
    setCurrentEmotion(next);
  }, []);

  // Handle sending user message to chat API with emotion context
  async function handleSend(userText) {
    if (isWaiting) return;

    setError(null);
    setIsWaiting(true);

    const userEmotion = currentEmotion.emotion || "neutral";
    const userConfidence = currentEmotion.confidence || 0;

    // Store user message with detected emotion
    const newUserMessage = {
      role: "user",
      content: userText,
      emotion: userEmotion,
    };

    const historyForRequest = [
      ...messages,
      { role: "user", content: userText },
    ];

    setMessages((prev) => [...prev, newUserMessage]);

    try {
      // Build system prompt that instructs model to respond to detected emotion
      const systemPrompt = buildSystemPrompt(userEmotion, userConfidence);

      // Send conversation context and emotion to backend
      const resp = await fetch("http://localhost:3001/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyForRequest,
          systemPrompt,
          emotion: { label: userEmotion, score: userConfidence },
          sessionId,
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data?.error || data?.message || "Chat request failed.");
      }

      const assistantText = typeof data?.text === "string" ? data.text : "";

      // Play assistant response with emotion-aware voice
      speak(assistantText, userEmotion);

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: assistantText,
          emotion: null,
        },
      ]);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setIsWaiting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="chat-card">
        <header className="app-header">
          <div className="app-title">
            Emotion-aware chat
            {isSpeaking && <span className="speaking-badge">🔊</span>}
          </div>
          <div className="app-subtitle">
            Your assistant adapts tone based on detected emotion.
            {isSpeaking && (
              <button className="stop-btn" onClick={stop} type="button">
                ⏹️ Stop
              </button>
            )}
          </div>
        </header>

        <div className="main-content">
          <div className="chat-section">
            <ChatWindow messages={messages} />
            {error && <div className="chat-error">{error}</div>}
            <ChatInput onSend={handleSend} disabled={isWaiting} />
          </div>

          <div className="right-panel">
            <Avatar emotion={currentEmotion.emotion} isSpeaking={isSpeaking} />
            <EmotionDetector onEmotionChange={handleEmotionChange} />
          </div>
        </div>
      </div>
    </div>
  );
}
