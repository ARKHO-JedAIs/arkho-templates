import { useCallback, useEffect, useRef, useState } from 'react';
import type { LanguageCode } from '@aws-sdk/client-transcribe-streaming';
import { getIdToken } from '@/lib/auth/session';
import { TRANSCRIBE_SAMPLE_RATE } from '../audio/constants';
import { chatConfig } from '../chatConfig';

// Served from public/ as a stable, root-relative path - AudioWorklet modules
// aren't special-cased by Vite's bundler the way Web Workers are, so
// referencing a TS module via `new URL(..., import.meta.url)` here would
// silently get inlined as a mis-typed base64 data: URL instead of real,
// executable worklet code. A plain public/ asset sidesteps that entirely.
const WORKLET_MODULE_URL = '/pcm-worklet.js';
const WORKLET_PROCESSOR_NAME = 'pcm-worklet';

export type VoiceInputState = 'idle' | 'requesting-mic' | 'listening' | 'stopping' | 'error';

// Push-to-talk has no automatic end, so this is purely a runaway guard (a
// button wedged down in a pocket, a stuck pointer event) rather than part of
// the interaction. Generous on purpose: cutting someone off mid-sentence is
// exactly the failure this hook used to have.
const MAX_RECORDING_MS = 180_000;

// Releasing the button does NOT close the audio stream right away. The worklet
// accumulates ~200ms of PCM before posting it, so tearing the graph down on
// release threw away up to a fifth of a second of speech - the last syllable
// of the last word.
const TAIL_CAPTURE_MS = 250;
// After that window we tell the worklet to post its sub-batch remainder; the
// message crosses threads, so give it a tick to land before we stop the mic.
const WORKLET_FLUSH_GRACE_MS = 80;

// Silence deliberately fed to Transcribe after the microphone is released, and
// the single most important part of this file.
//
// Transcribe only closes a segment - and only then emits a result with
// IsPartial: false, the authoritative text - once it hears a pause. Partial
// results always lag the speaker, because stabilization holds trailing words
// back until they're unlikely to be revised. So the complete sentence exists
// *only* in that final result, and the final result only comes after a pause.
//
// Ending the audio iterator instead of feeding silence does not work: in the
// browser this client streams over a WebSocket, and @aws-sdk/middleware-websocket
// closes the socket in a `finally` the moment the input iterator finishes
// (WebSocketFetchHandler.connect -> send). onclose then ends the result stream,
// so nothing arrives after that point no matter how long we wait. The audio
// stream has to stay open until the final result is in hand.
const SILENCE_TAIL_MS = 1_000;
const SILENCE_CHUNK_MS = 200;

// Backstop: if no final result ever arrives, settle on the best partial rather
// than leaving the UI stuck. The silence above is pushed all at once rather
// than in real time - Transcribe accepts audio faster than realtime - so the
// whole drain normally resolves a few hundred ms after the release, and this
// only has to cover the tail capture plus Transcribe's processing latency.
const FINALIZE_TIMEOUT_MS = 2_000;

/**
 * Transcribe language code. Override with VITE_CHAT_VOICE_LANGUAGE (e.g. es-US,
 * en-US). Cast because the value arrives as a plain string from the environment
 * and the SDK types it as a closed union; an unsupported code is rejected by
 * Transcribe at stream start, which surfaces as the connection-error notice.
 */
const LANGUAGE_CODE = (import.meta.env.VITE_CHAT_VOICE_LANGUAGE ?? 'es-US') as LanguageCode;

/**
 * The Transcribe SDKs, fetched on demand.
 *
 * They are the heaviest thing the chat pulls in, and only a build with `voice`
 * enabled ever calls them - which is a runtime flag, not a generated-away file.
 * A static import would put them in the initial bundle of every user, including
 * everyone who never opens the chat.
 *
 * Memoized so repeated presses reuse one fetch, and the promise is cleared on
 * failure: caching a rejection would leave voice permanently broken after a
 * single network hiccup, until the page is reloaded.
 */
type TranscribeSdk = {
  TranscribeStreamingClient: typeof import('@aws-sdk/client-transcribe-streaming').TranscribeStreamingClient;
  StartStreamTranscriptionCommand: typeof import('@aws-sdk/client-transcribe-streaming').StartStreamTranscriptionCommand;
  fromCognitoIdentityPool: typeof import('@aws-sdk/credential-provider-cognito-identity').fromCognitoIdentityPool;
};

let sdkPromise: Promise<TranscribeSdk> | null = null;

function loadTranscribeSdk(): Promise<TranscribeSdk> {
  sdkPromise ??= Promise.all([
    import('@aws-sdk/client-transcribe-streaming'),
    import('@aws-sdk/credential-provider-cognito-identity'),
  ])
    .then(([transcribe, credentials]) => ({
      TranscribeStreamingClient: transcribe.TranscribeStreamingClient,
      StartStreamTranscriptionCommand: transcribe.StartStreamTranscriptionCommand,
      fromCognitoIdentityPool: credentials.fromCognitoIdentityPool,
    }))
    .catch(error => {
      sdkPromise = null;
      throw error;
    });
  return sdkPromise;
}

const IDENTITY_POOL_ID = import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID;
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID;

const MIC_PERMISSION_DENIED_MESSAGE =
  'Permiso de micrófono denegado. Actívalo en la configuración del navegador.';
export const VOICE_UNAVAILABLE_MESSAGE = 'La entrada de voz no está disponible en este navegador.';
const VOICE_CONNECTION_ERROR_MESSAGE =
  'No se pudo conectar con el servicio de voz. Intenta de nuevo o escribe tu mensaje.';

function isBrowserSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== 'undefined' &&
    'audioWorklet' in AudioContext.prototype
  );
}

/**
 * A simple async pull queue: the AudioWorklet pushes encoded PCM chunks as
 * they're ready, `iterate()` yields them in the shape Transcribe's
 * `AudioStream` expects, and `end()` lets the consuming `for await` loop
 * (inside StartStreamTranscriptionCommand) finish cleanly on stop().
 */
function createAudioStreamQueue() {
  let resolveNext: ((chunk: Uint8Array | null) => void) | null = null;
  const queue: (Uint8Array | null)[] = [];

  return {
    push(chunk: Uint8Array) {
      if (resolveNext) {
        resolveNext(chunk);
        resolveNext = null;
      } else {
        queue.push(chunk);
      }
    },
    end() {
      if (resolveNext) {
        resolveNext(null);
        resolveNext = null;
      } else {
        queue.push(null);
      }
    },
    async *iterate() {
      while (true) {
        let chunk: Uint8Array | null;
        if (queue.length > 0) {
          chunk = queue.shift()!;
        } else {
          chunk = await new Promise<Uint8Array | null>(resolve => {
            resolveNext = resolve;
          });
        }
        if (chunk === null) return;
        yield { AudioEvent: { AudioChunk: chunk } };
      }
    },
  };
}

/**
 * Captures the microphone and streams it to Amazon Transcribe in real time,
 * directly from the browser (temporary credentials via a Cognito Identity
 * Pool federated with the existing User Pool session - no backend hop, since
 * that's the only way to keep this genuinely low-latency).
 *
 * Push-to-talk: recording runs from `start()` to `stop()` and nothing else
 * ends it. It used to stop itself after ~1.5s without new recognized speech,
 * which cut people off every time they paused to think or read a value off a
 * label - the natural rhythm of dictating field data.
 *
 * Releasing the button starts a short *drain* phase (state 'stopping') rather
 * than ending everything at once. Transcribe's stabilized partial deliberately
 * lags behind live speech, so at the instant of release the text on screen is
 * a word or two short of what was said; the words that complete it only arrive
 * once the audio stream closes and Transcribe flushes its final results. The
 * drain phase exists to receive them.
 *
 * Reports the current best transcript on every update via
 * `onTranscriptChange` (live, not just at the end). The caller decides what to
 * do with the text (fill an input, etc.); this hook never sends anything.
 */
export function useVoiceInput(onTranscriptChange: (sessionText: string) => void) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [notice, setNotice] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletReadyRef = useRef<Promise<void> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const endQueueRef = useRef<(() => void) | null>(null);
  const pushAudioRef = useRef<((chunk: Uint8Array) => void) | null>(null);
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the button is held. Goes false on release, which also lets an
  // in-flight start() discover the button was already let go (a quick tap
  // finishes before the mic permission and Transcribe handshake resolve).
  const isCapturingRef = useRef(false);
  // True from release until the transcript settles. Deliberately separate from
  // isCapturingRef: the transcript loop must keep accepting events in this
  // phase - gating it on "still recording" is what truncated the tail.
  const isFinalizingRef = useRef(false);
  const segmentsRef = useRef<string[]>([]);
  const partialTextRef = useRef('');
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  onTranscriptChangeRef.current = onTranscriptChange;

  // Voice needs three things to line up: the feature turned on, a browser that
  // can capture audio, and an identity pool to sign Transcribe calls with.
  const isSupported =
    chatConfig.voiceEnabled && isBrowserSupported() && !!IDENTITY_POOL_ID && !!USER_POOL_ID;

  const emitTranscript = useCallback(() => {
    const text = [...segmentsRef.current, partialTextRef.current].filter(Boolean).join(' ').trim();
    onTranscriptChangeRef.current(text);
  }, []);

  const clearTimers = useCallback(() => {
    for (const timer of [maxDurationTimerRef, tailTimerRef, finalizeTimerRef]) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    }
  }, []);

  /**
   * Creates the AudioContext and loads the worklet module - once per mount,
   * not once per press. Both used to sit inside the window between pressing
   * the button and the first sample being kept, so anything said during them
   * was simply not recorded; the module in particular is a network fetch.
   *
   * Called on mount as a warm-up, where it stays suspended (no user gesture
   * yet, and no microphone is involved), and again on each press, which only
   * has to resume it.
   */
  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const context = new AudioContext({ sampleRate: TRANSCRIBE_SAMPLE_RATE });
      audioContextRef.current = context;
      workletReadyRef.current = context.audioWorklet.addModule(WORKLET_MODULE_URL);
    }
    return audioContextRef.current;
  }, []);

  /**
   * Releases the microphone and tears down the per-press nodes, but keeps the
   * AudioContext (suspended, so it stops processing) for the next press, and
   * leaves the stream to Transcribe open - the drain phase still needs to push
   * silence into it. Idempotent.
   */
  const stopMicrophone = useCallback(() => {
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    workletNodeRef.current?.disconnect();
    workletNodeRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (audioContextRef.current?.state === 'running') {
      void audioContextRef.current.suspend();
    }
  }, []);

  /** Ends the audio stream, which closes the socket. Nothing arrives after. */
  const endAudioStream = useCallback(() => {
    stopMicrophone();
    endQueueRef.current?.();
    endQueueRef.current = null;
    pushAudioRef.current = null;
  }, [stopMicrophone]);

  /** Hard teardown - unmount, errors, and abandoning a start() mid-flight. */
  const releaseResources = useCallback(() => {
    isCapturingRef.current = false;
    isFinalizingRef.current = false;
    clearTimers();
    endAudioStream();
  }, [clearTimers, endAudioStream]);

  /**
   * Ends the drain phase and settles the transcript. Called either when the
   * result stream closes (the normal path, and the fast one) or by the
   * backstop timer if it never does.
   */
  const finishFinalizing = useCallback(() => {
    if (!isFinalizingRef.current) return;
    isFinalizingRef.current = false;
    clearTimers();
    endAudioStream();

    // Whatever is still only a partial by now never got a final result to
    // replace it - keep it rather than lose it.
    if (partialTextRef.current) {
      segmentsRef.current.push(partialTextRef.current);
      partialTextRef.current = '';
    }
    emitTranscript();
    setState(current => (current === 'stopping' ? 'idle' : current));
  }, [clearTimers, endAudioStream, emitTranscript]);

  const stop = useCallback(() => {
    // Idempotent: pointerup, pointercancel and window blur can all fire for a
    // single release, and the runaway timer may land on top of them.
    if (!isCapturingRef.current) return;
    isCapturingRef.current = false;
    isFinalizingRef.current = true;
    clearTimers();
    setState('stopping');

    // Keep capturing for a moment past the release so the worklet's in-flight
    // batch is real audio rather than a truncated word, then ask it to post
    // whatever remains.
    tailTimerRef.current = setTimeout(() => {
      workletNodeRef.current?.port.postMessage({ type: 'flush' });

      tailTimerRef.current = setTimeout(() => {
        // Microphone off, stream still open: from here on Transcribe is fed
        // silence, which is what makes it close the segment and hand over the
        // final, complete text. See SILENCE_TAIL_MS.
        stopMicrophone();
        const push = pushAudioRef.current;
        if (!push) return;
        const bytesPerChunk = (TRANSCRIBE_SAMPLE_RATE * 2 * SILENCE_CHUNK_MS) / 1000;
        for (let sent = 0; sent < SILENCE_TAIL_MS; sent += SILENCE_CHUNK_MS) {
          push(new Uint8Array(bytesPerChunk));
        }
      }, WORKLET_FLUSH_GRACE_MS);
    }, TAIL_CAPTURE_MS);

    finalizeTimerRef.current = setTimeout(finishFinalizing, FINALIZE_TIMEOUT_MS);

    // Segments are NOT cleared here; start() resets them instead. Clearing at
    // this point used to race with the transcript loop: a final result landing
    // just after stop() would append to an emptied list and emit only that
    // fragment, wiping the rest of the dictated text from the input.
  }, [clearTimers, finishFinalizing, stopMicrophone]);

  const start = useCallback(async () => {
    // 'stopping' counts as busy: starting over mid-drain would reset the
    // segments the tail of the previous sentence is still arriving into. The
    // UI already blocks the gesture, but the invariant belongs here too.
    if (!isSupported || state === 'requesting-mic' || state === 'listening' || state === 'stopping')
      return;

    setNotice(null);
    clearTimers();
    isFinalizingRef.current = false;
    segmentsRef.current = [];
    partialTextRef.current = '';
    isCapturingRef.current = true;
    setState('requesting-mic');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Released already? Bail before wiring up the graph so a quick tap can't
      // leave a live microphone behind.
      if (!isCapturingRef.current) {
        releaseResources();
        setState('idle');
        return;
      }

      // Already warmed up on mount in the common case, so this resolves
      // immediately and only resume() is actually paid for here.
      const audioContext = ensureAudioContext();
      await workletReadyRef.current;
      if (audioContext.state === 'suspended') await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      const workletNode = new AudioWorkletNode(audioContext, WORKLET_PROCESSOR_NAME);
      workletNodeRef.current = workletNode;

      const queue = createAudioStreamQueue();
      endQueueRef.current = queue.end;
      pushAudioRef.current = queue.push;

      // The worklet already batches (~200ms) and PCM16-encodes on the audio
      // thread - it posts `{ buffer }` with an Int16Array's underlying
      // ArrayBuffer, already little-endian PCM16LE. It also accepts a
      // `{ type: 'flush' }` message, which stop() uses to get the tail of the
      // utterance out of its accumulator before the stream closes.
      workletNode.port.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
        queue.push(new Uint8Array(event.data.buffer));
      };
      source.connect(workletNode);

      // A node not reachable from the destination can stop being pulled for
      // processing in some browsers - route through a silent gain so the
      // worklet keeps running without the user hearing their own mic.
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      workletNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
      silentGainRef.current = silentGain;

      // 'listening' from here, not after the handshake below. Nothing consumes
      // the queue until the socket opens, so from this line on every sample is
      // kept and eventually sent - saying "preparing microphone" through the
      // token refresh and the handshake told the user to wait when it was
      // already safe to talk, and the deaf window is only what came before.
      if (isCapturingRef.current) setState('listening');

      // Loaded here rather than at module scope, and deliberately after the
      // switch to 'listening': from that point every sample is already being
      // buffered by the audio queue, so the download delays the socket opening
      // without dropping a single syllable.
      const {
        TranscribeStreamingClient,
        StartStreamTranscriptionCommand,
        fromCognitoIdentityPool,
      } = await loadTranscribeSdk();

      const region = USER_POOL_ID!.split('_')[0];
      const idToken = await getIdToken();
      if (!idToken) throw new Error('Missing Cognito ID token');

      const client = new TranscribeStreamingClient({
        region,
        credentials: fromCognitoIdentityPool({
          clientConfig: { region },
          identityPoolId: IDENTITY_POOL_ID!,
          logins: {
            [`cognito-idp.${region}.amazonaws.com/${USER_POOL_ID}`]: idToken,
          },
        }),
      });

      const response = await client.send(
        new StartStreamTranscriptionCommand({
          LanguageCode: LANGUAGE_CODE,
          MediaEncoding: 'pcm',
          MediaSampleRateHertz: TRANSCRIBE_SAMPLE_RATE,
          EnablePartialResultsStabilization: true,
          // 'medium', not 'high': stability is bought by holding trailing words
          // back until they're unlikely to be revised, so 'high' left the live
          // text visibly a couple of words behind the speaker. The final
          // results received during the drain phase are what the text settles
          // on either way, so the extra lag bought nothing here.
          PartialResultsStability: 'medium',
          AudioStream: queue.iterate(),
        })
      );

      // The button may have been released during the handshake above. Whatever
      // was said in the meantime is sitting in the queue, so the drain has to
      // run rather than be thrown away - a short utterance can easily finish
      // before the socket opens. The only thing to fix up is the backstop,
      // which started counting at the release, when there was no socket yet
      // and so nothing that could have answered it.
      if (!isCapturingRef.current) {
        if (!isFinalizingRef.current) {
          releaseResources();
          setState('idle');
          return;
        }
        if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current);
        finalizeTimerRef.current = setTimeout(finishFinalizing, FINALIZE_TIMEOUT_MS);
      } else {
        maxDurationTimerRef.current = setTimeout(stop, MAX_RECORDING_MS);
      }

      (async () => {
        try {
          if (!response.TranscriptResultStream) return;
          for await (const event of response.TranscriptResultStream) {
            // Note what is NOT checked here: whether we're still recording.
            // Results arriving after the release are precisely the ones
            // carrying the end of the sentence.
            if (!isCapturingRef.current && !isFinalizingRef.current) return;
            const results = event.TranscriptEvent?.Transcript?.Results ?? [];
            let closedSegment = false;
            for (const result of results) {
              const transcript = result.Alternatives?.[0]?.Transcript ?? '';
              if (!transcript) continue;

              if (result.IsPartial) {
                partialTextRef.current = transcript;
              } else {
                segmentsRef.current.push(transcript);
                partialTextRef.current = '';
                closedSegment = true;
              }
              emitTranscript();
            }

            // A closed segment during the drain phase is the whole point of it:
            // that result is the complete sentence, so stop feeding silence and
            // settle instead of waiting out the rest of the window.
            if (closedSegment && isFinalizingRef.current) {
              finishFinalizing();
              return;
            }
          }
        } catch {
          // The stream ends this way on a normal stop() too (queue.end()
          // closes it) - nothing to surface, cleanup happens just below.
        }
        // Stream closed means Transcribe flushed everything it had, so the
        // transcript can settle now instead of waiting out the backstop.
        finishFinalizing();
      })();
    } catch (error) {
      // Read the flag before releaseResources() clears it: if the user had
      // already let go, a failure here is just a tap that ended mid-handshake,
      // not something worth putting an error in their face for.
      const wasReleasedEarly = !isCapturingRef.current;
      releaseResources();
      segmentsRef.current = [];
      partialTextRef.current = '';

      if (wasReleasedEarly) {
        setState('idle');
        return;
      }
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setNotice(MIC_PERMISSION_DENIED_MESSAGE);
      } else {
        setNotice(VOICE_CONNECTION_ERROR_MESSAGE);
      }
      setState('error');
    }
  }, [
    clearTimers,
    emitTranscript,
    ensureAudioContext,
    finishFinalizing,
    isSupported,
    releaseResources,
    state,
    stop,
  ]);

  // Warm-up. No microphone and no permission prompt is involved - just the
  // AudioContext and the worklet module fetch, moved off the press so the
  // window where speech isn't being recorded is as short as it can be.
  useEffect(() => {
    if (!isSupported) return;
    try {
      ensureAudioContext();
    } catch {
      // Nothing to report: start() creates it again and surfaces a real error
      // there if it genuinely can't.
    }
    // Same idea for the SDK chunk: move the cost off the press. The empty catch
    // is required to avoid an unhandled rejection - start() retries and reports
    // the real failure there.
    void loadTranscribeSdk().catch(() => {});
  }, [ensureAudioContext, isSupported]);

  useEffect(
    () => () => {
      releaseResources();
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      workletReadyRef.current = null;
    },
    [releaseResources]
  );

  return { state, notice, isSupported, start, stop };
}
