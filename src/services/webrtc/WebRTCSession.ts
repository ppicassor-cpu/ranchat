// FILE: C:\ranchat\src\services\webrtc\WebRTCSession.ts
import { RTCPeerConnection, RTCIceCandidate, RTCSessionDescription, mediaDevices, MediaStream } from "react-native-webrtc";
import { PermissionsAndroid, Platform } from "react-native";
import { APP_CONFIG } from "../../config/app";

type Callbacks = {
  onLocalStream?: (s: MediaStream) => void;
  onRemoteStream?: (s: MediaStream) => void;
  onIceCandidate?: (c: any) => void;
  onConnectionState?: (s: string) => void;

  // ✅ CallScreen.tsx가 넘기는 콜백(없어서 TS 에러였음)
  onOffer?: (sdp: any) => void;
  onAnswer?: (sdp: any) => void;
};

export class WebRTCSession {
  private pc: RTCPeerConnection;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private cb: Callbacks;

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

    this.pc = new RTCPeerConnection({ iceServers } as any);

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

  async ensurePermissions() {
    if (Platform.OS !== "android") return;
    const cam = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (cam !== "granted" || mic !== "granted") throw new Error("PERMISSION_DENIED");
  }

  async startLocal() {
    await this.ensurePermissions();
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: { facingMode: "user", frameRate: 30, width: 640, height: 960 },
    } as any);

    this.localStream = stream as any;
    (stream as any).getTracks().forEach((t: any) => (this.pc as any).addTrack(t, stream));
    this.cb.onLocalStream?.(stream as any);
  }

  async createOffer() {
    const offer = await (this.pc as any).createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await (this.pc as any).setLocalDescription(offer);
    return offer;
  }

  async acceptOfferAndCreateAnswer(offer: any) {
    await (this.pc as any).setRemoteDescription(new RTCSessionDescription(offer));
    const ans = await (this.pc as any).createAnswer();
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
