import * as THREE from 'three';
import * as xb from 'xrblocks';

import {CosmicImmersive} from './CosmicImmersive.js';
import {Portal} from './Portal.js';
import {CosmicScene} from './scenes/CosmicScene.js';
import {CyberpunkScene} from './scenes/CyberpunkScene.js';
import {ForestScene} from './scenes/ForestScene.js';
import {LavaScene} from './scenes/LavaScene.js';
import {UnderwaterScene} from './scenes/UnderwaterScene.js';

const SCENES = [
  UnderwaterScene,
  ForestScene,
  CosmicScene,
  LavaScene,
  CyberpunkScene,
];

const ARC_RADIUS = 2.2; // distance from user to each portal (meters)
const ARC_SPAN = Math.PI * 0.85; // total arc span (~150°)

const COSMIC_INDEX = 2; // CosmicScene is at index 2 in SCENES array.
const ENTRY_THRESHOLD = 0.9; // Portal radius * factor for plane-crossing check.

/**
 * A gallery of 5 portals arranged in a gentle arc in front of the user.
 * Each portal renders a fully different cinematic world.
 *
 * UX:
 *   1. Click a portal disc to "pick it up" (its ring spins faster + scales).
 *   2. Click anywhere on the depth mesh to drop it there, snapped to the
 *      surface normal.
 *   3. Click the held portal again (or click empty space twice) to cancel.
 *   4. Walk through the Cosmic portal to enter immersive space mode.
 */
export class PortalGalleryScene extends xb.Script {
  portals = [];
  labels = [];
  clock = new THREE.Clock();
  _held = null;
  _immersive = null;
  _insidePortal = false;
  _prevCamLocalZ = 1.0; // Positive = in front of portal.
  _exitReady = false; // True once user is clearly behind portal after entry.
  _exitRT = null; // Render target for exit portal view.
  _exitMat = null; // Material showing the room texture on the disc.
  _origDiscMat = null; // Original disc material to restore on exit.
  _exitCam = null; // Virtual camera for exit portal rendering.
  _fadeSphere = null; // Transition fade overlay.
  _fadeTarget = 0; // Target opacity (0 = transparent, 1 = opaque).
  _fadeCallback = null; // Called when fade reaches 1.0 (fully opaque).

  init() {
    const userY = xb.user?.height ?? 1.6;
    const n = SCENES.length;

    // Place each portal along an arc centered at (0, userY, 0).
    for (let i = 0; i < n; i++) {
      const scene = SCENES[i];
      const portal = new Portal({scene, label: scene.name});
      this.add(portal);

      const t = n === 1 ? 0.5 : i / (n - 1);
      const ang = -ARC_SPAN / 2 + ARC_SPAN * t;
      const x = Math.sin(ang) * ARC_RADIUS;
      const z = -Math.cos(ang) * ARC_RADIUS;
      portal.position.set(x, userY, z);
      portal.lookAt(0, userY, 0);
      portal._bobBaseY = userY;

      this.portals.push(portal);

      // Floating label above the portal.
      const label = new xb.SpatialPanel({
        width: 0.5,
        height: 0.14,
        backgroundColor: '#1e2533cc',
        draggable: false,
        useBorderlessShader: true,
      });
      const grid = label.addGrid();
      grid.addRow({weight: 0.15});
      grid.addRow({weight: 0.7}).addText({
        text: scene.name,
        fontColor: '#ffffff',
        fontSize: 0.09,
        textAlign: 'center',
      });
      grid.addRow({weight: 0.15});
      label.position.set(x, userY + Portal.RADIUS + 0.12, z);
      label.lookAt(0, userY, 0);
      this.add(label);
      this.labels.push(label);
    }

    this.add(new THREE.AmbientLight(0x223355, 0.6));
    xb.showReticleOnDepthMesh?.(true);

    // Exit label shown above cosmic portal in immersive mode.
    this._exitLabel = new xb.SpatialPanel({
      width: 0.45,
      height: 0.14,
      backgroundColor: '#44ff88cc',
      draggable: false,
      useBorderlessShader: true,
    });
    const exitGrid = this._exitLabel.addGrid();
    exitGrid.addRow({weight: 0.15});
    exitGrid.addRow({weight: 0.7}).addText({
      text: '↩ EXIT',
      fontColor: '#ffffff',
      fontSize: 0.09,
      textAlign: 'center',
    });
    exitGrid.addRow({weight: 0.15});
    this._exitLabel.visible = false;
    this.add(this._exitLabel);

    // Render target for exit portal view (shows the room the user came from).
    this._exitRT = new THREE.WebGLRenderTarget(512, 512);
    this._exitMat = new THREE.MeshBasicMaterial({
      map: this._exitRT.texture,
      side: THREE.DoubleSide,
    });
    this._exitCam = new THREE.PerspectiveCamera(110, 1, 0.1, 100);

    // Fade sphere for teleport transition.
    const fadeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      side: THREE.BackSide,
    });
    this._fadeSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 16), fadeMat
    );
    this._fadeSphere.renderOrder = 9999;
    this._fadeSphere.frustumCulled = false;
    this._fadeSphere.raycast = () => {}; // Don't intercept clicks.
    this.add(this._fadeSphere);

    // Immersive cosmic environment (hidden until walk-in).
    this._immersive = new CosmicImmersive();
    this.add(this._immersive);
  }

  onSelectStart(event) {
    // In immersive mode, clicks should not interact with portals.
    if (this._insidePortal) return;

    const controller = event.target;

    // If a portal is already held, this click places it on the depth mesh
    // (or, if you click the same portal again, drops it without moving).
    if (this._held) {
      // Cancel hold if you re-click any portal.
      for (const p of this.portals) {
        if (xb.user?.select?.(p._disc, controller)) {
          this._held.setHeld(false);
          this._held = null;
          return;
        }
      }
      const depthMesh = xb.core.depth?.depthMesh;
      const intersection =
        depthMesh && xb.user?.select?.(depthMesh, controller);
      if (intersection) {
        this._held.placeAt(
          intersection.point,
          intersection.face?.normal,
          intersection.object?.matrixWorld
        );
        this._held.setHeld(false);
        this._held = null;
      }
      return;
    }

    // Nothing held: clicking a portal picks it up.
    for (const p of this.portals) {
      if (xb.user?.select?.(p._disc, controller)) {
        this._held = p;
        p.setHeld(true);
        return;
      }
    }
    // Click on empty space / depth mesh with nothing held = no-op.
  }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const cam = xb.core.camera;

    // Animate fade transition and keep it centered on camera.
    if (cam && this._fadeSphere) {
      this._fadeSphere.position.copy(cam.position);
      const mat = this._fadeSphere.material;
      if (mat.opacity !== this._fadeTarget) {
        const speed = 26.0; // Fade speed (higher = faster).
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, this._fadeTarget, dt * speed);
        if (Math.abs(mat.opacity - this._fadeTarget) < 0.02) {
          mat.opacity = this._fadeTarget;
          if (this._fadeTarget === 1 && this._fadeCallback) {
            this._fadeCallback();
            this._fadeCallback = null;
            this._fadeTarget = 0; // Fade back out.
          }
        }
      }
    }

    // Immersive mode: update sky sphere and check for exit.
    if (this._insidePortal) {
      this._immersive.update(dt, cam);
      if (cam) {
        this._checkExit(cam);
        if (!this._insidePortal) return; // Exit just triggered, skip rest.
        // Billboard exit label toward camera.
        const portal = this.portals[COSMIC_INDEX];
        this._exitLabel.position.set(
          portal.position.x,
          portal.position.y + Portal.RADIUS + 0.18,
          portal.position.z
        );
        this._exitLabel.lookAt(cam.position);
        // Keep the cosmic portal's ring animating.
        portal.update(dt, cam);
        // Real-time render of the room into exit portal (parallax as user moves).
        this._captureExitSnapshot(cam);
      }
      return;
    }

    for (const p of this.portals) p.update(dt, cam);

    // Continuously update exit snapshot with current camera view.
    if (cam) this._captureExitSnapshot(cam);

    // Check if user walks through the cosmic portal.
    if (cam) {
      this._checkEntry(cam);
    }

    // Make labels face the camera (billboard) and follow their portal's bob.
    if (cam) {
      for (let i = 0; i < this.portals.length; i++) {
        const p = this.portals[i];
        const l = this.labels[i];
        l.position.y = p.position.y + Portal.RADIUS + 0.18;
        l.position.x = p.position.x;
        l.position.z = p.position.z;
        l.lookAt(cam.position);
      }
    }
  }

  _checkEntry(cam) {
    if (this._fadeTarget === 1) return; // Fade in progress.
    const portal = this.portals[COSMIC_INDEX];
    // Camera position in portal's local space.
    const camWorld = cam.getWorldPosition(new THREE.Vector3());
    const local = portal.worldToLocal(camWorld.clone());

    const radialDist = Math.hypot(local.x, local.y);
    const curZ = local.z;

    // Crossed from front (z>0) to behind (z<=0) while within disc radius.
    if (this._prevCamLocalZ > 0 && curZ <= 0 &&
        radialDist < Portal.RADIUS * ENTRY_THRESHOLD) {
      this._enterImmersive(portal);
    }

    this._prevCamLocalZ = curZ;
  }

  _checkExit(cam) {
    const portal = this.portals[COSMIC_INDEX];
    const camWorld = cam.getWorldPosition(new THREE.Vector3());
    const local = portal.worldToLocal(camWorld.clone());

    const radialDist = Math.hypot(local.x, local.y);
    const curZ = local.z;

    // After entry, wait until user is clearly behind portal before arming exit.
    if (!this._exitReady) {
      if (curZ < -0.05) this._exitReady = true;
      this._prevCamLocalZ = curZ;
      return;
    }

    // Crossed back from behind (z<0) to front (z>=0) within a generous radius.
    if (this._prevCamLocalZ < 0 && curZ >= 0 &&
        radialDist < Portal.RADIUS * 1.5) {
      this._exitImmersive();
    }

    this._prevCamLocalZ = curZ;
  }

  _enterImmersive(portal) {
    // Fade to white, then switch to immersive, then fade back.
    this._fadeTarget = 1;
    this._fadeCallback = () => {
      this._insidePortal = true;
      this._immersive.show(portal.matrixWorld);
      this._exitReady = false;
      this._prevCamLocalZ = -1;

      // Swap cosmic disc to show the room render target.
      this._origDiscMat = portal._disc.material;
      portal._disc.material = this._exitMat;
      portal._disc.visible = true;
      portal._disc.renderOrder = -1;

      // Hide other portals and all labels.
      for (let i = 0; i < this.portals.length; i++) {
        if (i !== COSMIC_INDEX) {
          this.portals[i].visible = false;
        }
        this.labels[i].visible = false;
      }
      this._exitLabel.visible = true;
    };
  }

  _exitImmersive() {
    // Fade to white, then switch back to gallery, then fade back.
    this._fadeTarget = 1;
    this._fadeCallback = () => {
      this._insidePortal = false;
      this._immersive.hide();
      this._exitLabel.visible = false;

      // Restore original disc material and render order.
      this.portals[COSMIC_INDEX]._disc.material = this._origDiscMat;
      this.portals[COSMIC_INDEX]._disc.renderOrder = 0;

      // Show gallery.
      for (const p of this.portals) p.visible = true;
      for (const l of this.labels) l.visible = true;
    };
  }

  /** Render the simulator room into the exit portal texture with dampened parallax. */
  _captureExitSnapshot(cam) {
    const renderer = xb.core.renderer;
    if (!renderer) return;

    const simScene = xb.core.simulator?.simulatorScene;
    if (!simScene) return;

    const portal = this.portals[COSMIC_INDEX];
    const portalPos = portal.getWorldPosition(new THREE.Vector3());
    const camPos = cam.getWorldPosition(new THREE.Vector3());

    // Place exit camera in front of portal (room side), offset slightly by user movement.
    // Portal local +Z points toward room center, so step forward from portal.
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(portal.quaternion);
    const roomCamBase = portalPos.clone().add(forward.clone().multiplyScalar(0.3));

    const PARALLAX_FACTOR = 0.15;
    this._exitCam.position.set(
      roomCamBase.x + (camPos.x - portalPos.x) * PARALLAX_FACTOR,
      roomCamBase.y + (camPos.y - portalPos.y) * PARALLAX_FACTOR,
      roomCamBase.z
    );
    // Look in the same direction (deeper into room).
    this._exitCam.lookAt(this._exitCam.position.clone().add(forward));

    const oldRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this._exitRT);
    renderer.clear();
    renderer.render(simScene, this._exitCam);
    renderer.setRenderTarget(oldRT);
  }
}
