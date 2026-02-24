export type AudioDeviceChangedEventPayload = {
  availableAudioDeviceList: any;
};

export type RanchatCallAudioModuleEvents = {
  onAudioDeviceChanged: (params: AudioDeviceChangedEventPayload) => void;
};