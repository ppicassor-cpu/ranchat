export type AudioDeviceChangedEventPayload = {
  availableAudioDeviceList: any;
};

export type ChangeEventPayload = {
  value: string;
};

export type RanchatCallAudioViewProps = {
  url: string;
  onLoad: (event: { nativeEvent: { url: string } }) => void;
};

export type RanchatCallAudioModuleEvents = {
  onAudioDeviceChanged: (params: AudioDeviceChangedEventPayload) => void;
};
