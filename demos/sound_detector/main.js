import 'xrblocks/addons/simulator/SimulatorAddons.js';
import * as xb from 'xrblocks';
import {Text} from 'troika-three-text';
import * as THREE from 'three';
import {LongSelectHandler} from 'xrblocks/addons/ui/LongSelectHandler.js';
import {SoundDisplay} from './SoundDisplay.js';

const options = new xb.Options();
options.world.enabled = true;
options.hands.enabled = true;

// Enable sound detection if the method is compiled and available.
// Otherwise, this script assumes system knows how to setup sound detector or the user provides it manually.
options.world.enableSoundDetection?.();

// Fallback to direct field manipulation if needed
if (options.world.sounds) {
  options.world.sounds.enabled = true;
  options.world.sounds.backendConfig.activeBackend = 'mediapipe';
}

options.setAppTitle('Sound Detector Demo');
options.setAppDescription(
  'Detects and classifies sounds from mic input, displaying result in HUD.'
);
options.xrButton.showEnterSimulatorButton = true;

function start() {
  const display = new SoundDisplay();

  const longSelectHandler = new LongSelectHandler(() => {
    if (display.world.sounds) {
      display.hudText.text = 'Listening...';
      display.hudText.sync();
      display.world.sounds.startListening();
    }
  });

  xb.add(display);
  xb.add(longSelectHandler);
  xb.init(options);
}

document.addEventListener('DOMContentLoaded', function () {
  start();
});
