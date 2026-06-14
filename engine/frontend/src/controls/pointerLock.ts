// Pointer-lock + first-person camera control.
//
// Mouse delta → yaw + pitch on the camera.
// Click on canvas → request pointer lock.
// Esc → exit pointer lock (browser default).

import * as THREE from "three";

export interface PointerLockOpts {
  domElement: HTMLElement;
  camera: THREE.PerspectiveCamera;
  sensitivity?: number;
  onLock?: () => void;
  onUnlock?: () => void;
}

export class PointerLockController {
  private dom: HTMLElement;
  private camera: THREE.PerspectiveCamera;
  private sensitivity: number;
  private yaw = 0;
  private pitch = 0;
  private _locked = false;
  private onLock?: () => void;
  private onUnlock?: () => void;

  constructor(opts: PointerLockOpts) {
    this.dom = opts.domElement;
    this.camera = opts.camera;
    this.sensitivity = opts.sensitivity ?? 0.002;
    this.onLock = opts.onLock;
    this.onUnlock = opts.onUnlock;

    this.dom.addEventListener("click", this.handleClick);
    document.addEventListener("pointerlockchange", this.handleLockChange);
    document.addEventListener("mousemove", this.handleMouseMove);
  }

  get locked(): boolean { return this._locked; }

  private handleClick = (): void => {
    if (!this._locked) this.dom.requestPointerLock();
  };

  private handleLockChange = (): void => {
    this._locked = document.pointerLockElement === this.dom;
    if (this._locked) this.onLock?.();
    else this.onUnlock?.();
  };

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this._locked) return;
    this.yaw   -= e.movementX * this.sensitivity;
    this.pitch -= e.movementY * this.sensitivity;
    const limit = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    // Apply to camera using Euler YXZ so yaw and pitch don't roll the cam
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  };

  getYaw(): number { return this.yaw; }

  /** Set the view direction programmatically (e.g., initial facing). */
  setYaw(yaw: number, pitch: number = 0): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
  /** Forward vector on the ground plane (no pitch). */
  getForwardXZ(target: THREE.Vector3): THREE.Vector3 {
    target.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    return target;
  }
  /** Right vector on the ground plane. */
  getRightXZ(target: THREE.Vector3): THREE.Vector3 {
    target.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return target;
  }

  destroy(): void {
    this.dom.removeEventListener("click", this.handleClick);
    document.removeEventListener("pointerlockchange", this.handleLockChange);
    document.removeEventListener("mousemove", this.handleMouseMove);
    if (this._locked) document.exitPointerLock();
  }
}
