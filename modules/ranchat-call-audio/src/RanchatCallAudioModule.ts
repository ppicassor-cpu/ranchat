import { NativeModule, requireNativeModule } from 'expo';

import type { RanchatCallAudioModuleEvents } from './RanchatCallAudio.types';

declare class RanchatCallAudioModule extends NativeModule<RanchatCallAudioModuleEvents> {
  start(options?: any): void;
  stop(): void;

  setKeepScreenOn(on: boolean): void;

  setBluetoothOn(on: boolean): void;

  setForceSpeakerphoneOn(on: boolean): void;
  setSpeakerphoneOn(on: boolean): void;

  chooseAudioRoute(route: string): void;
}

const mod = requireNativeModule<RanchatCallAudioModule>('RanchatCallAudio');
const anyMod: any = mod as any;

if (typeof anyMod.addEventListener !== 'function') {
  anyMod.addEventListener = (eventName: string, listener: any) => {
    const sub = anyMod.addListener?.(eventName, listener);
    if (sub && typeof sub.remove === 'function') return sub;
    return { remove: () => {} };
  };
}

export default mod;