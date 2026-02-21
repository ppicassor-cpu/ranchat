// FILE: C:\ranchat\src\services\webrtc\WebRTCSession.ts 
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices, MediaStream } from "react-native-webrtc";
import { PermissionsAndroid, Platform, DeviceEventEmitter } from "react-native";
import { APP_CONFIG } from "../../config/app";

// @ts-ignore
import InCallManager from "react-native-incall-manager";

type Callbacks = {
  onLocalStream?: (s: MediaStream) => void;
  onRemoteStream?: (s: MediaStream) => void;
  onIceCandidate?: (c: any) => void;
  onConnectionState?: (s: string) => void;

  // ✅ CallScreen.tsx가 넘기는 콜백(없어서 TS 에러였음)
  onOffer?: (sdp: any) => void;
  onAnswer?: (sdp: any) => void;
};

// ✅ 4:3 송출 유도 (세로 과확대/크롭 감소 목적)
const VIDEO_W = 720;
const VIDEO_H = 540;
const VIDEO_FPS = 24;

// 모바일 체감 기준(끊김/딜레이 줄이기용 상한)
// 720p 24fps에 과하지 않은 범위로 제한
const VIDEO_MAX_BITRATE = 1_200_000; // 1.2Mbps
const AUDIO_MAX_BITRATE = 64_000; // 64kbps (옵션)

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
  private wiredHeadsetSub: any = null;
  private wiredHeadsetPlugged: boolean | null = null;
  private audioDeviceSub: any = null;
  private routeLockUntilMs: number = 0;
  private lastAvailableAudioDevices: string[] = [];

  constructor(cb: Callbacks) {
    this.cb = cb;

    const turn = APP_CONFIG.TURN;

    // ✅ 2번 반영: STUN을 TURN과 분리 (srflx 후보 확보)
    const stunUrls = (APP_CONFIG as any)?.ICE?.stunUrls ?? [];
    const stunServer =
      Array.isArray(stunUrls) && stunUrls.length > 0
        ? { urls: stunUrls }
        : { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] };

    // ✅ 3번 반영: 기본은 TURN TCP 후보 제외(딜레이 큰 TCP 릴레이 회피)
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
        // 연결 시 초반 후보 수집/연결 체감 조금 개선되는 경우가 있어 소량만
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

  // ✅ 1번 반영: 연결 경로( relay/srflx/host ) 확인용
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

      // 1) transport에서 selectedCandidatePairId 우선 탐색
      let selectedPairId: string | undefined = undefined;
      for (const s of stats) {
        if (s?.type === "transport" && typeof s.selectedCandidatePairId === "string") {
          selectedPairId = s.selectedCandidatePairId;
          break;
        }
      }

      // 2) 없으면 candidate-pair 중 selected/nominated 찾아서 선택
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

      const IC: any = InCallManager as any;

      IC.start?.({ media: "video", auto: true });
      IC.setKeepScreenOn?.(true);

      // ✅ 구조 변경: BT/유선이 "있으면" 그쪽 우선 → 일정 시간 안 들어오면 스피커 강제(earpiece 금지)
      // (초기부터 스피커를 force로 박아버리면 BT로 넘어갈 여지가 줄어드는 케이스가 있어, fallback 시점에만 강제)
      IC.setBluetoothOn?.(true);

      this.routeLockUntilMs = Date.now() + 1200; // BT/유선 이벤트가 늦게 오는 단말 대비
      this.wiredHeadsetPlugged = null;
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
          hasAny(list, (u) => u.includes("BLUETOOTH") || u.includes("BT"));

        const hasWired =
          this.wiredHeadsetPlugged === true ||
          hasAny(list, (u) => u.includes("WIRED") || u.includes("HEADSET") || u.includes("HEADPHONE"));

        if (hasBt) {
          IC.setForceSpeakerphoneOn?.(false);
          IC.setSpeakerphoneOn?.(false);
          IC.setBluetoothOn?.(true);
          IC.chooseAudioRoute?.("BLUETOOTH");
          return;
        }

        if (hasWired) {
          IC.setBluetoothOn?.(false);
          IC.setForceSpeakerphoneOn?.(false);
          IC.setSpeakerphoneOn?.(false);
          IC.chooseAudioRoute?.("WIRED_HEADSET");
          return;
        }

        if (Date.now() < this.routeLockUntilMs) return;

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

      if (!this.wiredHeadsetSub) {
        this.wiredHeadsetSub = DeviceEventEmitter.addListener("WiredHeadset", (data: any) => {
          this.wiredHeadsetPlugged = Boolean(data?.isPlugged);
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
    } catch {}
  }

  private stopSpeakerphone() {
    try {
      if (!this.inCallStarted) return;
      this.inCallStarted = false;

      const IC: any = InCallManager as any;

      try {
        this.wiredHeadsetSub?.remove?.();
      } catch {}
      this.wiredHeadsetSub = null;
      this.wiredHeadsetPlugged = null;

      try {
        this.audioDeviceSub?.remove?.();
      } catch {}
      try {
        if (typeof this.audioDeviceSub === "function") this.audioDeviceSub();
      } catch {}
      this.audioDeviceSub = null;

      this.lastAvailableAudioDevices = [];
      this.routeLockUntilMs = 0;

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

    // ✅ 구조적 보완: Android 12(API 31)+ 에서는 BLUETOOTH_CONNECT 없으면 BT 상태/디바이스 감지/라우팅이 막히는 케이스가 있음
    // (매니페스트(app.json/AndroidManifest.xml)에 선언도 필요)
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

    // ✅ 스피커폰 ON(단, BT/유선 우선 구조로 라우팅)
    this.startSpeakerphone();

    // 4:3 / 24fps(과하지 않게) + 실패 시 한 단계 다운 폴백
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
      // ✅ 5번 반영: H264 우선 정렬
      offer.sdp = preferH264InSdp(offer.sdp);
    }

    await (this.pc as any).setLocalDescription(offer);
    return offer;
  }

  async acceptOfferAndCreateAnswer(offer: any) {
    await (this.pc as any).setRemoteDescription(new RTCSessionDescription(offer));
    const ans = await (this.pc as any).createAnswer();

    if (ans?.sdp) {
      // ✅ 5번 반영: H264 우선 정렬
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

  // ✅ CallScreen.tsx 호환 메서드들(없어서 TS 에러였음)
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
