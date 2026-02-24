package expo.modules.ranchatcallaudio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.view.WindowManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val EVENT_AUDIO_DEVICE_CHANGED = "onAudioDeviceChanged"

class RanchatCallAudioModule : Module() {
  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  private var focusRequest: AudioFocusRequest? = null
  private var focusListener: AudioManager.OnAudioFocusChangeListener? = null
  private var deviceCallback: AudioDeviceCallback? = null

  override fun definition() = ModuleDefinition {
    Name("RanchatCallAudio")

    Events(EVENT_AUDIO_DEVICE_CHANGED)

    OnStartObserving {
      registerDeviceCallbackIfNeeded()
      emitAudioDevices()
    }

    OnStopObserving {
      unregisterDeviceCallback()
    }

    Function("start") { _: Map<String, Any?>? ->
      startCallAudio()
    }

    Function("stop") {
      stopCallAudio()
    }

    Function("setKeepScreenOn") { on: Boolean ->
      val act = appContext.currentActivity ?: return@Function
      act.runOnUiThread {
        if (on) act.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else act.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      }
    }

    Function("setBluetoothOn") { on: Boolean ->
      setBluetoothSco(on)
    }

    Function("setForceSpeakerphoneOn") { on: Boolean ->
      audioManager?.isSpeakerphoneOn = on
      if (on) setBluetoothSco(false)
    }

    Function("setSpeakerphoneOn") { on: Boolean ->
      audioManager?.isSpeakerphoneOn = on
      if (on) setBluetoothSco(false)
    }

    Function("chooseAudioRoute") { route: String ->
      when (route.uppercase()) {
        "BLUETOOTH" -> {
          audioManager?.isSpeakerphoneOn = false
          setBluetoothSco(true)
        }
        "WIRED_HEADSET" -> {
          audioManager?.isSpeakerphoneOn = false
          setBluetoothSco(false)
        }
        "SPEAKER_PHONE" -> {
          setBluetoothSco(false)
          audioManager?.isSpeakerphoneOn = true
        }
      }
    }
  }

  private fun startCallAudio() {
    val am = audioManager ?: return
    am.mode = AudioManager.MODE_IN_COMMUNICATION
    requestFocus()
    registerDeviceCallbackIfNeeded()
    emitAudioDevices()
  }

  private fun stopCallAudio() {
    val am = audioManager ?: return
    try { setBluetoothSco(false) } catch (_: Throwable) {}
    try { am.isSpeakerphoneOn = false } catch (_: Throwable) {}
    try { am.mode = AudioManager.MODE_NORMAL } catch (_: Throwable) {}
    abandonFocus()
    unregisterDeviceCallback()
    emitAudioDevices()
  }

  private fun requestFocus() {
    val am = audioManager ?: return
    if (focusListener != null) return

    val listener = AudioManager.OnAudioFocusChangeListener { }
    focusListener = listener

    if (Build.VERSION.SDK_INT >= 26) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(attrs)
        .setOnAudioFocusChangeListener(listener)
        .build()

      focusRequest = req
      am.requestAudioFocus(req)
    } else {
      @Suppress("DEPRECATION")
      am.requestAudioFocus(listener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
  }

  private fun abandonFocus() {
    val am = audioManager ?: return
    val listener = focusListener ?: return

    if (Build.VERSION.SDK_INT >= 26) {
      focusRequest?.let { am.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION")
      am.abandonAudioFocus(listener)
    }

    focusListener = null
  }

  private fun setBluetoothSco(on: Boolean) {
    val am = audioManager ?: return
    if (on) {
      if (!am.isBluetoothScoOn) {
        am.startBluetoothSco()
        am.isBluetoothScoOn = true
      }
    } else {
      if (am.isBluetoothScoOn) {
        am.isBluetoothScoOn = false
        am.stopBluetoothSco()
      }
    }
  }

  private fun registerDeviceCallbackIfNeeded() {
    if (deviceCallback != null) return
    if (Build.VERSION.SDK_INT < 23) return

    val cb = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
        emitAudioDevices()
      }
      override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
        emitAudioDevices()
      }
    }

    deviceCallback = cb
    audioManager?.registerAudioDeviceCallback(cb, null)
  }

  private fun unregisterDeviceCallback() {
    val cb = deviceCallback ?: return
    deviceCallback = null

    if (Build.VERSION.SDK_INT >= 23) {
      try { audioManager?.unregisterAudioDeviceCallback(cb) } catch (_: Throwable) {}
    }
  }

  private fun emitAudioDevices() {
    val list = getAvailableAudioDeviceList()
    sendEvent(EVENT_AUDIO_DEVICE_CHANGED, mapOf("availableAudioDeviceList" to list))
  }

  private fun getAvailableAudioDeviceList(): List<String> {
    val am = audioManager ?: return emptyList()
    val out = mutableListOf<String>()

    if (Build.VERSION.SDK_INT >= 23) {
      val devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      var hasBt = false
      var hasWired = false

      for (d in devices) {
        when (d.type) {
          AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
          AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> hasBt = true
          AudioDeviceInfo.TYPE_WIRED_HEADSET,
          AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
          AudioDeviceInfo.TYPE_USB_HEADSET -> hasWired = true
        }
      }

      if (hasBt) out.add("BLUETOOTH")
      if (hasWired) out.add("WIRED_HEADSET")
    }

    out.add("SPEAKER_PHONE")
    return out
  }
}