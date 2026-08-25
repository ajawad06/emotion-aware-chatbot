# 🎭 Emotion Chat

> An emotion-aware chat assistant that reads your face and responds accordingly.

Emotion Chat is a real-time web application that detects your facial expression through your webcam, then uses that emotional context to generate more empathetic and relevant AI responses — complete with emotion-matched voice output and a reactive animated avatar.

---

## Demo

🔗 Demo Video: [Youtube Link](https://www.youtube.com/watch?v=qxu1Bnkxogo)

## ✨ Features

- **Live Emotion Detection** — Uses your webcam and face-api.js to detect 7 emotions in real time: happy, sad, angry, fearful, disgusted, surprised, and neutral
- **Emotion-Aware AI Responses** — Detected emotion is injected into the prompt sent to Google Gemini, so the AI acknowledges how you're feeling before answering
- **Emotion-Matched Voice** — Text-to-speech via ElevenLabs adjusts voice tone and style based on your emotion, with a browser speech fallback
- **Reactive Avatar** — An animated canvas avatar changes its expression and mouth movement to match the current emotion and speaking state
- **Conversation Memory** — Maintains short-term chat history so the AI can follow context across messages

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Express (Node.js) |
| Emotion Detection | face-api.js |
| AI / Chat | Google Gemini (`gemini-2.5-flash`) |
| Text-to-Speech | ElevenLabs API |
| Avatar | HTML Canvas (custom) |

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- A Google Gemini API key
- An ElevenLabs API key

### Installation

```bash
git clone https://github.com/Fasih-ulislam/emotionally-aware-chatbot
cd emotion-chat
npm install
```

### Environment Variables

Create a `.env` file in the root directory:

```env
GEMINI_API_KEY=your_gemini_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
```

### Running the App

```bash
npm run dev
```

This starts both the Vite frontend and the Express backend concurrently. Open your browser at `http://localhost:5173`. The backend runs on port `3001`.

> Make sure to allow webcam access when prompted — emotion detection won't work without it.

---

## 📁 Project Structure

```
emotion-chat/
├── server/
│   └── index.js          # Express backend — /api/chat and /api/speak
├── src/
│   ├── components/
│   │   ├── Avatar.jsx         # Animated canvas avatar
│   │   ├── ChatInput.jsx      # Message input field
│   │   ├── ChatWindow.jsx     # Conversation display
│   │   ├── EmotionDetector.jsx # Webcam + face-api integration
│   │   └── MessageBubble.jsx  # Individual chat message
│   ├── hooks/
│   │   ├── useEmotion.js      # Emotion detection logic
│   │   └── useSpeech.js       # TTS playback logic
│   ├── utils/
│   │   └── buildPrompt.js     # Constructs Gemini system prompt from emotion
│   └── App.jsx                # Main app orchestration
└── public/
    └── models/                # face-api.js model weights
```

---

## 🔄 How It Works

1. The webcam runs continuously, analyzing your face every ~500ms
2. The top detected emotion and confidence score are tracked in state
3. When you send a message, `buildPrompt.js` constructs a system prompt that includes your emotion, confidence level, and tone guidelines
4. The prompt + chat history are sent to the Express backend
5. The backend calls Google Gemini and returns an emotionally aware response
6. The response text is sent to ElevenLabs for voice synthesis with emotion-adjusted settings
7. The avatar animates its expression and lip movement while audio plays

---

## 👥 Authors

- **Muhammad Fasih Ul Islam** (502518)
- **Abdullah Jawad** (502038)

BSCS-14-D — SEECS, NUST  
Theory of Automata and Formal Languages — Fall 2025

---

## 📄 License

This project was built as a semester project and is intended for educational use.
