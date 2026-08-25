import { useCallback, useEffect, useState } from "react";
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

const API = "http://localhost:3001";

// Fresh id for each conversation (one "chat" in the sidebar).
function newConversationId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `chat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

// Compact relative time for the sidebar ("2h", "3d", "Just now").
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Main app component - coordinates emotion detection, chat, and audio response
export default function App() {
  const { speak, stop, isSpeaking } = useSpeech();

  // Every load starts a brand-new chat; past chats live in the sidebar.
  const [conversationId, setConversationId] = useState(newConversationId);
  const [messages, setMessages] = useState([GREETING]);
  const [conversations, setConversations] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [currentEmotion, setCurrentEmotion] = useState({
    emotion: "neutral",
    confidence: 0,
  });

  const [isWaiting, setIsWaiting] = useState(false);
  const [error, setError] = useState(null);

  // Refresh the list of past conversations shown in the sidebar.
  const loadConversations = useCallback(async () => {
    try {
      const resp = await fetch(`${API}/api/conversations`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (Array.isArray(data.conversations)) setConversations(data.conversations);
    } catch {
      // Server not up yet — leave the sidebar empty.
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Start a fresh, empty chat.
  const handleNewChat = useCallback(() => {
    setConversationId(newConversationId());
    setMessages([GREETING]);
    setError(null);
    setSidebarOpen(false);
  }, []);

  // Open a previous chat from the sidebar.
  const handleSelectConversation = useCallback(async (id) => {
    setError(null);
    setSidebarOpen(false);
    try {
      const resp = await fetch(
        `${API}/api/history?sessionId=${encodeURIComponent(id)}&limit=200`,
      );
      if (!resp.ok) return;
      const data = await resp.json();
      setConversationId(id);
      setMessages([
        GREETING,
        ...(data.messages || []).map((m) => ({
          role: m.role,
          content: m.content,
          emotion: m.emotion ?? null,
        })),
      ]);
    } catch {
      setError("Couldn't load that conversation.");
    }
  }, []);

  // Delete a past chat; if it's the one open, drop into a fresh chat.
  const handleDeleteConversation = useCallback(
    async (id, e) => {
      e.stopPropagation();
      try {
        await fetch(`${API}/api/conversations/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch {
        // ignore network error; still remove from the list optimistically
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === conversationId) {
        setConversationId(newConversationId());
        setMessages([GREETING]);
      }
    },
    [conversationId],
  );

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
      const resp = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyForRequest,
          systemPrompt,
          emotion: { label: userEmotion, score: userConfidence },
          sessionId: conversationId,
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

      // Reflect the new/updated chat in the sidebar.
      loadConversations();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setIsWaiting(false);
    }
  }

  const moodLabel = currentEmotion.emotion || "neutral";

  return (
    <div
      className={`app-shell${isSpeaking ? " is-speaking" : ""}`}
      data-emotion={moodLabel}
      style={{ "--emotion-strength": currentEmotion.confidence || 0 }}
    >
      <div className="chat-card">
        <header className="app-header">
          <div className="brand">
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Toggle chat history"
              type="button"
            >
              <span />
              <span />
              <span />
            </button>
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" width="22" height="22">
                <circle cx="12" cy="12" r="2.4" fill="#2a1e08" />
                <circle
                  cx="12"
                  cy="12"
                  r="5.6"
                  stroke="#2a1e08"
                  strokeWidth="1.7"
                  opacity="0.85"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="9"
                  stroke="#2a1e08"
                  strokeWidth="1.4"
                  opacity="0.4"
                />
              </svg>
            </div>
            <div className="brand-text">
              <span className="app-title">
                Sera
                {isSpeaking && <span className="speaking-badge"> 🔊</span>}
              </span>
              <span className="app-subtitle">
                Senses how you feel, and responds in kind.
              </span>
            </div>
          </div>

          <div className="header-actions">
            {isSpeaking && (
              <button className="stop-btn" onClick={stop} type="button">
                Stop voice
              </button>
            )}
            <span className="mood-chip" title="Detected emotion">
              <span className="mood-dot" />
              <span className="mood-label">feeling</span>
              {moodLabel}
            </span>
          </div>
        </header>

        <div className="main-content">
          <aside className={`chat-sidebar${sidebarOpen ? " open" : ""}`}>
            <button
              className="new-chat-btn"
              onClick={handleNewChat}
              type="button"
            >
              <span className="new-chat-plus">+</span> New chat
            </button>
            <div className="sidebar-heading">Recent chats</div>
            <div className="conversation-list">
              {conversations.length === 0 ? (
                <p className="sidebar-empty">
                  Your past chats will appear here.
                </p>
              ) : (
                conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`conversation-item${
                      c.id === conversationId ? " active" : ""
                    }`}
                  >
                    <button
                      className="conversation-open"
                      onClick={() => handleSelectConversation(c.id)}
                      type="button"
                      title={c.title || "New chat"}
                    >
                      <span className="conversation-title">
                        {c.title || "New chat"}
                      </span>
                      <span className="conversation-time">
                        {timeAgo(c.lastTs)}
                      </span>
                    </button>
                    <button
                      className="conversation-delete"
                      onClick={(e) => handleDeleteConversation(c.id, e)}
                      type="button"
                      title="Delete chat"
                      aria-label="Delete chat"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>

          {sidebarOpen && (
            <div
              className="sidebar-scrim"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          <div className="chat-section">
            <ChatWindow messages={messages} />
            {error && <div className="chat-error">{error}</div>}
            <ChatInput onSend={handleSend} disabled={isWaiting} />
          </div>

          <div className="right-panel">
            <div className="avatar-tile">
              <div className="tile-label">
                <span className="mood-dot" />
                Sera
              </div>
              <Avatar emotion={currentEmotion.emotion} isSpeaking={isSpeaking} />
            </div>
            <div className="webcam-tile">
              <div className="tile-label">You</div>
              <EmotionDetector onEmotionChange={handleEmotionChange} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
