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

  private baseUrl: string = "";
  private token: string = "";
  private sessionId: string = "";

  private registered = false;
  private openNotified = false;
  private closeNotified = false;

  private pending: any[] = [];

  // ✅ reconnect/backoff
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;

  private socketSeq = 0;
  private currentSocketId = 0;

  // ✅ 큐 유지(재연결 후 자동 enqueue 용)
  private wantEnqueue = false;
  private lastEnqueuePayload: { country: string; gender: string; platform: string } | null = null;

  private ended = false; // 중복 end 방지용

  constructor(cb: Cb) {
    this.cb = cb;
  }

  async connect(baseUrl: string, token: string | null) {
    // ✅ 기존 reconnect 예약이 있으면 취소
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    // ✅ 기존 ws 정리(중복 이벤트로 상태 꼬임 방지)
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    this.baseUrl = String(baseUrl || "").trim();
    this.manualClose = false;

    const deviceKey = await getOrCreateDeviceKey();
    this.sessionId = String(deviceKey || "").trim();
    this.token = String(token || "").trim();

    this.registered = false;
    this.openNotified = false;
    this.closeNotified = false;
    this.pending = [];

    this.wantEnqueue = false;
    this.lastEnqueuePayload = null;

    this.reconnectAttempt = 0;

    this.ended = false; // reset on new connect

    this.openSocket();
  }

  private openSocket() {
    if (!this.baseUrl) {
      this.cb.onMessage({ type: "error", message: "MISSING_SIGNALING_URL" });
      return;
    }

    const socketId = ++this.socketSeq;
    this.currentSocketId = socketId;

    // ✅ 이전 ws 정리
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    this.registered = false;
    this.closeNotified = false;

    const ws = new WebSocket(this.baseUrl);
    this.ws = ws;

    const closeOrErrorOnce = () => {
      if (this.currentSocketId !== socketId) return; // stale
      if (this.closeNotified) return;
      this.closeNotified = true;

      // ✅ 연결 끊기면 등록 상태만 초기화(통화/매칭 종료는 CallScreen에서 판단)
      this.registered = false;

      // ✅ ws 참조 제거
      try {
        this.ws?.close();
      } catch {}
      this.ws = null;

      // ✅ 수동 close가 아니면 자동 재연결(backoff)
      if (!this.manualClose) {
        return;
      }

      // ✅ 수동 close면 기존 동작 유지(필요 시 UI 정리)
      this.cb.onClose();
    };

    ws.onopen = () => {
      if (this.currentSocketId !== socketId) return; // stale

      // 서버 요구: register(token+sessionId) 먼저
      if (!this.token || !this.sessionId) {
        this.cb.onMessage({ type: "error", message: "REGISTER_REQUIRES_TOKEN_AND_SESSIONID" });
        try {
          ws.close();
        } catch {}
        return;
      }

      // ✅ 여기서 onOpen 호출하지 않음(등록 확인 전 enqueue -> not_registered 루프 원인)
      this.sendRaw({ type: "register", token: this.token, sessionId: this.sessionId });
    };

    ws.onclose = () => {
      closeOrErrorOnce();
    };

    ws.onerror = () => {
      closeOrErrorOnce();
    };

    ws.onmessage = (ev: any) => {
      if (this.currentSocketId !== socketId) return; // stale

      try {
        const msg = JSON.parse(String(ev?.data ?? "{}")) as ServerMessage;

        if (msg?.type === "registered") {
          this.registered = true;
          this.reconnectAttempt = 0;

          if (!this.openNotified) {
            this.openNotified = true;
            this.cb.onOpen();
          }

          // ✅ 재연결 시에도 통화/대기 로직이 꼬이지 않도록:
          // 1) pending flush
          const q = this.pending.slice();
          this.pending = [];
          q.forEach((x) => this.sendRaw(x));

          // 2) 큐 유지가 필요한 경우(대기 중 끊김) 자동 enqueue
          if (this.wantEnqueue && this.lastEnqueuePayload) {
            this.sendRaw({ type: "enqueue", ...this.lastEnqueuePayload });
          }

          return;
        }

        if (msg?.type === "enqueued") {
          this.cb.onMessage({ type: "queued" });
          return;
        }

        if (msg?.type === "matched") {
          // ✅ 매칭되면 더 이상 큐 유지/자동 enqueue 하지 않음
          this.wantEnqueue = false;
          this.lastEnqueuePayload = null;

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
    // ✅ 재연결 후 자동으로 다시 enqueue되게 유지
    this.wantEnqueue = true;
    this.lastEnqueuePayload = { country, gender, platform: Platform.OS };

    // ✅ 서버가 country/gender를 무시해도 문제 없음(추가 필드 허용)
    // ✅ registered 전이면 등록 후 자동 enqueue로 처리(중복 enqueue 방지)
    if (!this.registered) return;

    this.sendRaw({ type: "enqueue", ...this.lastEnqueuePayload });
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
    // ✅ 재연결 후 자동 enqueue 하지 않도록 해제
    this.wantEnqueue = false;
    this.lastEnqueuePayload = null;

    this.send({ type: "dequeue" });
  }

  // CallScreen.tsx에서 인자로 호출하므로 optional 처리
  leaveRoom(roomId?: string) {
    // ✅ 룸을 떠나면 큐 유지 플래그도 해제
    this.wantEnqueue = false;
    this.lastEnqueuePayload = null;

    // 서버는 roomId 없이도 처리하지만, 있어도 무방
    this.send({ type: "leave", roomId: roomId || undefined });
  }

  close() {
    // ✅ 수동 종료: 재연결 금지
    this.manualClose = true;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    this.registered = false;
    this.openNotified = false;
    this.closeNotified = false;
    this.pending = [];

    this.wantEnqueue = false;
    this.lastEnqueuePayload = null;

    this.reconnectAttempt = 0;
  }

  private send(obj: any) {
    // ✅ registered 전이면 큐잉(등록 확인 전 enqueue로 not_registered 나는 것 방지)
    if (!this.registered && obj?.type !== "register") {
      if (this.pending.length < 100) this.pending.push(obj);
      return;
    }

    // ✅ ws가 잠깐 끊긴 상태면(재연결 중) pending으로 보관
    if (!this.ws || (this.ws as any).readyState !== 1) {
      if (obj?.type !== "register" && this.pending.length < 100) this.pending.push(obj);
      return;
    }

    this.sendRaw(obj);
  }

  private sendRaw(obj: any) {
    try {
      this.ws?.send(JSON.stringify(obj));
    } catch {
      // ✅ 전송 실패(끊김)면 pending으로 보관(재연결 후 flush)
      if (obj?.type !== "register" && this.pending.length < 100) this.pending.push(obj);
      try {
        // 재연결 예약
        if (!this.manualClose) {}
      } catch {}
    }
  }
}