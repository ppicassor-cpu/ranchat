import { Dimensions, StyleSheet } from "react-native";
import { theme } from "../config/theme";

export const W = Dimensions.get("window").width;

const REMOTE_VIDEO_SCALE = 1.22;
const REMOTE_SHIFT_Y = 0;
export const REMOTE_VIDEO_Z_ORDER = 0;
export const LOCAL_VIDEO_Z_ORDER = 1;

const LOCAL_CROP_Y = 0;
const LOCAL_OVERLAY_RADIUS = 25;
const LOCAL_OUTER_SHADOW_HEIGHT = 60;

export const OVERLAY_LOCAL_HEIGHT_CALLING = "45%";


export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },

  stage: { flex: 1, position: "relative", backgroundColor: "#000" },

  overlayStage: { flex: 1 },

  localLayer: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 30,
  elevation: 30,
},

localAreaShadow: {
  position: "absolute",
  left: 0,
  right: 0,
  height: "50%",
  backgroundColor: "transparent",
  overflow: "hidden",
  zIndex: 3,
  borderTopLeftRadius: LOCAL_OVERLAY_RADIUS,
  borderTopRightRadius: LOCAL_OVERLAY_RADIUS,
},

localTopShadowGradient: {
  position: "absolute",
  left: 0,
  right: 0,
  height: LOCAL_OUTER_SHADOW_HEIGHT,
  overflow: "hidden",
  zIndex: 4,
  transform: [{ translateY: 0 }],
},

localArea: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "#000000",
  overflow: "hidden",
  borderTopLeftRadius: LOCAL_OVERLAY_RADIUS,
  borderTopRightRadius: LOCAL_OVERLAY_RADIUS,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderLeftWidth: StyleSheet.hairlineWidth,
  borderRightWidth: StyleSheet.hairlineWidth,
  borderColor: "rgba(255,255,255,0.16)",
},

localAreaCalling: {
  height: OVERLAY_LOCAL_HEIGHT_CALLING,
},

  remoteLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
  },

  remoteArea: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    borderRadius: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: "#000",
    overflow: "hidden",
  },

  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    transform: [{ scale: REMOTE_VIDEO_SCALE }, { translateY: REMOTE_SHIFT_Y }],
  },

  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  placeholderText: { fontSize: 14, color: "rgba(255,255,255,0.75)", fontWeight: "700" },

  backBtn: {
    position: "absolute",
    zIndex: 120,
    elevation: 120,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.16)",
  },
  shopBtn: {
    position: "absolute",
    zIndex: 145,
    elevation: 145,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.26)",
  },

  topUiLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 140,
    elevation: 140,
  },

  remoteInfoDock: {
    position: "absolute",
    top: 0,
    right: 12,
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 50,
    elevation: 50,
    gap: 3,
  },

  remoteInfoText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "700",
  },

  remoteInfoSubText: {
    color: "rgba(255, 170, 170, 0.92)",
    fontSize: 11,
    fontWeight: "700",
  },

  localViewport: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    overflow: "hidden",
  },

  localVideoMover: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ translateY: -LOCAL_CROP_Y }],
  },

  localVideoFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    transform: [{ scale: 1 }],
  },

  localEmptyFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },

  localCamOffBgFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },

  camOffOverlayFull: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },

  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  matchRevealBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  matchRevealHeartWrap: {
    position: "absolute",
    width: 164,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
  },
  matchRevealPiece: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: "#000",
  },
  matchRevealLobeLeft: {
    left: 22,
    top: 0,
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  matchRevealLobeRight: {
    left: 78,
    top: 0,
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  matchRevealBottomDiamond: {
    left: 36,
    top: 30,
    width: 92,
    height: 92,
    borderRadius: 16,
    transform: [{ rotate: "45deg" }],
  },
  matchRevealVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  matchRevealVideoDiamond: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ rotate: "-45deg" }, { scale: 1.42 }],
  },
  matchRevealHeartGlow: {
    position: "absolute",
    top: -16,
    textShadowColor: "rgba(255, 214, 236, 0.9)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  matchRevealHeartFill: {
    position: "absolute",
    top: 2,
    textShadowColor: "rgba(255, 240, 248, 0.75)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },

  centerTextDock: {
    position: "absolute",
    left: 18,
    right: 18,
    top: "50%",
    marginTop: 52,
    minHeight: 72,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  centerText: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 24,
  },

  reMatchTextWrap: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
  },

  reMatchTextTop: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 24,
  },

  reMatchTextBottom: {
    textAlign: "center",
    fontSize: 24,
    fontWeight: "800",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 28,
    marginTop: 4,
  },

  queueAdDock: {
    position: "absolute",
    zIndex: 11,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  swipeGuideDock: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: [{ translateY: -56 }],
    zIndex: 115,
    elevation: 115,
  },
  swipeGuideImage: {
    width: 112,
    height: 112,
    opacity: 0.94,
  },

  nativeAd256: {
    width: 360,
    height: 202,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  nativeAdInner: {
    flex: 1,
  },
  nativeAdMedia: {
    flex: 1,
  },
  nativeAdFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  nativeAdHeadline: {
    flex: 1,
    fontSize: 12,
    color: "rgba(255,255,255,0.92)",
    fontWeight: "800",
  },
  nativeAdTag: {
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    fontWeight: "900",
  },

  controlsOverlay: {
    position: "absolute",
    zIndex: 160,
    elevation: 160,
    left: 0,
    right: 0,
    alignItems: "center",
  },

  chatFeedUnderShadow: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 78,
    justifyContent: "flex-end",
    gap: 6,
    overflow: "visible",
    zIndex: 65,
    elevation: 65,
  },
  chatFeedRow: {
    width: "100%",
    flexDirection: "row",
  },
  chatFeedRowMine: {
    justifyContent: "flex-end",
  },
  chatFeedRowPeer: {
    justifyContent: "flex-start",
  },
  chatFeedBubble: {
    maxWidth: "84%",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
  },
  chatFeedBubbleMine: {
    backgroundColor: "rgba(188, 74, 128, 0.56)",
    borderTopRightRadius: 6,
  },
  chatFeedBubblePeer: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderTopLeftRadius: 6,
  },
  chatFeedText: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
  },
  chatFeedTextNewest: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  chatComposerDock: {
    width: "100%",
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  chatComposerDockHidden: {
    opacity: 0,
    transform: [{ translateY: 20 }],
  },
  chatComposerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 120,
    elevation: 120,
  },
  chatComposerOverlayHidden: {
    opacity: 0,
  },
  chatComposerModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.01)",
  },
  chatComposerBackdropHit: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  chatComposerModalWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  chatInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chatInput: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: "#fff",
    backgroundColor: "rgba(0, 0, 0, 0.52)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.24)",
  },
  chatSendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3f323770",
  },

  controlsRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 12,
  },

  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3f323770",
  },
  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },

  dropdownBtn: {
    width: "100%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownBtnText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownChevron: { fontSize: 12, color: theme.colors.sub, fontWeight: "900" },

  dropdownList: {
    width: "100%",
    marginTop: 8,
    gap: 8,
  },

  dropdownListWrap: {
    width: "100%",
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  dropdownScroll: {
    maxHeight: 210,
  },
  dropdownScrollContent: {
    gap: 8,
  },

  dropdownRow: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownRowActive: {
    backgroundColor: theme.colors.cardSoft,
  },
  dropdownText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownTextActive: { color: theme.colors.pinkDeep },
  dropdownCheck: { fontSize: 14, color: theme.colors.pinkDeep, fontWeight: "900" },

  countryRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  countryCode: { fontSize: 12, color: theme.colors.sub, fontWeight: "800" },
  countryCodeActive: { color: theme.colors.pinkDeep },
});
