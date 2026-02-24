import { requireNativeView } from 'expo';
import * as React from 'react';

import { RanchatCallAudioViewProps } from './RanchatCallAudio.types';

const NativeView: React.ComponentType<RanchatCallAudioViewProps> =
  requireNativeView('RanchatCallAudio');

export default function RanchatCallAudioView(props: RanchatCallAudioViewProps) {
  return <NativeView {...props} />;
}
