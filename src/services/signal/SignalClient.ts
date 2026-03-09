import { Platform } from "react-native";
import { getOrCreateDeviceKey } from "../device/DeviceKey";
import type { MatchFilter } from "../call/MatchFilterService";

export type SignalMessage =
  | { type: "queued" }
  | { type: "match"; roomId: string; isCaller: boolean; peerSessionId?: string }
  | { type: "offer"; roomId: string; sdp: any }
  | { type: "answer"; roomId: string; sdp: any }
  | { type: "ice"; roomId: string; candidate: any }
  | { type: "end"; roomId?: string; reason?: string }
  | { type: "peer_cam"; roomId?: string; enabled: boolean }
  | { type: "signal"; roomId: string; data: any; fromSessionId?: string }
  | { type: "error"; message?: string };

export type CallContactRpcKind = "friend" | "favorite";

export type CallContactRpcResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  kind: CallContactRpcKind;
  contact?: any;
};

type Cb = {
  onOpen: () => void; // ✅ "registered" 이후에 호출되도록 유지(등록 전 enqueue -> not_registered 루프 방지)
  onReconnect?: () => void;
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
  | { type: "end"; roomId?: string; reason?: string } // ✅ 서버 최상위 end 지원
  | { type: "call_contact_result"; requestId?: string; kind?: CallContactRpcKind; ok?: boolean; errorCode?: string; errorMessage?: string; contact?: any }
  | { type: "error"; reason?: string; message?: string };

type PendingCallContactRpc = {
  kind: CallContactRpcKind;
  resolve: (value: CallContactRpcResult) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type PendingReconnectMessage = {
  payload: any;
  roomId?: string;
  createdAt: number;
};

export class SignalClient {
  private ws: WebSocket | null = null;
  private cb: Cb;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private registerAckTimer: ReturnType<typeof setTimeout> | null = null;
  private enqueueAckTimer: ReturnType<typeof setTimeout> | null = null;

  private baseUrl: string = "";
  private token: string = "";
  private sessionId: string = "";
  private userId: string = "";

  private registered = false;
  private openNotified = false;
  private closeNotified = false;

  private pendingImmediate: PendingReconnectMessage[] = [];
  private pendingRoomMessages = new Map<string, PendingReconnectMessage[]>();
  private activeRoomId = "";

  // ✅ reconnect/backoff
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualClose = false;
  private rpcSeq = 0;
  private pendingCallContactRpc = new Map<string, PendingCallContactRpc>();

  private socketSeq = 0;
  private currentSocketId = 0;

  // ✅ 큐 유지(재연결 후 자동 enqueue 용)
  private wantEnqueue = false;
  private lastEnqueuePayload: { country: string; gender: string; language: string; filter?: MatchFilter; platform: string } | null = null;

  private ended = false; // 중복 end 방지용

  constructor(cb: Cb) {
    this.cb = cb;
  }

  private getReconnectReplayScope(obj: any): "immediate" | "room" | "" {
    const type = String(obj?.type || "").trim().toLowerCase();
    if (type === "wallet_subscribe") {
      return "immediate";
    }
    if (type === "cam") {
      return String(obj?.roomId || "").trim() ? "room" : "";
    }
    if (type !== "signal") {
      return "";
    }

    const roomId = String(obj?.roomId || "").trim();
    if (!roomId) {
      return "";
    }

    const dataType = String(obj?.data?.type ?? obj?.data?.kind ?? "").trim().toLowerCase();
    if (["offer", "answer", "ice", "peer_info", "cam", "cam_state", "mic", "mic_state", "mic_level"].includes(dataType)) {
      return "room";
    }
    return "";
  }

  private queueForReconnect(obj: any) {
    const scope = this.getReconnectReplayScope(obj);
    if (!scope) return false;

    const entry: PendingReconnectMessage = {
      payload: obj,
      roomId: String(obj?.roomId || "").trim() || undefined,
      createdAt: Date.now(),
    };

    if (scope === "immediate") {
      if (this.pendingImmediate.length >= 100) return false;
      this.pendingImmediate.push(entry);
      return true;
    }

    const roomId = String(entry.roomId || "").trim();
    if (!roomId) return false;
    const pending = this.pendingRoomMessages.get(roomId) || [];
    pending.push(entry);
    this.pendingRoomMessages.set(roomId, pending.slice(-80));
    return true;
  }

  private clearPendingRoomMessages(roomId?: string | null) {
    const rid = String(roomId || "").trim();
    if (rid) {
      this.pendingRoomMessages.delete(rid);
      return;
    }
    this.pendingRoomMessages.clear();
  }

  private flushPendingImmediateAfterReconnect() {
    if (this.pendingImmediate.length <= 0) return;
    const pending = this.pendingImmediate.slice();
    this.pendingImmediate = [];
    pending.forEach((entry) => this.sendRaw(entry.payload));
  }

  private flushPendingRoomMessages(roomId?: string | null) {
    const rid = String(roomId || "").trim();
    if (!rid) return;
    const pending = this.pendingRoomMessages.get(rid) || [];
    if (pending.length <= 0) return;
    this.pendingRoomMessages.delete(rid);
    pending.forEach((entry) => this.sendRaw(entry.payload));
  }

  private nextRpcId(prefix: string) {
    this.rpcSeq += 1;
    return `${prefix}_${Date.now()}_${this.rpcSeq}`;
  }

  private resolveCallContactRpc(requestId: string, result: CallContactRpcResult) {
    const key = String(requestId || "").trim();
    if (!key) return false;
    const pending = this.pendingCallContactRpc.get(key);
    if (!pending) return false;
    if (pending.timer) clearTimeout(pending.timer);
    this.pendingCallContactRpc.delete(key);
    pending.resolve(result);
    return true;
  }

  private failCallContactRpc(requestId: string, kind: CallContactRpcKind, errorCode: string, errorMessage?: string) {
    this.resolveCallContactRpc(requestId, {
      ok: false,
      errorCode,
      errorMessage: errorMessage || errorCode,
      kind,
    });
  }

  private failAllCallContactRpc(errorCode: string, errorMessage?: string) {
    const pending = Array.from(this.pendingCallContactRpc.entries());
    pending.forEach(([requestId, entry]) => {
      this.failCallContactRpc(requestId, entry.kind, errorCode, errorMessage);
    });
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private stopRegisterAck() {
    if (this.registerAckTimer) clearTimeout(this.registerAckTimer);
    this.registerAckTimer = null;
  }

  private stopEnqueueAck() {
    if (this.enqueueAckTimer) clearTimeout(this.enqueueAckTimer);
    this.enqueueAckTimer = null;
  }

  private armRegisterAck(socketId: number) {
    this.stopRegisterAck();
    this.registerAckTimer = setTimeout(() => {
      this.registerAckTimer = null;
      if (this.currentSocketId !== socketId) return;
      if (this.registered) return;
      this.cb.onMessage({ type: "error", message: "REGISTER_TIMEOUT" });
      try {
        this.ws?.close();
      } catch {}
    }, 7000);
  }

  private armEnqueueAck(socketId: number) {
    this.stopEnqueueAck();
    this.enqueueAckTimer = setTimeout(() => {
      this.enqueueAckTimer = null;
      if (this.currentSocketId !== socketId) return;
      if (!this.registered) return;
      if (!this.wantEnqueue || this.activeRoomId) return;
      this.cb.onMessage({ type: "error", message: "ENQUEUE_TIMEOUT" });
      try {
        this.ws?.close();
      } catch {}
    }, 8000);
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.registered) return;
      if (!this.ws || (this.ws as any).readyState !== 1) return;
      this.sendRaw({ type: "ping", at: Date.now() });
    }, 10000);
  }

  private shouldAttemptReconnect() {
    return !this.manualClose && !this.ended && !!this.baseUrl && !!this.token && !!this.sessionId;
  }

  private scheduleReconnect() {
    if (!this.shouldAttemptReconnect()) return;
    if (this.reconnectTimer) return;

    this.reconnectAttempt += 1;
    const delayMs = Math.min(4500, 550 + Math.max(0, this.reconnectAttempt - 1) * 850);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.shouldAttemptReconnect()) return;
      this.openSocket();
    }, delayMs);
  }

  async connect(baseUrl: string, token: string | null, userId?: string | null) {
    // ✅ 기존 reconnect 예약이 있으면 취소
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopKeepAlive();
    this.stopRegisterAck();
    this.stopEnqueueAck();

    // ✅ 기존 ws 정리(중복 이벤트로 상태 꼬임 방지)
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    this.baseUrl = String(baseUrl || "").trim();
    this.manualClose = false;
    this.failAllCallContactRpc("SIGNAL_RESET");

    const deviceKey = await getOrCreateDeviceKey();
    this.sessionId = String(deviceKey || "").trim();
    this.token = String(token || "").trim();
    this.userId = String(userId || "").trim();

    this.registered = false;
    this.openNotified = false;
    this.closeNotified = false;
    this.pendingImmediate = [];
    this.pendingRoomMessages.clear();
    this.activeRoomId = "";

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
      this.stopKeepAlive();
      this.stopRegisterAck();
      this.stopEnqueueAck();
      this.failAllCallContactRpc("SIGNAL_UNAVAILABLE");

      // ✅ 연결 끊기면 등록 상태만 초기화(통화/매칭 종료는 CallScreen에서 판단)
      this.registered = false;

      // ✅ ws 참조 제거
      try {
        this.ws?.close();
      } catch {}
      this.ws = null;

      this.scheduleReconnect();

      // CallScreen 재큐잉/복구 루프가 onClose를 기준으로 동작하므로
      // 비정상 종료에서도 반드시 콜백을 전달해야 매칭이 멈추지 않는다.
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
      this.sendRaw({
        type: "register",
        token: this.token,
        sessionId: this.sessionId,
        userId: this.userId || undefined,
      });
      this.armRegisterAck(socketId);
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
          this.stopRegisterAck();
          const wasReconnect = this.reconnectAttempt > 0;
          this.registered = true;
          this.reconnectAttempt = 0;
          this.startKeepAlive();

          if (!this.openNotified) {
            this.openNotified = true;
            this.cb.onOpen();
          } else if (wasReconnect) {
            this.cb.onReconnect?.();
          }

          this.flushPendingImmediateAfterReconnect();

          // 2) 큐 유지가 필요한 경우(대기 중 끊김) 자동 enqueue
          if (this.wantEnqueue && this.lastEnqueuePayload && !this.activeRoomId) {
            this.sendRaw({ type: "enqueue", ...this.lastEnqueuePayload });
            this.armEnqueueAck(socketId);
          }

          return;
        }

        if (msg?.type === "enqueued") {
          this.stopEnqueueAck();
          this.cb.onMessage({ type: "queued" });
          return;
        }

        if (msg?.type === "matched") {
          this.stopEnqueueAck();
          // ✅ 매칭되면 더 이상 큐 유지/자동 enqueue 하지 않음
          this.wantEnqueue = false;
          this.lastEnqueuePayload = null;
          this.activeRoomId = String(msg.roomId || "").trim();

          this.cb.onMessage({
            type: "match",
            roomId: msg.roomId,
            isCaller: !!msg.initiator,
            peerSessionId: String(msg.peerSessionId || "").trim() || undefined,
          });
          this.flushPendingRoomMessages(this.activeRoomId);
          return;
        }

        if (msg?.type === "call_contact_result") {
          const requestId = String(msg.requestId || "").trim();
          const kind = (String(msg.kind || "").trim().toLowerCase() === "favorite" ? "favorite" : "friend") as CallContactRpcKind;
          if (!requestId) return;
          this.resolveCallContactRpc(requestId, {
            ok: msg.ok !== false,
            errorCode: String(msg.errorCode || "").trim(),
            errorMessage: String(msg.errorMessage || msg.errorCode || "").trim(),
            kind,
            contact: msg.contact,
          });
          return;
        }

        // ✅ 떠난 사람에게 오는 ack는 무시(상대 종료로 오해하지 않기)
        if (msg?.type === "left_ok") {
          return;
        }

        // ✅ 서버 최상위 end 처리
        if (msg?.type === "end") {
          this.stopEnqueueAck();
          this.cb.onMessage({
            type: "end",
            roomId: String(msg.roomId || "").trim() || undefined,
            reason: String(msg.reason || "").trim() || undefined,
          });
          return;
        }

        if (msg?.type === "peer_left" || msg?.type === "left") {
          this.stopEnqueueAck();
          this.cb.onMessage({
            type: "end",
            roomId: String(msg.roomId || "").trim() || undefined,
          });
          return;
        }

        if (msg?.type === "signal") {
          const d: any = msg.data;
          const t = String(d?.type ?? d?.kind ?? "").toLowerCase();

          if (t === "offer") {
            this.cb.onMessage({ type: "offer", roomId: msg.roomId, sdp: d });
            return;
          }
          if (t === "answer") {
            this.cb.onMessage({ type: "answer", roomId: msg.roomId, sdp: d });
            return;
          }
          if (t === "ice") {
            const cand = d?.candidate ?? d;
            this.cb.onMessage({ type: "ice", roomId: msg.roomId, candidate: cand });
            return;
          }
          if (t === "end" || t === "leave") {
            this.cb.onMessage({
              type: "end",
              roomId: msg.roomId,
              reason: String(d?.reason || "").trim() || undefined,
            });
            return;
          }

          // ✅ 상대 카메라 ON/OFF 상태(선택적으로 사용 가능)
          if (t === "cam_state") {
            const enabled = Boolean(d?.enabled ?? d?.on ?? d?.camOn ?? d?.videoEnabled ?? d?.videoOn);
            this.cb.onMessage({ type: "peer_cam", roomId: msg.roomId, enabled });
            return;
          }

          this.cb.onMessage({ type: "signal", roomId: msg.roomId, data: d, fromSessionId: msg.fromSessionId });
          return;
        }

        if (msg?.type === "error") {
          const reason = String(msg.message || msg.reason || "UNKNOWN_ERROR").trim().toUpperCase();
          if (["REGISTER_TIMEOUT", "ENQUEUE_TIMEOUT", "NOT_REGISTERED", "INVALID_SESSION", "ALREADY_IN_ROOM", "ENQUEUE_FAILED"].includes(reason)) {
            this.stopEnqueueAck();
          }
          const m = String(msg.message || msg.reason || "UNKNOWN_ERROR");
          this.cb.onMessage({ type: "error", message: m });
          return;
        }
      } catch {
        this.cb.onMessage({ type: "error", message: "INVALID_MESSAGE" });
      }
    };
  }

  enqueue(country: string, gender: string, language = "", filter?: MatchFilter) {
    // ✅ 재연결 후 자동으로 다시 enqueue되게 유지
    this.wantEnqueue = true;
    this.lastEnqueuePayload = {
      country: String(country || "").trim().toUpperCase(),
      gender: String(gender || "").trim().toLowerCase(),
      language: String(language || "").trim().toLowerCase(),
      filter: filter || undefined,
      platform: Platform.OS,
    };

    // ✅ 서버가 country/gender를 무시해도 문제 없음(추가 필드 허용)
    // ✅ registered 전이면 등록 후 자동 enqueue로 처리(중복 enqueue 방지)
    if (!this.registered) return;

    this.sendRaw({ type: "enqueue", ...this.lastEnqueuePayload });
    this.armEnqueueAck(this.currentSocketId);
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

  sendMicState(roomId: string, enabled: boolean) {
    this.relay(roomId, { type: "mic_state", enabled: !!enabled });
  }

  relay(roomId: string, data: any) {
    this.send({ type: "signal", roomId, data });
  }

  leaveQueue() {
    // ✅ 재연결 후 자동 enqueue 하지 않도록 해제
    this.wantEnqueue = false;
    this.lastEnqueuePayload = null;
    this.stopEnqueueAck();

    this.send({ type: "dequeue" });
  }

  // CallScreen.tsx에서 인자로 호출하므로 optional 처리
  leaveRoom(roomId?: string) {
    // ✅ 룸을 떠나면 큐 유지 플래그도 해제
    this.wantEnqueue = false;
    this.lastEnqueuePayload = null;
    this.clearPendingRoomMessages(roomId || this.activeRoomId || undefined);
    this.activeRoomId = "";
    this.stopEnqueueAck();

    // 서버는 roomId 없이도 처리하지만, 있어도 무방
    this.send({ type: "leave", roomId: roomId || undefined });
  }

  sendCallFriend(input: {
    roomId: string;
    enabled: boolean;
    peerSessionId?: string;
    peerProfileId?: string;
    peerUserId?: string;
    peerCountry?: string;
    peerLanguage?: string;
    peerGender?: string;
    peerFlag?: string;
  }): Promise<CallContactRpcResult> {
    const roomId = String(input.roomId || "").trim();
    if (!roomId) {
      return Promise.resolve({
        ok: false,
        errorCode: "INVALID_INPUT",
        errorMessage: "INVALID_INPUT",
        kind: "friend",
        contact: undefined,
      });
    }
    if (!this.registered || !this.ws || (this.ws as any).readyState !== 1) {
      return Promise.resolve({
        ok: false,
        errorCode: "SIGNAL_UNAVAILABLE",
        errorMessage: "SIGNAL_UNAVAILABLE",
        kind: "friend",
        contact: undefined,
      });
    }

    const requestId = this.nextRpcId("friend");
    return new Promise<CallContactRpcResult>((resolve) => {
      const timer = setTimeout(() => {
        this.failCallContactRpc(requestId, "friend", "SIGNAL_TIMEOUT");
      }, 12000);

      this.pendingCallContactRpc.set(requestId, {
        kind: "friend",
        resolve,
        timer,
      });

      this.sendRaw({
        type: "call_friend",
        requestId,
        roomId,
        enabled: input.enabled === true,
        peerSessionId: String(input.peerSessionId || "").trim() || undefined,
        peerProfileId: String(input.peerProfileId || "").trim() || undefined,
        peerUserId: String(input.peerUserId || "").trim() || undefined,
        peerCountry: String(input.peerCountry || "").trim() || undefined,
        peerLanguage: String(input.peerLanguage || "").trim() || undefined,
        peerGender: String(input.peerGender || "").trim() || undefined,
        peerFlag: String(input.peerFlag || "").trim() || undefined,
      });
    });
  }

  close() {
    // ✅ 수동 종료: 재연결 금지
    this.manualClose = true;
    this.stopKeepAlive();
    this.stopRegisterAck();
    this.stopEnqueueAck();
    this.failAllCallContactRpc("SIGNAL_CLOSED");

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    try {
      this.ws?.close();
    } catch {}
    this.ws = null;

    this.registered = false;
    this.openNotified = false;
    this.closeNotified = false;
    this.pendingImmediate = [];
    this.pendingRoomMessages.clear();
    this.activeRoomId = "";

    this.wantEnqueue = false;
    this.lastEnqueuePayload = null;

    this.reconnectAttempt = 0;
  }

  private send(obj: any) {
    // ✅ registered 전이면 큐잉(등록 확인 전 enqueue로 not_registered 나는 것 방지)
    if (!this.registered && obj?.type !== "register") {
      this.queueForReconnect(obj);
      return;
    }

    // ✅ ws가 잠깐 끊긴 상태면(재연결 중) pending으로 보관
    if (!this.ws || (this.ws as any).readyState !== 1) {
      if (obj?.type !== "register") this.queueForReconnect(obj);
      return;
    }

    this.sendRaw(obj);
  }

  private sendRaw(obj: any) {
    try {
      this.ws?.send(JSON.stringify(obj));
    } catch {
      // ✅ 전송 실패(끊김)면 pending으로 보관(재연결 후 flush)
      if (obj?.type !== "register") this.queueForReconnect(obj);
      try {
        this.scheduleReconnect();
      } catch {}
    }
  }
}
