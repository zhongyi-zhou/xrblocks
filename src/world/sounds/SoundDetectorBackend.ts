import {WorldOptions} from '../WorldOptions';
import {AudioClassifierResult} from './DetectedSounds';

export interface DetectorBackendContext {
  options: WorldOptions;
  sampleRate: number;
}

export interface NormalizedAudio {
  data: Float32Array;
}

export abstract class BaseDetectorBackend {
  protected context: DetectorBackendContext;

  constructor(context: DetectorBackendContext) {
    this.context = context;
  }

  abstract classify(audio: NormalizedAudio): AudioClassifierResult | null;

  normalizeAudio(arrayBuffer: ArrayBuffer): NormalizedAudio {
    const int16Data = new Int16Array(arrayBuffer);
    const normalizedAudio = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      normalizedAudio[i] = int16Data[i] / 32768.0;
    }
    return {data: normalizedAudio};
  }

  populateDebugData(audio: NormalizedAudio): {
    rms: number;
    bufferSize: number;
    sampleRate: number;
  } {
    let sumSquares = 0;
    const audioData = audio.data;
    for (let i = 0; i < audioData.length; i++) {
      sumSquares += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sumSquares / audioData.length);

    return {
      rms: rms,
      bufferSize: audioData.length,
      sampleRate: this.context.sampleRate,
    };
  }
}
