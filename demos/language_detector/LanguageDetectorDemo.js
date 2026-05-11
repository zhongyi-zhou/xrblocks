import * as xb from 'xrblocks';
import * as THREE from 'three';

import {
  LanguageDetectorClient,
  languageName,
} from './LanguageDetectorClient.js';
import {GeminiLiveSource} from './SpeechSources.js';

const PLACEHOLDER =
  'Pinch the mic and say something in any language.\nEach utterance is detected separately.';
const MAX_UTTERANCES = 6;

export class LanguageDetectorDemo extends xb.Script {
  static dependencies = {camera: THREE.Camera};

  init({camera}) {
    this.camera = camera;
    this.detector = new LanguageDetectorClient();
    this.detector
      .load()
      .catch((e) => console.error('Language detector failed to load:', e));

    this.source = null;
    this.listening = false;
    this.utterances = []; // [{code, name, prob, text}]
    this.interim = '';

    this._buildUi();
  }

  _buildUi() {
    const panel = new xb.SpatialPanel({
      backgroundColor: '#101218e6',
      width: 1.8,
      height: 1.3,
    });
    this.add(panel);

    const grid = panel.addGrid();

    // Title bar.
    const titleRow = grid.addRow({weight: 0.13});
    this.titleText = titleRow.addText({
      text: 'Live Language Detector',
      fontColor: '#ffffff',
      fontSize: 0.055,
    });

    // Status bar (red dot when listening, hint otherwise).
    const statusRow = grid.addRow({weight: 0.07});
    this.statusText = statusRow.addText({
      text: 'Idle',
      fontColor: '#94a3b8',
      fontSize: 0.032,
    });

    // Spacer so the scroller's overflow can't bleed into the status/title.
    grid.addRow({weight: 0.06});

    // Utterance list — pre-built slots so each utterance can have a small
    // label above and a larger sentence below.
    const listRow = grid.addRow({weight: 0.55});
    const listGrid = listRow.addPanel({showEdge: false}).addGrid();
    this.itemSlots = [];
    for (let i = 0; i < MAX_UTTERANCES; i++) {
      const slotRow = listGrid.addRow({weight: 1 / MAX_UTTERANCES});
      const slotGrid = slotRow.addPanel({showEdge: false}).addGrid();
      const labelRow = slotGrid.addRow({weight: 0.4});
      const labelText = labelRow.addText({
        text: '',
        fontColor: '#7f95b3',
        fontSize: 0.022,
        textAlign: 'left',
        anchorX: 'left',
      });
      labelText.x = -0.5;
      const bodyRow = slotGrid.addRow({weight: 0.6});
      const bodyText = bodyRow.addText({
        text: '',
        fontColor: '#ffffff',
        fontSize: 0.04,
        textAlign: 'left',
        anchorX: 'left',
      });
      bodyText.x = -0.5;
      this.itemSlots.push({slotRow, labelText, bodyText});
    }
    this.placeholderRow = listRow;

    // Spacer above controls.
    grid.addRow({weight: 0.06});

    // Controls row.
    const controlRow = grid.addRow({weight: 0.13});
    const controlGrid = controlRow.addPanel({showEdge: false}).addGrid();

    controlGrid.addCol({weight: 0.25});

    this.micButton = controlGrid.addCol({weight: 0.25}).addIconButton({
      text: 'mic',
      fontSize: 0.6,
      fontColor: '#ffffff',
    });
    this.micButton.onTriggered = () => this._toggleListening();

    controlGrid.addCol({weight: 0.05});

    this.clearButton = controlGrid.addCol({weight: 0.25}).addIconButton({
      text: 'delete',
      fontSize: 0.55,
      fontColor: '#ffffff',
    });
    this.clearButton.onTriggered = () => this._clear();

    controlGrid.addCol({weight: 0.2});

    panel.updateLayouts();
  }

  async _toggleListening() {
    if (this.listening) {
      await this._stop();
      this._setStatus('Stopped');
      this._setMicActive(false);
      return;
    }
    if (!GeminiLiveSource.isAvailable()) {
      this._setStatus('Gemini not enabled — add API key to keys.json');
      return;
    }
    const source = new GeminiLiveSource();
    source.onTranscript((text, isFinal) => this._onTranscript(text, isFinal));
    source.onError((err) => {
      console.error('Speech source error:', err);
      this._setStatus('Error: ' + (err?.message || err));
      this.listening = false;
      this.source = null;
      this._setMicActive(false);
    });
    try {
      await source.start();
      this.source = source;
      this.listening = true;
      this._setStatus('● Listening — speak any language');
      this._setMicActive(true);
    } catch (err) {
      console.error('Failed to start:', err);
      this._setStatus('Failed to start: ' + (err?.message || err));
    }
  }

  async _stop() {
    if (this.source) {
      await this.source.stop();
      this.source = null;
    }
    this.listening = false;
  }

  _clear() {
    this.utterances = [];
    this.interim = '';
    this.source?.reset?.();
    this._renderList();
  }

  _onTranscript(text, isFinal) {
    if (!text) return;
    if (isFinal) {
      const lang = this._detect(text);
      this.utterances.push({...lang, text});
      if (this.utterances.length > MAX_UTTERANCES) this.utterances.shift();
      this.interim = '';
      this.interimLang = null;
      if (this.interimTimer) clearTimeout(this.interimTimer);
    } else {
      this.interim = text;
      // Debounce interim detection so we're not running it on every char.
      if (this.interimTimer) clearTimeout(this.interimTimer);
      this.interimTimer = setTimeout(() => {
        this.interimLang = this._detect(text);
        this._renderList();
      }, 200);
    }
    this._renderList();
  }

  _detect(text) {
    if (!this.detector?.detector || text.length < 4) {
      return {code: '??', name: '…', prob: 0};
    }
    const langs = this.detector.detect(text);
    if (!langs.length) return {code: '??', name: 'Unknown', prob: 0};
    const top = langs[0];
    return {
      code: top.languageCode.toUpperCase(),
      name: languageName(top.languageCode),
      prob: top.probability,
    };
  }

  _renderList() {
    // Build the visible list: completed utterances + a live interim entry at
    // the bottom (if any). Cap so the live entry always has room.
    const items = this.utterances.slice();
    if (this.interim) {
      const live = this.interimLang;
      items.push({
        code: live?.code ?? '··',
        name: live?.name ?? 'detecting',
        prob: live?.prob ?? 0,
        text: this.interim,
        live: true,
      });
    }
    while (items.length > this.itemSlots.length) items.shift();

    for (let i = 0; i < this.itemSlots.length; i++) {
      const slot = this.itemSlots[i];
      const u = items[i];
      if (u) {
        const pct = u.prob ? `${Math.round(u.prob * 100)}%` : '…';
        slot.labelText.setText(
          `${u.code} · ${u.name.toUpperCase()} · ${pct}${u.live ? '  ●' : ''}`
        );
        slot.bodyText.setText(u.text);
        slot.slotRow.visible = true;
      } else if (i === 0 && !items.length) {
        slot.labelText.setText('');
        slot.bodyText.setText(PLACEHOLDER);
        slot.slotRow.visible = true;
      } else {
        slot.labelText.setText('');
        slot.bodyText.setText('');
        slot.slotRow.visible = false;
      }
    }
  }

  _setStatus(message) {
    this.statusText.setText(message);
  }

  _setMicActive(active) {
    this.micButton.setText?.(active ? 'stop' : 'mic');
  }
}
