/**
 * A call's LiveKit room, in the browser: loaded only when a person presses
 * Talk (components/call.tsx imports it on demand), so livekit-client stays
 * out of every other page.
 *
 * As Peel's `TalkSession` joins (stakwork/peel#501) and the voice service's
 * agent expects (stakwork/sphinx-voice#33):
 * - `encryption`, not the deprecated `e2ee`, so what the agent sends on the
 *   data channel is encrypted as well as the audio;
 * - a shared key, the call's key STRING as given to `setKey` (its UTF-8
 *   bytes, PBKDF2 with LiveKit's salt), never its base64 decoding;
 * - the microphone without Opus RED, which the server cannot repackage for
 *   an encrypted track, and without DTX, so packets keep a steady rate
 *   through silence.
 * The key and the token go to LiveKit and nowhere else.
 */
import {
  ConnectionState,
  DisconnectReason,
  ExternalE2EEKeyProvider,
  isE2EESupported,
  isLocalParticipant,
  LogLevel,
  Room,
  RoomEvent,
  setLogLevel,
  Track,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";

import { AGENT_STATE_ATTRIBUTE, type CallAnswer } from "@/lib/calls";

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
  /** The room is gone, not by the person's hand: why, in their words. */
  ended(reason: string): void;
}

export interface CallRoom {
  setMicrophone(on: boolean): Promise<void>;
  /** Plays the agent after the browser held its audio back (autoplay). A click calls it. */
  startAudio(): Promise<void>;
  /** Hangs up: the voice service ends the call when the person leaves. */
  leave(): Promise<void>;
}

/** Whether this browser can join an end-to-end encrypted room. */
export const canEncrypt = (): boolean => isE2EESupported();

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
  const cleanUp = () => {
    speakers.remove();
    worker.terminate();
  };
  const end = (reason: string) => {
    if (leaving) return;
    leaving = true;
    on.ended(reason);
    void room.disconnect().finally(cleanUp);
  };

  const tellAgent = () => {
    const p = room.remoteParticipants.get(answer.agent);
    if (p) agentSeen = true;
    on.agent(p ? (p.attributes[AGENT_STATE_ATTRIBUTE] ?? "") : null);
  };

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
    .on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) speakers.append(track.attach());
    })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const el of track.detach()) el.remove();
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
          ? `Your browser blocked the microphone, so ${assistant} can’t hear you. Allow it for this site, then unmute.`
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

  return {
    setMicrophone,
    startAudio: () => room.startAudio(),
    async leave() {
      if (leaving) return;
      leaving = true;
      await room.disconnect().catch(() => undefined);
      cleanUp();
    },
  };
}
