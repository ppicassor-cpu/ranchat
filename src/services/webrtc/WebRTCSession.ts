import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices, MediaStream } from "react-native-webrtc";
import { PermissionsAndroid, Platform } from "react-native";
import { APP_CONFIG } from "../../config/app";

import InCallManager from "../../../modules/ranchat-call-audio";

type Callbacks = {
  onLocalStream?: (s: MediaStream) => void;
  onRemoteStream?: (s: MediaStream) => void;
  onIceCandidate?: (c: any) => void;
  onConnectionState?: (s: string) => void;
  onDataChannelOpen?: () => void;
  onDataChannelClose?: () => void;
  onDataMessage?: (message: string) => void;

  onOffer?: (sdp: any) => void;
  onAnswer?: (sdp: any) => void;
};

const VIDEO_W = 720;
const VIDEO_H = 540;
const VIDEO_FPS = 24;

const VIDEO_MAX_BITRATE = 1_200_000;
const AUDIO_MAX_BITRATE = 64_000;

function preferH264InSdp(sdp: string) {
  try {
    const lines = String(sdp || "").split("\r\n");
    const mVideo = lines.findIndex((l) => l.startsWith("m=video "));
    if (mVideo < 0) return sdp;

    const h264Pts = new Set<string>();
    for (const l of lines) {
      const m = l.match(/^a=rtpmap:(\d+)\s+H264\/90000/i);
      if (m?.[1]) h264Pts.add(m[1]);
    }
    if (h264Pts.size === 0) return sdp;

    const parts = lines[mVideo].split(" ");
    if (parts.length <= 3) return sdp;

    const head = parts.slice(0, 3);
    const pts = parts.slice(3);

    const preferred = pts.filter((p) => h264Pts.has(p));
    const others = pts.filter((p) => !h264Pts.has(p));

    lines[mVideo] = [...head, ...preferred, ...others].join(" ");
    return lines.join("\r\n");
  } catch {
    return sdp;
  }
}

type IcePathInfo = {
  selectedPairId?: string;
  localCandidateType?: string;
  remoteCandidateType?: string;
  localProtocol?: string;
  remoteProtocol?: string;
  localAddress?: string;
  localPort?: number;
  remoteAddress?: string;
  remotePort?: number;
  currentRoundTripTimeMs?: number;
  availableOutgoingBitrate?: number;
  bytesSent?: number;
  bytesReceived?: number;
};

function forEachStat(report: any, fn: (s: any) => void) {
  if (!report) return;

  if (typeof report.forEach === "function") {
    report.forEach((v: any) => fn(v));
    return;
  }

  if (Array.isArray(report)) {
    report.forEach((v) => fn(v));
    return;
  }

  if (typeof report === "object") {
    Object.values(report).forEach((v) => fn(v));
  }
}

export class WebRTCSession {
  private pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private dataChannel: any = null;
  private pendingDataMessages: string[] = [];
  private pendingRemoteCandidates: any[] = [];
  private signalTask: Promise<unknown> = Promise.resolve();
  private cb: Callbacks;
  private inCallStarted: boolean = false;
  private audioDeviceSub: any = null;
  private routeLockUntilMs: number = 0;
  private lastAvailableAudioDevices: string[] = [];
  private lastAppliedRoute: string | null = null;
  private lastApplyAtMs: number = 0;
  private lastNotifiedConnectionState: string = "";
  private lastLocalAudioEnergy: number | null = null;
  private lastLocalAudioDuration: number | null = null;
  private lastRemoteAudioEnergy: number | null = null;
  private lastRemoteAudioDuration: number | null = null;

  constructor(cb: Callbacks) {
    this.cb = cb;

    const turn = APP_CONFIG.TURN;
    const iceTransportPolicy = (APP_CONFIG as any)?.ICE?.transportPolicy === "relay" ? "relay" : "all";

    const stunUrls = (APP_CONFIG as any)?.ICE?.stunUrls ?? [];
    const stunServer =
      Array.isArray(stunUrls) && stunUrls.length > 0
        ? { urls: stunUrls }
        : { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

    const turnUrls: string[] = [];
    if (turn.host && turn.port) {
      turnUrls.push(`turn:${turn.host}:${turn.port}?transport=udp`);
      if ((turn as any).tcpEnabled === true) {
        turnUrls.push(`turn:${turn.host}:${turn.port}?transport=tcp`);
      }
    }
    if (turn.host && (turn as any).tlsEnabled === true && (turn as any).tlsPort) {
      turnUrls.push(`turns:${turn.host}:${(turn as any).tlsPort}?transport=tcp`);
    }

    const iceServers = [
      stunServer,
      {
        urls: turnUrls,
        username: turn.username,
        credential: turn.password,
      },
    ];

    this.pc = new RTCPeerConnection(
      {
        iceServers,
        iceTransportPolicy,
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require",
        iceCandidatePoolSize: 2,
      } as any
    );

    const pcAny: any = this.pc;

    pcAny.onicecandidate = (e: any) => {
      if (e?.candidate) this.cb.onIceCandidate?.(e.candidate);
    };

    pcAny.onconnectionstatechange = () => {
      this.notifyConnectionState(pcAny.connectionState || pcAny.iceConnectionState);
    };

    pcAny.oniceconnectionstatechange = () => {
      this.notifyConnectionState(pcAny.iceConnectionState || pcAny.connectionState);
    };

    pcAny.ontrack = (e: any) => {
      const stream = (e?.streams && e.streams[0]) || null;
      if (stream) {
        this.remoteStream = stream;
        this.cb.onRemoteStream?.(stream);
      }
    };

    pcAny.ondatachannel = (e: any) => {
      const channel = e?.channel;
      if (!channel) return;
      this.bindDataChannel(channel);
    };
  }

  private notifyConnectionState(state: unknown) {
    const normalized = String(state || "").trim().toLowerCase();
    if (!normalized) return;
    if (this.lastNotifiedConnectionState === normalized) return;
    this.lastNotifiedConnectionState = normalized;
    this.cb.onConnectionState?.(normalized);
  }

  private hasRemoteDescription() {
    const pcAny: any = this.pc as any;
    const remote = pcAny?.remoteDescription;
    return Boolean(remote && String(remote.type || "").trim().length > 0);
  }

  private getSignalingState() {
    const pcAny: any = this.pc as any;
    return String(pcAny?.signalingState || "").trim().toLowerCase();
  }

  private enqueueSignalTask<T>(task: () => Promise<T>) {
    const run = this.signalTask.then(task, task);
    this.signalTask = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async flushPendingRemoteCandidates() {
    if (!this.hasRemoteDescription()) return;
    if (!this.pendingRemoteCandidates.length) return;

    const pending = this.pendingRemoteCandidates.splice(0);
    for (const candidate of pending) {
      try {
        await (this.pc as any).addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        this.pendingRemoteCandidates.push(candidate);
      }
    }
  }

  private normalizeDataMessage(data: any) {
    if (typeof data === "string") return data;
    try {
      return JSON.stringify(data);
    } catch {
      return String(data ?? "");
    }
  }

  private flushPendingDataMessages() {
    const ch: any = this.dataChannel;
    if (!ch || ch.readyState !== "open") return;

    const pending = this.pendingDataMessages.splice(0);
    for (const msg of pending) {
      try {
        ch.send(msg);
      } catch {
        this.pendingDataMessages.unshift(msg);
        break;
      }
    }
  }

  private bindDataChannel(channel: any) {
    if (!channel) return;

    if (this.dataChannel && this.dataChannel !== channel) {
      try {
        this.dataChannel.close?.();
      } catch {}
    }

    this.dataChannel = channel;

    channel.onopen = () => {
      this.cb.onDataChannelOpen?.();
      this.flushPendingDataMessages();
    };

    channel.onmessage = (e: any) => {
      const msg = this.normalizeDataMessage(e?.data);
      this.cb.onDataMessage?.(msg);
    };

    channel.onclose = () => {
      if (this.dataChannel === channel) this.dataChannel = null;
      this.cb.onDataChannelClose?.();
    };

    channel.onerror = () => {};
  }

  private ensureCallerDataChannel() {
    if (this.dataChannel) return;

    const pcAny: any = this.pc;
    if (typeof pcAny.createDataChannel !== "function") return;

    try {
      const channel = pcAny.createDataChannel("chat", { ordered: true });
      this.bindDataChannel(channel);
    } catch {}
  }

  sendChatMessage(message: string) {
    const text = String(message ?? "");
    if (!text) return false;

    const ch: any = this.dataChannel;
    if (!ch) return false;

    if (ch.readyState === "open") {
      try {
        ch.send(text);
        return true;
      } catch {
        return false;
      }
    }

    if (ch.readyState === "connecting") {
      this.pendingDataMessages.push(text);
      return true;
    }

    return false;
  }

  getChatChannelState() {
    return String((this.dataChannel as any)?.readyState ?? "closed");
  }

  async getIcePathInfo(): Promise<IcePathInfo> {
    try {
      const pcAny: any = this.pc as any;
      if (typeof pcAny.getStats !== "function") return {};

      const report = await pcAny.getStats();
      const stats: any[] = [];
      forEachStat(report, (s) => stats.push(s));

      const byId = new Map<string, any>();
      for (const s of stats) {
        if (s && typeof s.id === "string") byId.set(s.id, s);
      }

      let selectedPairId: string | undefined = undefined;
      for (const s of stats) {
        if (s?.type === "transport" && typeof s.selectedCandidatePairId === "string") {
          selectedPairId = s.selectedCandidatePairId;
          break;
        }
      }

      let pair: any = selectedPairId ? byId.get(selectedPairId) : null;
      if (!pair) {
        const candidates = stats.filter((s) => s?.type === "candidate-pair");
        pair =
          candidates.find((p) => p?.selected === true) ||
          candidates.find((p) => p?.nominated === true) ||
          null;

        if (pair?.id && typeof pair.id === "string") selectedPairId = pair.id;
      }

      if (!pair) return { selectedPairId };

      const localId = pair.localCandidateId;
      const remoteId = pair.remoteCandidateId;

      const local = typeof localId === "string" ? byId.get(localId) : null;
      const remote = typeof remoteId === "string" ? byId.get(remoteId) : null;

      const info: IcePathInfo = {
        selectedPairId,
        currentRoundTripTimeMs: Number.isFinite(pair.currentRoundTripTime)
          ? Math.round(pair.currentRoundTripTime * 1000)
          : undefined,
        availableOutgoingBitrate: Number.isFinite(pair.availableOutgoingBitrate) ? pair.availableOutgoingBitrate : undefined,
        bytesSent: Number.isFinite(pair.bytesSent) ? pair.bytesSent : undefined,
        bytesReceived: Number.isFinite(pair.bytesReceived) ? pair.bytesReceived : undefined,
      };

      if (local) {
        info.localCandidateType = typeof local.candidateType === "string" ? local.candidateType : undefined;
        info.localProtocol = typeof local.protocol === "string" ? local.protocol : undefined;
        info.localAddress = typeof local.address === "string" ? local.address : typeof local.ip === "string" ? local.ip : undefined;
        info.localPort = Number.isFinite(local.port) ? local.port : undefined;
      }

      if (remote) {
        info.remoteCandidateType = typeof remote.candidateType === "string" ? remote.candidateType : undefined;
        info.remoteProtocol = typeof remote.protocol === "string" ? remote.protocol : undefined;
        info.remoteAddress = typeof remote.address === "string" ? remote.address : typeof remote.ip === "string" ? remote.ip : undefined;
        info.remotePort = Number.isFinite(remote.port) ? remote.port : undefined;
      }

      return info;
    } catch {
      return {};
    }
  }

  async getLocalAudioLevel(): Promise<number> {
    try {
      const report = await this.getAudioStatsReport("local");
      return this.extractAudioLevelFromReport(report, "local");
    } catch {
      return 0;
    }
  }

  async getRemoteAudioLevel(): Promise<number> {
    try {
      const report = await this.getAudioStatsReport("remote");
      return this.extractAudioLevelFromReport(report, "remote");
    } catch {
      return 0;
    }
  }

  private async getAudioStatsReport(direction: "local" | "remote") {
    const pcAny: any = this.pc as any;
    const list = direction === "local" ? pcAny.getSenders?.() : pcAny.getReceivers?.();
    if (Array.isArray(list)) {
      const audioEntry = list.find((item: any) => String(item?.track?.kind || "").trim().toLowerCase() === "audio");
      if (audioEntry && typeof audioEntry.getStats === "function") {
        try {
          return await audioEntry.getStats();
        } catch {}
      }
    }
    if (typeof pcAny.getStats === "function") {
      return await pcAny.getStats();
    }
    return null;
  }

  private extractAudioLevelFromReport(report: any, direction: "local" | "remote"): number {
    if (!report) return 0;

    let detectedLevel = 0;
    let energyLevel = 0;

    const normalizeLevel = (raw: unknown) => {
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) return 0;
      if (value <= 1) return Math.max(0, Math.min(1, value));
      if (value <= 32767) return Math.max(0, Math.min(1, value / 32767));
      return 1;
    };

    const readBooleanActivity = (raw: unknown) => {
      if (raw === true) return 0.32;
      const text = String(raw ?? "").trim().toLowerCase();
      if (text === "true" || text === "1" || text === "yes") return 0.32;
      return 0;
    };

    const isLikelyAudioRow = (row: any) => {
      const hints = [
        row?.kind,
        row?.mediaType,
        row?.trackKind,
        row?.trackIdentifier,
        row?.mediaSourceId,
        row?.trackId,
        row?.id,
        row?.type,
      ]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => value.length > 0);

      if (hints.some((value) => value.includes("audio"))) return true;
      return (
        "audioLevel" in row ||
        "audio_level" in row ||
        "voiceActivityLevel" in row ||
        "voiceActivityFlag" in row ||
        "audioInputLevel" in row ||
        "audioOutputLevel" in row ||
        "totalAudioEnergy" in row ||
        "totalSamplesDuration" in row
      );
    };

    forEachStat(report, (stat) => {
      const row = stat && typeof stat === "object" ? stat : null;
      if (!row || !isLikelyAudioRow(row)) return;

      const directCandidates = [
        (row as any).audioLevel,
        (row as any).audio_level,
        (row as any).voiceActivityLevel,
        (row as any).audioInputLevel,
        (row as any).audioOutputLevel,
      ];

      directCandidates.forEach((candidate) => {
        const level = normalizeLevel(candidate);
        if (level > detectedLevel) {
          detectedLevel = level;
        }
      });

      const booleanCandidates = [
        (row as any).voiceActivityFlag,
        (row as any).voiceActivityDetected,
        (row as any).speechDetected,
        (row as any).speechActivity,
      ];
      booleanCandidates.forEach((candidate) => {
        const level = readBooleanActivity(candidate);
        if (level > detectedLevel) {
          detectedLevel = level;
        }
      });

      const totalAudioEnergy = Number((row as any).totalAudioEnergy);
      const totalSamplesDuration = Number((row as any).totalSamplesDuration);
      const prevEnergy = direction === "local" ? this.lastLocalAudioEnergy : this.lastRemoteAudioEnergy;
      const prevDuration = direction === "local" ? this.lastLocalAudioDuration : this.lastRemoteAudioDuration;

      if (
        Number.isFinite(totalAudioEnergy) &&
        Number.isFinite(totalSamplesDuration) &&
        totalAudioEnergy >= 0 &&
        totalSamplesDuration > 0 &&
        prevEnergy != null &&
        prevDuration != null
      ) {
        const energyDelta = totalAudioEnergy - prevEnergy;
        const durationDelta = totalSamplesDuration - prevDuration;
        if (energyDelta > 0 && durationDelta > 0) {
          const rmsLevel = Math.sqrt(Math.max(0, energyDelta) / durationDelta);
          energyLevel = Math.max(energyLevel, normalizeLevel(rmsLevel));
        }
      }

      if (Number.isFinite(totalAudioEnergy) && totalAudioEnergy >= 0) {
        if (direction === "local") this.lastLocalAudioEnergy = totalAudioEnergy;
        else this.lastRemoteAudioEnergy = totalAudioEnergy;
      }
      if (Number.isFinite(totalSamplesDuration) && totalSamplesDuration >= 0) {
        if (direction === "local") this.lastLocalAudioDuration = totalSamplesDuration;
        else this.lastRemoteAudioDuration = totalSamplesDuration;
      }
    });

    return Math.max(0, Math.min(1, Math.max(detectedLevel, energyLevel)));
  }

  private startSpeakerphone() {
    try {
      if (this.inCallStarted) return;
      this.inCallStarted = true;

      this.lastAppliedRoute = null;
      this.lastApplyAtMs = 0;

      const IC: any = InCallManager as any;

      IC.start?.({ media: "video", auto: true });
      IC.setKeepScreenOn?.(true);
      IC.setBluetoothOn?.(true);

      this.routeLockUntilMs = Date.now() + 3500;
      this.lastAvailableAudioDevices = [];

      const normalizeList = (raw: any): string[] => {
        if (Array.isArray(raw)) return raw.map((x) => String(x));
        if (typeof raw === "string") {
          try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map((x) => String(x));
          } catch {}
        }
        return [];
      };

      const hasAny = (list: string[], pred: (u: string) => boolean) => {
        return (list || []).some((x) => pred(String(x || "").toUpperCase()));
      };

      const applyRoute = () => {
        const list = this.lastAvailableAudioDevices || [];

        const hasBt =
          hasAny(
            list,
            (u) =>
              u.includes("BLUETOOTH") ||
              u.includes("BT") ||
              u.includes("SCO") ||
              u.includes("A2DP") ||
              u.includes("HFP") ||
              u.includes("HEADSET_BLUETOOTH")
          );

        const hasWired =
          hasAny(list, (u) => u.includes("WIRED") || u.includes("HEADSET") || u.includes("HEADPHONE"));

        let desired = "";
        if (hasBt) desired = "BLUETOOTH";
        else if (hasWired) desired = "WIRED_HEADSET";
        else desired = "SPEAKER_PHONE";

        if (desired === "SPEAKER_PHONE" && Date.now() < this.routeLockUntilMs) return;

        const now = Date.now();
        if (this.lastAppliedRoute === desired && now - this.lastApplyAtMs < 600) return;

        this.lastAppliedRoute = desired;
        this.lastApplyAtMs = now;

        if (desired === "BLUETOOTH") {
          IC.setForceSpeakerphoneOn?.(false);
          IC.setSpeakerphoneOn?.(false);
          IC.setBluetoothOn?.(true);
          IC.chooseAudioRoute?.("BLUETOOTH");
          return;
        }

        if (desired === "WIRED_HEADSET") {
          IC.setBluetoothOn?.(false);
          IC.setForceSpeakerphoneOn?.(false);
          IC.setSpeakerphoneOn?.(false);
          IC.chooseAudioRoute?.("WIRED_HEADSET");
          return;
        }

        IC.setBluetoothOn?.(false);
        IC.chooseAudioRoute?.("SPEAKER_PHONE");
        IC.setForceSpeakerphoneOn?.(true);
        IC.setSpeakerphoneOn?.(true);
      };

      if (!this.audioDeviceSub && typeof IC.addEventListener === "function") {
        this.audioDeviceSub = IC.addEventListener("onAudioDeviceChanged", (data: any) => {
          const avail = normalizeList(data?.availableAudioDeviceList);
          this.lastAvailableAudioDevices = avail as any;
          applyRoute();
        });
      }

      setTimeout(() => {
        try {
          applyRoute();
        } catch {}
      }, 300);

      setTimeout(() => {
        try {
          applyRoute();
        } catch {}
      }, 900);

      setTimeout(() => {
        try {
          applyRoute();
        } catch {}
      }, 2000);

      setTimeout(() => {
        try {
          applyRoute();
        } catch {}
      }, 3600);
    } catch {}
  }

  private stopSpeakerphone() {
    try {
      if (!this.inCallStarted) return;
      this.inCallStarted = false;

      const IC: any = InCallManager as any;

      try {
        this.audioDeviceSub?.remove?.();
      } catch {}
      try {
        if (typeof this.audioDeviceSub === "function") this.audioDeviceSub();
      } catch {}
      this.audioDeviceSub = null;

      this.lastAvailableAudioDevices = [];
      this.routeLockUntilMs = 0;
      this.lastAppliedRoute = null;
      this.lastApplyAtMs = 0;

      IC.setBluetoothOn?.(false);
      IC.setKeepScreenOn?.(false);
      IC.stop?.();
    } catch {}
  }

  async ensurePermissions() {
    if (Platform.OS !== "android") return;

    const cam = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);

    if (cam !== "granted" || mic !== "granted") throw new Error("PERMISSION_DENIED");
  }

  private async tuneSenders() {
    try {
      const senders: any[] = (this.pc as any).getSenders?.() ?? [];
      for (const sender of senders) {
        const kind = sender?.track?.kind;

        if (kind === "video" && typeof sender.getParameters === "function" && typeof sender.setParameters === "function") {
          const params = sender.getParameters() || {};
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

          params.encodings[0].maxBitrate = VIDEO_MAX_BITRATE;
          params.encodings[0].maxFramerate = VIDEO_FPS;
          params.degradationPreference = "balanced";

          try {
            await sender.setParameters(params);
          } catch {}
        }

        if (kind === "audio" && typeof sender.getParameters === "function" && typeof sender.setParameters === "function") {
          const params = sender.getParameters() || {};
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];

          params.encodings[0].maxBitrate = AUDIO_MAX_BITRATE;

          try {
            await sender.setParameters(params);
          } catch {}
        }
      }
    } catch {}
  }

  private async openLocalMediaStream() {
    let stream: any = null;

    try {
      stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: "user",
          frameRate: { ideal: VIDEO_FPS, max: VIDEO_FPS },
          width: { ideal: VIDEO_W, max: VIDEO_W },
          height: { ideal: VIDEO_H, max: VIDEO_H },
        },
      } as any);
    } catch {
      stream = await mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: "user",
          frameRate: { ideal: 20, max: 20 },
          width: { ideal: 640, max: 640 },
          height: { ideal: 480, max: 480 },
        },
      } as any);
    }

    return stream as MediaStream;
  }

  private resolveTrackEnabledState(tracks: any[] | undefined, fallback: boolean) {
    if (!Array.isArray(tracks) || tracks.length === 0) return fallback;
    return tracks.some((track: any) => Boolean(track?.enabled));
  }

  private applyLocalTrackEnabledState(stream: MediaStream, videoEnabled: boolean, audioEnabled: boolean) {
    try {
      (stream as any)?.getVideoTracks?.()?.forEach((track: any) => {
        track.enabled = videoEnabled;
      });
    } catch {}

    try {
      (stream as any)?.getAudioTracks?.()?.forEach((track: any) => {
        track.enabled = audioEnabled;
      });
    } catch {}
  }

  private stopMediaStream(stream: MediaStream | null | undefined) {
    try {
      (stream as any)?.getTracks?.()?.forEach((track: any) => track?.stop?.());
    } catch {}
  }

  async startLocal() {
    await this.ensurePermissions();

    this.startSpeakerphone();

    const stream = await this.openLocalMediaStream();

    this.localStream = stream as any;
    (stream as any).getTracks().forEach((t: any) => (this.pc as any).addTrack(t, stream));

    await this.tuneSenders();

    this.cb.onLocalStream?.(stream as any);
  }

  async refreshLocalMedia(opts?: { videoEnabled?: boolean; audioEnabled?: boolean }) {
    await this.ensurePermissions();

    this.startSpeakerphone();

    const previousStream = this.localStream;
    let nextStream: MediaStream;
    try {
      nextStream = await this.openLocalMediaStream();
    } catch (firstError) {
      if (!previousStream) throw firstError;
      this.stopMediaStream(previousStream);
      nextStream = await this.openLocalMediaStream();
    }
    const videoEnabled =
      typeof opts?.videoEnabled === "boolean"
        ? opts.videoEnabled
        : this.resolveTrackEnabledState((previousStream as any)?.getVideoTracks?.(), true);
    const audioEnabled =
      typeof opts?.audioEnabled === "boolean"
        ? opts.audioEnabled
        : this.resolveTrackEnabledState((previousStream as any)?.getAudioTracks?.(), true);

    this.applyLocalTrackEnabledState(nextStream, videoEnabled, audioEnabled);

    const senders: any[] = ((this.pc as any)?.getSenders?.() ?? []) as any[];
    const nextTracks = ((nextStream as any)?.getTracks?.() ?? []) as any[];
    for (const track of nextTracks) {
      const kind = String(track?.kind || "").toLowerCase();
      const sender = senders.find((candidate) => String(candidate?.track?.kind || "").toLowerCase() === kind);
      if (sender && typeof sender.replaceTrack === "function") {
        try {
          await sender.replaceTrack(track);
          continue;
        } catch {}
      }

      try {
        (this.pc as any).addTrack(track, nextStream);
      } catch {}
    }

    this.localStream = nextStream;

    await this.tuneSenders();

    this.cb.onLocalStream?.(nextStream);

    if (previousStream && previousStream !== nextStream) {
      this.stopMediaStream(previousStream);
    }

    return nextStream;
  }

  async createOffer() {
    const offer = await (this.pc as any).createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });

    if (offer?.sdp) {
      offer.sdp = preferH264InSdp(offer.sdp);
    }

    await (this.pc as any).setLocalDescription(offer);
    return offer;
  }

  async acceptOfferAndCreateAnswer(offer: any) {
    const pcAny: any = this.pc as any;
    const signalingState = this.getSignalingState();
    if (signalingState && signalingState !== "stable") {
      try {
        await pcAny.setLocalDescription({ type: "rollback" });
      } catch {}
    }

    await (this.pc as any).setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushPendingRemoteCandidates();
    const ans = await (this.pc as any).createAnswer();

    if (ans?.sdp) {
      ans.sdp = preferH264InSdp(ans.sdp);
    }

    await (this.pc as any).setLocalDescription(ans);
    return ans;
  }

  async acceptAnswer(answer: any) {
    const signalingState = this.getSignalingState();
    if (signalingState === "stable" && this.hasRemoteDescription()) {
      return;
    }
    if (signalingState && signalingState !== "have-local-offer") {
      return;
    }
    await (this.pc as any).setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushPendingRemoteCandidates();
  }

  async addCandidate(candidate: any) {
    if (!candidate) return;
    if (!this.hasRemoteDescription()) {
      this.pendingRemoteCandidates.push(candidate);
      return;
    }
    try {
      await (this.pc as any).addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      this.pendingRemoteCandidates.push(candidate);
    }
  }

  async start({ isCaller }: { isCaller: boolean }) {
    await this.startLocal();

    if (isCaller) {
      this.ensureCallerDataChannel();
      const offer = await this.createOffer();
      this.cb.onOffer?.(offer);
    }
  }

  async handleRemoteOffer(offer: any) {
    return this.enqueueSignalTask(async () => {
      const ans = await this.acceptOfferAndCreateAnswer(offer);
      this.cb.onAnswer?.(ans);
      return ans;
    });
  }

  async handleRemoteAnswer(answer: any) {
    return this.enqueueSignalTask(async () => {
      await this.acceptAnswer(answer);
    });
  }

  async handleRemoteIce(candidate: any) {
    return this.enqueueSignalTask(async () => {
      await this.addCandidate(candidate);
    });
  }

  async restartIce() {
    return this.enqueueSignalTask(async () => {
      try {
        const pcAny: any = this.pc as any;
        const signalingState = this.getSignalingState();
        if (signalingState && signalingState !== "stable") {
          return false;
        }
        if (typeof pcAny.restartIce === "function") {
          try {
            pcAny.restartIce();
          } catch {}
        }

        const offer = await pcAny.createOffer({
          iceRestart: true,
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });

        if (offer?.sdp) {
          offer.sdp = preferH264InSdp(offer.sdp);
        }

        await pcAny.setLocalDescription(offer);
        this.cb.onOffer?.(offer);
        return true;
      } catch {
        return false;
      }
    });
  }

  setLocalVideoEnabled(on: boolean) {
    const v = (this.localStream as any)?.getVideoTracks?.() ?? [];
    v.forEach((t: any) => (t.enabled = on));
  }

  setLocalAudioEnabled(on: boolean) {
    const a = (this.localStream as any)?.getAudioTracks?.() ?? [];
    a.forEach((t: any) => (t.enabled = on));
  }

  stop() {
    this.stopSpeakerphone();

    this.stopMediaStream(this.localStream);
    try {
      (this.dataChannel as any)?.close?.();
    } catch {}
    try {
      (this.pc as any).close?.();
    } catch {}
    this.localStream = null;
    this.remoteStream = null;
    this.dataChannel = null;
    this.pendingDataMessages = [];
    this.pendingRemoteCandidates = [];
    this.signalTask = Promise.resolve();
    this.lastNotifiedConnectionState = "";
    this.lastLocalAudioEnergy = null;
    this.lastLocalAudioDuration = null;
  }
}
