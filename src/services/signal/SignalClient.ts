// FILE: C:\ranchat\src\services\signal\SignalClient.ts
import { Platform } from "react-native";
import { getOrCreateDeviceKey } from "../device/DeviceKey";

export type SignalMessage =
  | { type: "queued" }
  | { type: "match"; roomId: string; isCaller: boolean }
  | { type: "offer"; sdp: any }
  | { type: "answer"; sdp: any }
  | { type: "ice"; candidate: any }
  | { type: "end" }
  | { type: "peer_cam"; enabled: boolean }
  | { type: "signal"; roomId: string; data: any }
  | { type: "error"; message?: string };

type Cb = {
  onOpen: () => void; // ✅ "registered" 이후에 호출되도록 유지(등록 전 enqueue -> not_registered 루프 방지)
  onClose: () => void;
  onMessage: (m: SignalMessage) => void;
};

type ServerMessage =
  | { type: "hello" }
  | { type: "registered"; sessionId: string }
  | { type: "enqueued"; sessionId: string; queueSize?: number }
  | { type: "dequeued"; sessionId: string; queueSize?: number }
  | { type: "matched"; roomId: string; initiator: boolean; sessionId?: string; peerSessionId?: string }
  | { type: "signal"; roomId: string; fromSessionId?: string; data: any }
  | { type: "peer_left"; roomId?: string; sessionId?: string; peerSessionId?: string }
  | { type: "left"; roomId?: string; sessionId?: string }
  | { type: "left_ok"; roomId?: string | null; sessionId?: string } // ✅ 서버가 떠난 사람에게 주는 ack(무시)
  | { type: "error"; reason?: string; message?: string };

export class SignalClient {
  private ws: WebSocket | null = null;
  private cb: Cb;

  private token: string = "";
  private sessionId: string = "";

  private registered = false;
  private openNotified = false;
  private closeNotified = false;
  private pending: any[] = [];

  constructor(cb: Cb) {
    this.cb = cb;
  }

  async connect(baseUrl: string, token: string | null) {
    // ✅ 기존 연결이 남아있으면 정리(중복 onClose/onError로 상태 꼬임 방지)
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    const deviceKey = await getOrCreateDeviceKey();
    this.sessionId = String(deviceKey || "").trim();
    this.token = String(token || "").trim();

    this.registered = false;
    this.openNotified = false;
    this.closeNotified = false;
    this.pending = [];

    this.ws = new WebSocket(baseUrl);

    this.ws.onopen = () => {
      // 서버 요구: register(token+sessionId) 먼저
      if (!this.token || !this.sessionId) {
        this.cb.onMessage({ type: "error", message: "REGISTER_REQUIRES_TOKEN_AND_SESSIONID" });
        try {
          this.ws?.close();
        } catch {}
        return;
      }

      // ✅ 여기서 onOpen 호출하지 않음(등록 확인 전 enqueue -> not_registered 루프 원인)
      this.sendRaw({ type: "register", token: this.token, sessionId: this.sessionId });
    };

    const closeOnce = () => {
      if (this.closeNotified) return;
      this.closeNotified = true;

      // 연결 끊기면 등록 상태도 초기화
      this.registered = false;
      this.openNotified = false;
      this.pending = [];

      this.cb.onClose();
    };

    this.ws.onclose = () => {
      closeOnce();
    };

    this.ws.onerror = () => {
      closeOnce();
    };

    this.ws.onmessage = (ev: any) => {
      try {
        const msg = JSON.parse(String(ev?.data ?? "{}")) as ServerMessage;

        if (msg?.type === "registered") {
          this.registered = true;

          if (!this.openNotified) {
            this.openNotified = true;
            this.cb.onOpen();
          }

          // pending flush
          const q = this.pending.slice();
          this.pending = [];
          q.forEach((x) => this.sendRaw(x));
          return;
        }

        if (msg?.type === "enqueued") {
          this.cb.onMessage({ type: "queued" });
          return;
        }

        if (msg?.type === "matched") {
          this.cb.onMessage({ type: "match", roomId: msg.roomId, isCaller: !!msg.initiator });
          return;
        }

        // ✅ 떠난 사람에게 오는 ack는 무시(상대 종료로 오해하지 않기)
        if (msg?.type === "left_ok") {
          return;
        }

        if (msg?.type === "peer_left" || msg?.type === "left") {
          this.cb.onMessage({ type: "end" });
          return;
        }

        if (msg?.type === "signal") {
          const d: any = msg.data;
          const t = String(d?.type ?? d?.kind ?? "").toLowerCase();

          if (t === "offer") {
            this.cb.onMessage({ type: "offer", sdp: d });
            return;
          }
          if (t === "answer") {
            this.cb.onMessage({ type: "answer", sdp: d });
            return;
          }
          if (t === "ice") {
            const cand = d?.candidate ?? d;
            this.cb.onMessage({ type: "ice", candidate: cand });
            return;
          }
          if (t === "end" || t === "leave") {
            this.cb.onMessage({ type: "end" });
            return;
          }

          // ✅ 상대 카메라 ON/OFF 상태(선택적으로 사용 가능)
          if (t === "cam_state") {
            const enabled = Boolean(d?.enabled ?? d?.on ?? d?.camOn ?? d?.videoEnabled ?? d?.videoOn);
            this.cb.onMessage({ type: "peer_cam", enabled });
            return;
          }

          this.cb.onMessage({ type: "signal", roomId: msg.roomId, data: d });
          return;
        }

        if (msg?.type === "error") {
          const m = String(msg.message || msg.reason || "UNKNOWN_ERROR");
          this.cb.onMessage({ type: "error", message: m });
          return;
        }
      } catch {
        this.cb.onMessage({ type: "error", message: "INVALID_MESSAGE" });
      }
    };
  }

  enqueue(country: string, gender: string) {
    // 서버가 country/gender를 무시해도 문제 없음(추가 필드 허용)
    this.send({ type: "enqueue", country, gender, platform: Platform.OS });
  }

  // CallScreen.tsx 호환
  sendOffer(roomId: string, sdp: any) {
    this.relay(roomId, sdp);
  }

  sendAnswer(roomId: string, sdp: any) {
    this.relay(roomId, sdp);
  }

  sendIce(roomId: string, candidate: any) {
    this.relay(roomId, { type: "ice", candidate });
  }

  // ✅ 내 카메라 ON/OFF 상태를 상대에게 알림(서버 최상위 타입 추가 없이 signal로 전송)
  sendCamState(roomId: string, enabled: boolean) {
    this.relay(roomId, { type: "cam_state", enabled: !!enabled });
  }

  relay(roomId: string, data: any) {
    this.send({ type: "signal", roomId, data });
  }

  leaveQueue() {
    this.send({ type: "dequeue" });
  }

  // CallScreen.tsx에서 인자로 호출하므로 optional 처리
  leaveRoom(roomId?: string) {
    // 서버는 roomId 없이도 처리하지만, 있어도 무방
    this.send({ type: "leave", roomId: roomId || undefined });
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    this.registered = false;
    this.openNotified = false;
    this.closeNotified = false;
    this.pending = [];
  }

  private send(obj: any) {
    // ✅ registered 전이면 큐잉(등록 확인 전 enqueue로 not_registered 나는 것 방지)
    if (!this.registered && obj?.type !== "register") {
      if (this.pending.length < 50) this.pending.push(obj);
      return;
    }
    this.sendRaw(obj);
  }

  private sendRaw(obj: any) {
    try {
      this.ws?.send(JSON.stringify(obj));
    } catch {}
  }
}
