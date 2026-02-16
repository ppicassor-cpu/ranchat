//WebRTCSession.ts
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices, MediaStream } from "react-native-webrtc";
import { PermissionsAndroid, Platform } from "react-native";
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

const VIDEO_W = 720;
const VIDEO_H = 1280;
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

export class WebRTCSession {
  private pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private cb: Callbacks;
  private inCallStarted: boolean = false;

  constructor(cb: Callbacks) {
    this.cb = cb;

    const turn = APP_CONFIG.TURN;
    const iceServers = [
      { urls: [`stun:${turn.host}:${turn.port}`] },
      {
        urls: [`turn:${turn.host}:${turn.port}?transport=udp`, `turn:${turn.host}:${turn.port}?transport=tcp`],
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

  private startSpeakerphone() {
    try {
      if (this.inCallStarted) return;
      this.inCallStarted = true;

      const IC: any = InCallManager as any;

      IC.start?.({ media: "video" });
      IC.setKeepScreenOn?.(true);

      // 스피커폰 강제
      IC.setForceSpeakerphoneOn?.(true);
      IC.setSpeakerphoneOn?.(true);
    } catch {}
  }

  private stopSpeakerphone() {
    try {
      if (!this.inCallStarted) return;
      this.inCallStarted = false;

      const IC: any = InCallManager as any;

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

  async startLocal() {
    await this.ensurePermissions();

    // ✅ 스피커폰 ON
    this.startSpeakerphone();

    // 720p/24fps(과하지 않게) + 실패 시 한 단계 다운 폴백
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
          height: { ideal: 960, max: 960 },
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
