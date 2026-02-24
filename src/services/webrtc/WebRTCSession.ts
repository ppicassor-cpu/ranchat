import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices, MediaStream } from "react-native-webrtc";
import { PermissionsAndroid, Platform } from "react-native";
import { APP_CONFIG } from "../../config/app";

import InCallManager from "../../../modules/ranchat-call-audio";

type Callbacks = {
  onLocalStream?: (s: MediaStream) => void;
  onRemoteStream?: (s: MediaStream) => void;
  onIceCandidate?: (c: any) => void;
  onConnectionState?: (s: string) => void;

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
  private cb: Callbacks;
  private inCallStarted: boolean = false;
  private audioDeviceSub: any = null;
  private routeLockUntilMs: number = 0;
  private lastAvailableAudioDevices: string[] = [];
  private lastAppliedRoute: string | null = null;
  private lastApplyAtMs: number = 0;

  constructor(cb: Callbacks) {
    this.cb = cb;

    const turn = APP_CONFIG.TURN;

    const stunUrls = (APP_CONFIG as any)?.ICE?.stunUrls ?? [];
    const stunServer =
      Array.isArray(stunUrls) && stunUrls.length > 0
        ? { urls: stunUrls }
        : { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

    const turnUrls = [`turn:${turn.host}:${turn.port}?transport=udp`];
    if ((turn as any).tcpEnabled === true) {
      turnUrls.push(`turn:${turn.host}:${turn.port}?transport=tcp`);
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
      this.cb.onConnectionState?.(pcAny.connectionState);
    };

    pcAny.ontrack = (e: any) => {
      const stream = (e?.streams && e.streams[0]) || null;
      if (stream) {
        this.remoteStream = stream;
        this.cb.onRemoteStream?.(stream);
      }
    };
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

    try {
      const btConnect = (PermissionsAndroid as any)?.PERMISSIONS?.BLUETOOTH_CONNECT;
      if (Platform.Version >= 31 && typeof btConnect === "string") {
        await (PermissionsAndroid as any).request(btConnect);
      }
    } catch {}
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

  async startLocal() {
    await this.ensurePermissions();

    this.startSpeakerphone();

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

    this.localStream = stream as any;
    (stream as any).getTracks().forEach((t: any) => (this.pc as any).addTrack(t, stream));

    await this.tuneSenders();

    this.cb.onLocalStream?.(stream as any);
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
    await (this.pc as any).setRemoteDescription(new RTCSessionDescription(offer));
    const ans = await (this.pc as any).createAnswer();

    if (ans?.sdp) {
      ans.sdp = preferH264InSdp(ans.sdp);
    }

    await (this.pc as any).setLocalDescription(ans);
    return ans;
  }

  async acceptAnswer(answer: any) {
    await (this.pc as any).setRemoteDescription(new RTCSessionDescription(answer));
  }

  async addCandidate(candidate: any) {
    try {
      await (this.pc as any).addIceCandidate(new RTCIceCandidate(candidate));
    } catch {}
  }

  async start({ isCaller }: { isCaller: boolean }) {
    await this.startLocal();

    if (isCaller) {
      const offer = await this.createOffer();
      this.cb.onOffer?.(offer);
    }
  }

  async handleRemoteOffer(offer: any) {
    const ans = await this.acceptOfferAndCreateAnswer(offer);
    this.cb.onAnswer?.(ans);
    return ans;
  }

  async handleRemoteAnswer(answer: any) {
    await this.acceptAnswer(answer);
  }

  async handleRemoteIce(candidate: any) {
    await this.addCandidate(candidate);
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

    try {
      (this.localStream as any)?.getTracks?.()?.forEach((t: any) => t.stop?.());
    } catch {}
    try {
      (this.pc as any).close?.();
    } catch {}
    this.localStream = null;
    this.remoteStream = null;
  }
}
