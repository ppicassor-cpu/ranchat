import { registerWebModule, NativeModule } from 'expo';

import { ChangeEventPayload } from './RanchatCallAudio.types';

type RanchatCallAudioModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
}

class RanchatCallAudioModule extends NativeModule<RanchatCallAudioModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
};

export default registerWebModule(RanchatCallAudioModule, 'RanchatCallAudioModule');
