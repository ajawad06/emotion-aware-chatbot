import { useState } from 'react'
import useSpeechRecognition from '../hooks/useSpeechRecognition.js'

export default function ChatInput({ onSend, disabled }) {
  const [text, setText] = useState('')

  // Voice input: final transcript is appended to the field so the user can
  // review (and edit) before sending, rather than auto-firing.
  const { supported, isListening, interim, error, toggle } = useSpeechRecognition({
    onFinal: (transcript) => {
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript))
    },
  })

  // Human-readable hint for the common Web Speech API failure modes.
  const micHint = !supported
    ? 'Voice input needs Chrome or Edge (not supported in this browser).'
    : error === 'not-allowed' || error === 'service-not-allowed'
      ? 'Microphone blocked — allow mic access for this site and retry.'
      : error === 'no-speech'
        ? "Didn't catch that — try speaking again."
        : error === 'network'
          ? 'Speech service unreachable — check your connection.'
          : error
            ? `Voice input error: ${error}`
            : ''

  function handleSubmit(e) {
    e.preventDefault()
    if (disabled) return

    const trimmed = text.trim()
    if (!trimmed) return

    onSend(trimmed)
    setText('')
  }

  // While listening, show the live partial transcript as a preview without
  // overwriting what the user has already typed/committed.
  const displayValue =
    isListening && interim ? `${text ? `${text} ` : ''}${interim}` : text

  return (
    <div className="chat-input-wrap">
      <form className="chat-input" onSubmit={handleSubmit}>
        <button
          type="button"
          className={`chat-mic-button${isListening ? ' listening' : ''}`}
          onClick={toggle}
          disabled={disabled || !supported}
          aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
          title={
            !supported
              ? 'Voice input not supported in this browser'
              : isListening
                ? 'Stop listening'
                : 'Speak your message'
          }
        >
          {isListening ? '⏺️' : '🎤'}
        </button>
        <input
          className="chat-input-field"
          type="text"
          value={displayValue}
          onChange={(e) => setText(e.target.value)}
          placeholder={isListening ? 'Listening…' : 'Type or speak your message…'}
          disabled={disabled}
          aria-label="Message input"
        />
        <button className="chat-send-button" type="submit" disabled={disabled || !text.trim()}>
          {disabled ? 'Thinking…' : 'Send'}
        </button>
      </form>
      {micHint && <div className="chat-mic-hint">{micHint}</div>}
    </div>
  )
}
