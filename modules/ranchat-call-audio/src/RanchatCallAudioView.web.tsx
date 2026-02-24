import * as React from 'react';

import { RanchatCallAudioViewProps } from './RanchatCallAudio.types';

export default function RanchatCallAudioView(props: RanchatCallAudioViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
