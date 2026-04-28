import type * as MEDIAPIPE from '@mediapipe/tasks-audio';
import {
  DetectorBackendContext,
  BaseDetectorBackend,
  NormalizedAudio,
} from '../SoundDetectorBackend';
import {AudioClassifierResult} from '../DetectedSounds';

let FilesetResolver: typeof MEDIAPIPE.FilesetResolver | undefined;
let AudioClassifier: typeof MEDIAPIPE.AudioClassifier | undefined;

async function loadMediaPipeModule() {
  if (FilesetResolver && AudioClassifier) {
    return;
  }
  try {
    const mediapipeModule = await import('@mediapipe/tasks-audio');
    FilesetResolver = mediapipeModule.FilesetResolver;
    AudioClassifier = mediapipeModule.AudioClassifier;
    console.log("'@mediapipe/tasks-audio' module loaded successfully.");
  } catch (error) {
    console.error('Failed to load MediaPipe module:', error);
    throw error;
  }
}

export class MediaPipeDetectorBackend extends BaseDetectorBackend {
  private chunkSamples = 16000;
  private accumulatedAudio: number[] = [];
  private audioClassifier: MEDIAPIPE.AudioClassifier | null = null;
  private initializationPromise: Promise<void>;

  constructor(context: DetectorBackendContext) {
    super(context);
    const mediapipeConfig = this.context.options.sounds.backendConfig.mediapipe;
    this.chunkSamples = mediapipeConfig.chunkSamples;

    this.initializationPromise = this.tryInitializeAudioClassifier();
  }

  private async tryInitializeAudioClassifier(): Promise<void> {
    if (this.audioClassifier) return;

    await loadMediaPipeModule();

    const mediapipeConfig = this.context.options.sounds.backendConfig.mediapipe;
    const audioTasks = await FilesetResolver!.forAudioTasks(
      mediapipeConfig.wasmFilesUrl
    );
    this.audioClassifier = await AudioClassifier!.createFromOptions(
      audioTasks,
      {
        baseOptions: {modelAssetPath: mediapipeConfig.modelAssetPath},
      }
    );
  }

  override classify(audio: NormalizedAudio): AudioClassifierResult | null {
    if (!this.audioClassifier) return null;

    const audioData = audio.data;
    for (let i = 0; i < audioData.length; i++) {
      this.accumulatedAudio.push(audioData[i]);
    }

    if (this.accumulatedAudio.length >= this.chunkSamples) {
      const chunk = new Float32Array(
        this.accumulatedAudio.slice(0, this.chunkSamples)
      );
      this.accumulatedAudio = this.accumulatedAudio.slice(this.chunkSamples); // simple non-overlapping window

      console.log('Sample Rate: ', this.context.sampleRate);
      const mediaPipeResult = this.audioClassifier.classify(
        chunk,
        this.context.sampleRate
      );
      const debugData = this.populateDebugData({data: chunk});

      return {
        items: mediaPipeResult,
        debug: debugData,
      };
    }
    return null;
  }
}
