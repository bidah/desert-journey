"use client";

import { ReactorView } from "@reactor-team/js-sdk";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { OrbisShell, type JwtHandles } from "@/components/orbis-shell";
import { StoryChoices } from "@/components/story-panel";
import { useFirstFrame } from "@/hooks/use-first-frame";
import { useOrbisSession } from "@/hooks/use-orbis-session";
import { useStoryRunner, type StoryStream } from "@/hooks/use-story-runner";
import { readStory, type Story } from "@/lib/story";

// The deployed site streams the intro from R2 (it is over Pages' 25 MiB limit).
const INTRO_VIDEO =
  process.env.NEXT_PUBLIC_INTRO_VIDEO_URL || "/droid/intro.mp4";
// Fills the screen behind "Start journey", until the intro starts.
const START_BACKDROP = "/droid/desert-backdrop.jpg";
// The soundtrack for the journey; starts with the stream's first frame.
const SONG = "/droid/golden-dunes.mp3";
const STORY_DIR = "/examples/desert-journey-still";
// The ending: the closing text shows this long, then the live stream plays on
// with the song for this long (the song fading out over the last few
// seconds), and then the stream closes.
const ENDING_TEXT_SECONDS = 15;
const ENDING_SONG_SECONDS = 10;
const SONG_FADE_SECONDS = 3;
const CONNECT_ATTEMPTS = 5;
const CONNECT_RETRY_MS = 3_000;
// Song volume while the character speaks, and otherwise.
const SONG_VOLUME = 1;
const SONG_DUCKED = 0.3;
// Defaults for the decision loop (an engine can override each):
// the character starts speaking this long before a scene's choices show...
const VOICE_LEAD_SECONDS = 2;
// ...the first line starts this long into the journey...
const FIRST_VOICE_SECONDS = 4;
// ...and the viewer has this long to choose before one is picked at random.
const AUTO_PICK_SECONDS = 15;
/** The live-video backend behind the droid stage (Orbis). */
type DroidEngine = StoryStream & {
  /** True once the engine can start the story. */
  ready: boolean;
  /** Called once the intro plays (and the start image is loaded). */
  connect: (startImage: File | null) => Promise<void>;
  disconnect: () => Promise<void>;
  error: string;
  /** Changes on every start, to re-arm first-frame detection. */
  runId: number;
  /** Start the story this long before the intro ends. */
  startLeadSeconds: number;
  /** Bridge cues closer than this would stack inside one generated chunk. */
  minCueGapSeconds: number;
  /** Overrides the story's extra wait before later choices show. */
  choiceDelaySeconds?: number;
  /** Overrides how long a scene's last cue holds before its choices show. */
  holdSeconds?: number;
  /** Overrides how long before the choices the character starts speaking. */
  voiceLeadSeconds?: number;
  /** Overrides how long after the first frame the first line starts. */
  firstVoiceSeconds?: number;
  /** Overrides how long the viewer has before a choice is picked at random. */
  autoPickSeconds?: number;
  /** The stream's video, full screen and muted (the song is the soundtrack). */
  view: ReactNode;
};

/** Reactor's Visko Orbis Stable. */
export function OrbisDroidExperience() {
  return (
    <OrbisShell>{(handles) => <OrbisDroid {...handles} />}</OrbisShell>
  );
}

/**
 * The account allows one Reactor session at a time; a session that is still
 * closing reports "quota exceeded", so retry a few times.
 */
async function connectWithRetries(session: {
  connectSession: () => Promise<boolean>;
  setError: (message: string) => void;
}) {
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    if (await session.connectSession()) {
      session.setError("");
      return true;
    }
    if (attempt < CONNECT_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
    }
  }
  return false;
}

/** The stream's video, full screen and muted (the song is the soundtrack). */
function ReactorStreamView() {
  return (
    <ReactorView
      track="main_video"
      audioTrack="main_audio"
      muted
      videoObjectFit="cover"
    />
  );
}

function OrbisDroid({ clearJwt, getCurrentJwt }: JwtHandles) {
  const session = useOrbisSession(clearJwt, getCurrentJwt);

  return (
    <DroidStage
      engine={{
        ...session,
        ready: session.connected,
        connect: async () => {
          await connectWithRetries(session);
        },
        disconnect: session.disconnectSession,
        startLeadSeconds: 5,
        minCueGapSeconds: 0,
        view: session.runStarted && <ReactorStreamView />,
      }}
    />
  );
}

/**
 * One of the character's lines for the current scene: preloaded as the scene
 * starts, and played when `cue` turns true, with the song lowered meanwhile.
 */
function useSpokenLine({
  ref,
  url,
  cue,
  node,
  songRef,
  muted,
  stopped,
}: {
  ref: RefObject<HTMLAudioElement | null>;
  url: string | undefined;
  cue: boolean;
  node: string | null;
  songRef: RefObject<HTMLAudioElement | null>;
  muted: boolean;
  stopped: boolean;
}) {
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    audio.pause();
    if (url) {
      audio.src = url;
      audio.load();
    } else {
      audio.removeAttribute("src");
    }
  }, [ref, url, node]);

  useEffect(() => {
    const audio = ref.current;
    const song = songRef.current;
    if (!audio || !url || !cue || stopped) return;
    const restore = () => {
      if (song) song.volume = SONG_VOLUME;
    };
    if (song) song.volume = SONG_DUCKED;
    audio.muted = muted;
    audio.currentTime = 0;
    audio.addEventListener("ended", restore, { once: true });
    void audio.play().catch(restore);
    return () => {
      audio.removeEventListener("ended", restore);
      restore();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue, url, stopped]);
}

/** The end of the story: the closing text, then the stream plays out, then done. */
type EndingPhase = "text" | "outro" | "done";

/**
 * Full-screen flow: the intro video autoplays; when it starts the engine
 * connects, shortly before it ends the Pixar desert story starts, and when the
 * story's first frame is on screen the intro layer is removed. When an ending
 * scene lands, its closing text shows where the choices would, then the screen
 * plays on while the song fades out, then the stream closes.
 */
function DroidStage({ engine }: { engine: DroidEngine }) {
  const [story, setStory] = useState<Story | null>(null);
  const [startImage, setStartImage] = useState<File | null>(null);
  const voiceLeadSeconds = engine.voiceLeadSeconds ?? VOICE_LEAD_SECONDS;
  const runner = useStoryRunner({
    session: engine,
    story,
    // Reactor prepares each prompt on the server, which lets the short,
    // change-only follow-ups carry over the rest of the scene.
    passthrough: false,
    firstChoicesSeconds:
      (engine.firstVoiceSeconds ?? FIRST_VOICE_SECONDS) + voiceLeadSeconds,
    voiceLeadSeconds,
  });

  const introRef = useRef<HTMLVideoElement>(null);
  const songRef = useRef<HTMLAudioElement>(null);
  const voiceRef = useRef<HTMLAudioElement>(null);
  const reactionRef = useRef<HTMLAudioElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(false);
  const [introPlaying, setIntroPlaying] = useState(false);
  const [introEnded, setIntroEnded] = useState(false);
  const [wantStart, setWantStart] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [endingPhase, setEndingPhase] = useState<EndingPhase | null>(null);
  const [introPaused, setIntroPaused] = useState(false);
  // Briefly shows the play/pause symbol after a click, then fades.
  const [flash, setFlash] = useState(0);
  const connectRequested = useRef(false);
  const startRequested = useRef(false);

  useFirstFrame(streamRef, engine.runStarted, engine.runId, runner.markFirstFrame);

  // Load the story and its start image up front.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [storyText, image] = await Promise.all([
          fetch(`${STORY_DIR}/story.json`).then((response) => response.text()),
          fetch(`${STORY_DIR}/first-frame.jpg`).then((response) => response.blob()),
        ]);
        if (cancelled) return;
        const loaded = readStory(storyText);
        setStory(
          loaded && {
            ...loaded,
            cueGapSeconds: Math.max(loaded.cueGapSeconds, engine.minCueGapSeconds),
            holdSeconds: engine.holdSeconds ?? loaded.holdSeconds,
            choiceDelaySeconds: engine.choiceDelaySeconds ?? loaded.choiceDelaySeconds,
            // The song is the soundtrack here, so the stream generates no audio.
            settings: { ...loaded.settings, audioEnabled: false, audioPrompt: "" },
          },
        );
        setStartImage(new File([image], "first-frame.jpg", { type: image.type }));
      } catch (caught) {
        engine.setError(
          `Could not load the story: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browsers only allow sound after the viewer interacts with the page, so the
  // intro waits for a "Start journey" click and then plays with sound. If
  // sound is still refused, play muted and offer a sound button.
  const [begun, setBegun] = useState(false);
  const begin = () => {
    const video = introRef.current;
    setBegun(true);
    if (!video) return;
    video.muted = false;
    setMuted(false);
    video.play().catch(() => {
      video.muted = true;
      setMuted(true);
      setSoundBlocked(true);
      // Even muted playback can be blocked: show the play button then.
      void video.play().catch(() => setIntroPaused(true));
    });
  };

  // Connect once the intro is playing and the start image has loaded.
  useEffect(() => {
    if (!introPlaying || !startImage || connectRequested.current) return;
    connectRequested.current = true;
    void engine.connect(startImage);
  }, [introPlaying, startImage, engine]);

  const onIntroTime = () => {
    const video = introRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    if (video.duration - video.currentTime <= engine.startLeadSeconds) {
      setWantStart(true);
    }
  };

  // Start once it's time and everything is ready (connect can finish late).
  useEffect(() => {
    if (!wantStart || startRequested.current || stopped) return;
    if (!engine.ready || !story || engine.runStarted) return;
    startRequested.current = true;
    void runner.begin(startImage);
  }, [wantStart, engine.ready, engine.runStarted, story, startImage, stopped, runner]);

  const live = runner.playing;

  const enableSound = () => {
    const video = introRef.current;
    if (video) video.muted = false;
    const song = songRef.current;
    if (song) {
      song.muted = false;
      if (live && song.paused) void song.play().catch(() => undefined);
    }
    setMuted(false);
    setSoundBlocked(false);
  };

  // Sound is the default: when the browser blocked it, the first tap or key
  // press anywhere on the page turns it on. Buttons are left out, since each
  // one handles sound itself (and Unmute would otherwise toggle straight back).
  const enableSoundRef = useRef(enableSound);
  enableSoundRef.current = enableSound;
  useEffect(() => {
    if (!soundBlocked) return;
    const unlock = (event: Event) => {
      if ((event.target as Element | null)?.closest?.("button")) return;
      enableSoundRef.current();
    };
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [soundBlocked]);

  const toggleIntro = () => {
    const video = introRef.current;
    if (!video || introEnded) return;
    if (!begun) return begin();
    if (video.paused) {
      // A click is a user gesture, so sound can be turned on now.
      if (soundBlocked) enableSound();
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
    setFlash((count) => count + 1);
  };

  // Jump to the end of the intro and start the journey now. The intro holds
  // its last frame under the loader until the stream's first frame arrives.
  const skipIntro = () => {
    const video = introRef.current;
    if (soundBlocked) enableSound();
    if (video && Number.isFinite(video.duration)) {
      video.pause();
      video.currentTime = Math.max(0, video.duration - 0.05);
    }
    setIntroPlaying(true);
    setIntroEnded(true);
    setWantStart(true);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (introRef.current) introRef.current.muted = next;
    setSoundBlocked(false);
  };

  const disconnect = useCallback(async () => {
    setStopped(true);
    introRef.current?.pause();
    songRef.current?.pause();
    voiceRef.current?.pause();
    reactionRef.current?.pause();
    if (engine.runStarted) await runner.stop();
    await engine.disconnect();
  }, [runner, engine]);

  // The ending scene has landed (its hold is over, where choices would show):
  // show the closing text...
  const ending = runner.scene?.ending;
  const endingReached = Boolean(ending) && runner.choicesReady;
  useEffect(() => {
    if (endingReached && endingPhase === null) setEndingPhase("text");
  }, [endingReached, endingPhase]);

  // ...then let the stream play on...
  useEffect(() => {
    if (endingPhase !== "text") return;
    const timer = setTimeout(() => setEndingPhase("outro"), ENDING_TEXT_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [endingPhase]);

  // ...with the song, fade the song out over the last seconds, and then close
  // the stream.
  useEffect(() => {
    if (endingPhase !== "outro") return;
    const song = songRef.current;
    let fade: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => {
      const start = performance.now();
      const from = song?.volume ?? 0;
      fade = setInterval(() => {
        const left = 1 - (performance.now() - start) / (SONG_FADE_SECONDS * 1000);
        if (song) song.volume = Math.max(0, from * left);
        if (left <= 0) {
          clearInterval(fade);
          song?.pause();
          setEndingPhase("done");
          void disconnect();
        }
      }, 50);
    }, (ENDING_SONG_SECONDS - SONG_FADE_SECONDS) * 1000);
    return () => {
      clearTimeout(timer);
      clearInterval(fade);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endingPhase]);

  // Start the preloaded song the moment the journey is on screen.
  useEffect(() => {
    const song = songRef.current;
    if (!song || !live || stopped) return;
    song.muted = muted;
    song.currentTime = 0;
    void song.play().catch(() => setSoundBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, stopped]);

  useEffect(() => {
    if (songRef.current) songRef.current.muted = muted;
    if (voiceRef.current) voiceRef.current.muted = muted;
    if (reactionRef.current) reactionRef.current.muted = muted;
  }, [muted]);

  // Right after a choice he reacts to it; later he asks about the next choices.
  const line = { node: runner.node, songRef, muted, stopped };
  useSpokenLine({ ...line, ref: reactionRef, url: runner.scene?.reaction?.url, cue: runner.reactionCue });
  useSpokenLine({ ...line, ref: voiceRef, url: runner.scene?.voice?.url, cue: runner.voiceCue });

  return (
    <main className="droid">
      <audio ref={songRef} src={SONG} preload="auto" loop />
      <audio ref={voiceRef} preload="auto" />
      <audio ref={reactionRef} preload="auto" />
      <div className="droid-layer droid-stream" ref={streamRef}>
        {engine.view}
        <StoryChoices
          runner={runner}
          autoPickSeconds={engine.autoPickSeconds ?? AUTO_PICK_SECONDS}
        />
        {ending && endingPhase === "text" && (
          <div className="droid-ending">
            <p>{ending.text}</p>
          </div>
        )}
      </div>

      {!live && !stopped && (
        <div className="droid-layer droid-intro">
          <video
            ref={introRef}
            src={INTRO_VIDEO}
            playsInline
            preload="auto"
            onClick={toggleIntro}
            onPlay={() => setIntroPaused(false)}
            onPause={() => setIntroPaused(true)}
            onPlaying={() => setIntroPlaying(true)}
            onTimeUpdate={onIntroTime}
            onEnded={() => setIntroEnded(true)}
          />
          {!begun && <img className="droid-backdrop" src={START_BACKDROP} alt="" />}
          {!begun && (
            <button type="button" className="droid-begin" onClick={begin}>
              Start journey
            </button>
          )}
          {begun && !introEnded && (introPaused || flash > 0) && (
            <button
              key={flash}
              type="button"
              className={`droid-playpause ${introPaused ? "paused" : "flash"}`}
              aria-label={introPaused ? "Play" : "Pause"}
              onClick={toggleIntro}
            >
              {introPaused ? (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
                </svg>
              )}
            </button>
          )}
          {begun && !introEnded && (
            <button type="button" className="droid-skip" onClick={skipIntro}>
              Skip
            </button>
          )}
          {introEnded && (
            <div className="droid-loader">
              <span className="spinner" aria-hidden />
              <p>Starting the journey in a few seconds...</p>
            </div>
          )}
        </div>
      )}

      {stopped && (
        <div className="droid-layer droid-ended">
          <p>{endingPhase ? "Thanks for walking with me." : "The stream has ended."}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {endingPhase ? "Start the journey again" : "Watch again"}
          </button>
        </div>
      )}

      <div className="droid-controls">
        {soundBlocked && (
          <button type="button" onClick={enableSound}>
            Tap for sound
          </button>
        )}
        <button type="button" onClick={toggleMute}>
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          type="button"
          disabled={stopped || !(engine.ready || engine.runStarted)}
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>
      </div>

      <nav className={`droid-credits${live && !stopped ? " live" : ""}`} aria-label="Credits">
        <span>Powered by</span>
        <a href="https://reactor.inc" target="_blank" rel="noopener noreferrer">
          Reactor
        </a>
        <a href="https://visko.ai" target="_blank" rel="noopener noreferrer">
          Visko Orbis
        </a>
        <span className="droid-credits-by">Created by</span>
        <a href="https://x.com/bidah" target="_blank" rel="noopener noreferrer">
          RO
        </a>
      </nav>

      {engine.error && <p className="droid-error">{engine.error}</p>}
    </main>
  );
}
