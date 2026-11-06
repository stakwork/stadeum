/**
 * A call's LiveKit room, in the browser: loaded only when a person presses
 * Talk (components/call.tsx imports it on demand), so livekit-client stays
 * out of every other page.
 *
 * As Peel's `TalkSession` joins (stakwork/peel#501) and the voice service's
 * agent expects (stakwork/sphinx-voice#33):
 * - `encryption`, not the deprecated `e2ee`, so what the agent sends on the
 *   data channel (the words, the artifacts) is encrypted as well as the audio;
 * - a shared key, the call's key STRING as given to `setKey` (its UTF-8
 *   bytes, PBKDF2 with LiveKit's salt), never its base64 decoding;
 * - the microphone without Opus RED, which the server cannot repackage for
 *   an encrypted track, and without DTX, so packets keep a steady rate
 *   through silence.
 * The key and the token go to LiveKit and nowhere else. Text streams are
 * read only from the agent and only when they came encrypted.
 */
import {
  ConnectionState,
  createAudioAnalyser,
  DisconnectReason,
  Encryption_Type,
  ExternalE2EEKeyProvider,
  isE2EESupported,
  isLocalParticipant,
  LogLevel,
  Room,
  RoomEvent,
  setLogLevel,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type TextStreamReader,
} from "livekit-client";

import { AGENT_STATE_ATTRIBUTE, type CallAnswer } from "@/lib/calls";
import { ARTIFACTS_TOPIC, TRANSCRIPT_TOPIC, type Chunk } from "@/lib/call-transcript";

// LiveKit logs each room's name and identities at info: warnings only.
setLogLevel(LogLevel.warn);

export type Connection = "connecting" | "connected" | "reconnecting";
export type NoticeKind = "encryption" | "microphone" | "audio";

export interface CallRoomHandlers {
  connection(c: Connection): void;
  /** The agent's `lk.agent.state` ("" before it sets one), or null while it is not in the room. */
  agent(state: string | null): void;
  microphone(on: boolean): void;
  /** Something the person should know, or null once it passes. */
  notice(kind: NoticeKind, text: string | null): void;
  /** A chunk of the words said (`lk.transcription`). */
  words(chunk: Chunk): void;
  /** A payload of the agent's artifacts (`sphinx.artifacts`), as it came. */
  artifacts(text: string): void;
  /** The room is gone, not by the person's hand: why, in their words. */
  ended(reason: string): void;
}

export interface CallRoom {
  setMicrophone(on: boolean): Promise<void>;
  /** Plays the agent after the browser held its audio back (autoplay). A click calls it. */
  startAudio(): Promise<void>;
  /** How loud each side is now, 0…1: the agent's voice, the person's microphone (0 while muted). */
  levels(): { agent: number; you: number };
  /** Hangs up: the voice service ends the call when the person leaves. */
  leave(): Promise<void>;
}

/** Whether this browser can join an end-to-end encrypted room. */
export const canEncrypt = (): boolean => isE2EESupported();

type Meter = ReturnType<typeof createAudioAnalyser>;

export async function joinCallRoom(answer: CallAnswer, key: string, assistant: string, on: CallRoomHandlers): Promise<CallRoom> {
  const keyProvider = new ExternalE2EEKeyProvider();
  // Written out here so the bundler emits the worker.
  const worker = new Worker(new URL("livekit-client/e2ee-worker", import.meta.url));
  const room = new Room({
    encryption: { keyProvider, worker },
    publishDefaults: { dtx: false, red: false },
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  // The agent's voice plays from here; it lives as long as the room.
  const speakers = document.createElement("div");
  speakers.hidden = true;
  document.body.append(speakers);

  let leaving = false;
  let agentSeen = false;
  let agentMeter: Meter | null = null;
  let micMeter: Meter | null = null;
  const agentTracks = new Set<string>();

  const cleanUp = () => {
    speakers.remove();
    worker.terminate();
    void agentMeter?.cleanup();
    void micMeter?.cleanup();
    agentMeter = micMeter = null;
  };
  const end = (reason: string) => {
    if (leaving) return;
    leaving = true;
    on.ended(reason);
    void room.disconnect().finally(cleanUp);
  };

  const tellAgent = () => {
    const p = room.remoteParticipants.get(answer.agent);
    if (p) {
      agentSeen = true;
      for (const pub of p.trackPublications.values()) agentTracks.add(pub.trackSid);
    }
    on.agent(p ? (p.attributes[AGENT_STATE_ATTRIBUTE] ?? "") : null);
  };

  /** A text stream from the agent, encrypted as the room is; anything else is not read. */
  const fromAgent = (reader: TextStreamReader, sender: string) => sender === answer.agent && reader.info.encryptionType === Encryption_Type.GCM;

  // Before the room connects, so no word is missed.
  room.registerTextStreamHandler(TRANSCRIPT_TOPIC, (reader, { identity }) => {
    if (!fromAgent(reader, identity)) return;
    const { id: stream, attributes = {} } = reader.info;
    void (async () => {
      try {
        for await (const chunk of reader) {
          if (leaving) return;
          on.words({ chunk, stream, attributes, sender: identity, you: answer.identity, agentTracks });
        }
      } catch {
        // A stream cut off mid-word: what came stays.
      }
    })();
  });
  room.registerTextStreamHandler(ARTIFACTS_TOPIC, (reader, { identity }) => {
    if (!fromAgent(reader, identity)) return;
    reader
      .readAll()
      .then((text) => !leaving && on.artifacts(text))
      .catch(() => undefined);
  });

  room
    .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      if (state === ConnectionState.Connected) on.connection("connected");
      else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) on.connection("reconnecting");
      else if (state === ConnectionState.Connecting) on.connection("connecting");
    })
    .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      end(reason === DisconnectReason.ROOM_DELETED ? "The call ended." : "The call was cut off.");
    })
    .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      if (p.identity === answer.agent) tellAgent();
    })
    .on(RoomEvent.ParticipantAttributesChanged, (_changed: Record<string, string>, p: Participant) => {
      if (p.identity === answer.agent) tellAgent();
    })
    .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      if (p.identity === answer.agent && agentSeen) end(`${assistant} left the call.`);
    })
    .on(RoomEvent.TrackPublished, (_pub, p: RemoteParticipant) => {
      if (p.identity === answer.agent) tellAgent();
    })
    .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p: RemoteParticipant) => {
      if (track.kind !== Track.Kind.Audio) return;
      speakers.append(track.attach());
      if (p.identity === answer.agent && track.sid) {
        agentTracks.add(track.sid);
        void agentMeter?.cleanup();
        agentMeter = createAudioAnalyser(track as Parameters<typeof createAudioAnalyser>[0], { smoothingTimeConstant: 0.5 });
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const el of track.detach()) el.remove();
    })
    .on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
      if (pub.source !== Track.Source.Microphone || !pub.audioTrack) return;
      void micMeter?.cleanup();
      micMeter = createAudioAnalyser(pub.audioTrack, { smoothingTimeConstant: 0.5 });
    })
    .on(RoomEvent.AudioPlaybackStatusChanged, () => {
      on.notice("audio", room.canPlaybackAudio ? null : `Your browser held ${assistant}’s voice back.`);
    })
    // A key that doesn't match fails here, while the agent's state, over
    // LiveKit's signaling, would still say Speaking over silence.
    .on(RoomEvent.EncryptionError, (_err: Error, p?: Participant) => {
      on.notice("encryption", `This call’s encryption failed: ${p && isLocalParticipant(p) ? `${assistant} can’t hear you` : `${assistant} can’t be heard`}.`);
    });

  async function setMicrophone(enable: boolean) {
    if (leaving) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(enable);
      on.notice("microphone", null);
    } catch (err) {
      const blocked = err instanceof Error && (err.name === "NotAllowedError" || err.name === "SecurityError");
      on.notice(
        "microphone",
        blocked
          ? `Microphone blocked: allow it for this site, then unmute.`
          : `The microphone didn’t turn on${err instanceof Error && err.message ? `: ${err.message}` : "."}`,
      );
    }
    on.microphone(room.localParticipant.isMicrophoneEnabled);
  }

  try {
    on.connection("connecting");
    await keyProvider.setKey(key);
    await room.setE2EEEnabled(true);
    await room.connect(answer.url, answer.token, { autoSubscribe: true });
  } catch (err) {
    leaving = true;
    await room.disconnect().catch(() => undefined);
    cleanUp();
    throw err;
  }
  // The voice service answers once its agent is in the room.
  tellAgent();
  void setMicrophone(true);

  const loudness = (m: Meter | null) => {
    if (!m) return 0;
    try {
      return Math.min(1, Math.sqrt(m.calculateVolume()) * 1.9);
    } catch {
      return 0;
    }
  };

  return {
    setMicrophone,
    startAudio: () => room.startAudio(),
    levels: () => ({ agent: loudness(agentMeter), you: room.localParticipant.isMicrophoneEnabled ? loudness(micMeter) : 0 }),
    async leave() {
      if (leaving) return;
      leaving = true;
      await room.disconnect().catch(() => undefined);
      cleanUp();
    },
  };
}
