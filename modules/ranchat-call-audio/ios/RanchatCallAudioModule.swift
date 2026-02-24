import ExpoModulesCore
import AVFoundation
import UIKit

private let EVENT_AUDIO_DEVICE_CHANGED = "onAudioDeviceChanged"

public class RanchatCallAudioModule: Module {
  private var routeObserver: NSObjectProtocol?
  private var started: Bool = false

  private var savedCategory: AVAudioSession.Category?
  private var savedMode: AVAudioSession.Mode?
  private var savedOptions: AVAudioSession.CategoryOptions?

  public func definition() -> ModuleDefinition {
    Name("RanchatCallAudio")

    Events(EVENT_AUDIO_DEVICE_CHANGED)

    OnStartObserving {
      self.startRouteObservingIfNeeded()
      self.emitAudioDevices()
    }

    OnStopObserving {
      self.stopRouteObserving()
    }

    Function("start") { (_: [String: Any]?) in
      self.startCallAudio()
    }

    Function("stop") {
      self.stopCallAudio()
    }

    Function("setKeepScreenOn") { (on: Bool) in
      DispatchQueue.main.async {
        UIApplication.shared.isIdleTimerDisabled = on
      }
    }

    Function("setBluetoothOn") { (on: Bool) in
      self.setBluetoothAllowed(on)
      if on { self.preferBluetoothIfAvailable() }
    }

    Function("setForceSpeakerphoneOn") { (on: Bool) in
      self.setSpeaker(on)
      if on { self.setBluetoothAllowed(false) }
    }

    Function("setSpeakerphoneOn") { (on: Bool) in
      self.setSpeaker(on)
      if on { self.setBluetoothAllowed(false) }
    }

    Function("chooseAudioRoute") { (route: String) in
      let r = route.uppercased()

      if r == "SPEAKER_PHONE" {
        self.setBluetoothAllowed(false)
        self.setSpeaker(true)
        return
      }

      if r == "BLUETOOTH" {
        self.setSpeaker(false)
        self.setBluetoothAllowed(true)
        self.preferBluetoothIfAvailable()
        return
      }

      if r == "WIRED_HEADSET" {
        self.setSpeaker(false)
        self.setBluetoothAllowed(false)
        self.preferWiredIfAvailable()
        return
      }
    }
  }

  private func session() -> AVAudioSession {
    AVAudioSession.sharedInstance()
  }

  private func startCallAudio() {
    if started { return }
    started = true

    let s = session()

    savedCategory = s.category
    savedMode = s.mode
    savedOptions = s.categoryOptions

    do {
      try s.setCategory(.playAndRecord, mode: .videoChat, options: [.allowBluetooth, .allowBluetoothA2DP])
      try s.setActive(true)
    } catch {}

    startRouteObservingIfNeeded()
    emitAudioDevices()
  }

  private func stopCallAudio() {
    if !started { return }
    started = false

    let s = session()

    do { try s.overrideOutputAudioPort(.none) } catch {}

    if let c = savedCategory, let m = savedMode, let o = savedOptions {
      do {
        try s.setCategory(c, mode: m, options: o)
      } catch {}
    } else {
      do {
        try s.setCategory(.ambient, mode: .default, options: [])
      } catch {}
    }

    do {
      try s.setActive(false, options: .notifyOthersOnDeactivation)
    } catch {}

    stopRouteObserving()
    emitAudioDevices()
  }

  private func setBluetoothAllowed(_ on: Bool) {
    let s = session()
    let opts: AVAudioSession.CategoryOptions = on ? [.allowBluetooth, .allowBluetoothA2DP] : []
    do {
      try s.setCategory(.playAndRecord, mode: .videoChat, options: opts)
      try s.setActive(true)
    } catch {}
  }

  private func setSpeaker(_ on: Bool) {
    let s = session()
    do {
      try s.overrideOutputAudioPort(on ? .speaker : .none)
    } catch {}
  }

  private func preferBluetoothIfAvailable() {
    let s = session()
    guard let inputs = s.availableInputs else { return }
    if let bt = inputs.first(where: { $0.portType == .bluetoothHFP || $0.portType == .bluetoothLE }) {
      do { try s.setPreferredInput(bt) } catch {}
    }
  }

  private func preferWiredIfAvailable() {
    let s = session()
    guard let inputs = s.availableInputs else { return }
    if let wired = inputs.first(where: { $0.portType == .headsetMic || $0.portType == .usbAudio }) {
      do { try s.setPreferredInput(wired) } catch {}
    } else {
      do { try s.setPreferredInput(nil) } catch {}
    }
  }

  private func startRouteObservingIfNeeded() {
    if routeObserver != nil { return }
    routeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.emitAudioDevices()
    }
  }

  private func stopRouteObserving() {
    if let obs = routeObserver {
      NotificationCenter.default.removeObserver(obs)
    }
    routeObserver = nil
  }

  private func emitAudioDevices() {
    let s = session()
    let route = s.currentRoute

    var hasBt = false
    var hasWired = false

    for p in route.inputs + route.outputs {
      switch p.portType {
      case .bluetoothHFP, .bluetoothA2DP, .bluetoothLE:
        hasBt = true
      case .headphones, .headsetMic, .usbAudio:
        hasWired = true
      default:
        break
      }
    }

    var list: [String] = []
    if hasBt { list.append("BLUETOOTH") }
    if hasWired { list.append("WIRED_HEADSET") }
    list.append("SPEAKER_PHONE")

    sendEvent(EVENT_AUDIO_DEVICE_CHANGED, [
      "availableAudioDeviceList": list
    ])
  }
}