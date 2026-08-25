import { useCallback, useEffect, useRef, useState } from "react";

// Speech-to-text via the browser's built-in Web Speech API (no key, on-device
// where supported). This makes the interaction voice-driven and natural, which
// suits the target population far better than typing — and, unlike text, speech
// also carries prosody (pitch, pace, energy) that a future acoustic-analysis
// channel could fuse alongside the facial-emotion signal.
export default function useSpeechRecognition({ onFinal, lang = "en-US" } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const onFinalRef = useRef(onFinal);
  // Holds the most recent interim transcript so we can commit it if the
  // session ends without ever emitting a `final` result (common in Chrome
  // when the user stops manually).
  const lastInterimRef = useRef("");

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const SpeechRecognition =
    typeof window !== "undefined" &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);
  const supported = Boolean(SpeechRecognition);

  useEffect(() => {
    if (!supported) return undefined;

    const recognition = new SpeechRecognition();
    recognition.continuous = false; // one utterance per press
    recognition.interimResults = true; // show live partial transcript
    recognition.lang = lang;

    recognition.onresult = (event) => {
      let interimText = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      setInterim(interimText);
      lastInterimRef.current = interimText;
      if (finalText.trim()) {
        lastInterimRef.current = ""; // consumed as a real final result
        setInterim("");
        onFinalRef.current?.(finalText.trim());
      }
    };

    let startedAt = 0;
    recognition.onstart = () => {
      startedAt = performance.now();
      console.log("[speech] recognition started");
    };

    // Diagnostic lifecycle events — these tell us where the audio pipeline
    // dies when nothing is transcribed.
    recognition.onaudiostart = () => console.log("[speech] audiostart (mic is open)");
    recognition.onsoundstart = () => console.log("[speech] soundstart (sound detected)");
    recognition.onspeechstart = () => console.log("[speech] speechstart (speech detected)");
    recognition.onspeechend = () => console.log("[speech] speechend");
    recognition.onaudioend = () => console.log("[speech] audioend (mic closed)");
    recognition.onnomatch = () => console.log("[speech] nomatch (heard audio, no match)");

    recognition.onerror = (event) => {
      console.warn("[speech] error:", event?.error, event);
      setError(event?.error || "speech-recognition-error");
      setIsListening(false);
    };

    recognition.onend = () => {
      const ms = startedAt ? Math.round(performance.now() - startedAt) : 0;
      console.log(`[speech] recognition ended after ${ms}ms`);
      // Fallback: if speech was captured but no final result was emitted
      // (e.g. the user stopped manually), commit the last interim text.
      const leftover = lastInterimRef.current.trim();
      lastInterimRef.current = "";
      if (leftover) {
        console.log("[speech] committing interim on end:", leftover);
        onFinalRef.current?.(leftover);
      }
      setIsListening(false);
      setInterim("");
    };

    recognitionRef.current = recognition;
    return () => {
      try {
        recognition.abort();
      } catch {
        // ignore teardown errors
      }
      recognitionRef.current = null;
    };
  }, [SpeechRecognition, supported, lang]);

  const start = useCallback(() => {
    if (!recognitionRef.current || isListening) return;
    setError(null);
    setInterim("");
    lastInterimRef.current = "";

    // Probe the mic directly so we can distinguish a device/permission
    // problem from a speech-service problem in the console.
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const track = stream.getAudioTracks()[0];
          console.log(
            "[speech] mic probe OK:",
            track?.label || "(no label)",
            "muted:",
            track?.muted,
            "enabled:",
            track?.enabled,
          );
          // Release the probe stream so it doesn't hold the device.
          stream.getTracks().forEach((t) => t.stop());
        })
        .catch((e) => console.warn("[speech] mic probe FAILED:", e?.name, e?.message));
    }
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "microphone" })
        .then((p) => console.log("[speech] mic permission:", p.state))
        .catch(() => {});
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      // start() throws if called while already active.
      console.warn("[speech] start() failed:", err);
      setError(err?.message || "start-failed");
    }
  }, [isListening]);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return { supported, isListening, interim, error, start, stop, toggle };
}
