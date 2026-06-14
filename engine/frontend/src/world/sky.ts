// Sky + lighting system — gradient dome, sun/moon, stars, day/night cycle.
//
// One SkySystem owns the scene's lights and fog and drives them from a
// single phase value t ∈ [0,1): 0 = midnight, 0.25 = sunrise, 0.5 = noon,
// 0.75 = sunset. The dome is a big back-side sphere with a two-stop
// vertical gradient shader; sun and moon are emissive sprites orbiting
// the player; stars fade in at night.

import * as THREE from "three";

interface PhaseColors {
  top: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  sunIntensity: number;
  hemiIntensity: number;
  fog: THREE.Color;
}

const C = (hex: number) => new THREE.Color(hex);

// Keyframes around the cycle. Linearly interpolated.
const KEYS: Array<{ t: number; k: PhaseColors }> = [
  { t: 0.00, k: { top: C(0x070b14), horizon: C(0x0d1420), sun: C(0x223344), sunIntensity: 0.05, hemiIntensity: 0.18, fog: C(0x0a0f18) } },  // midnight
  { t: 0.22, k: { top: C(0x1a2233), horizon: C(0x6e4a3a), sun: C(0xff9a56), sunIntensity: 0.35, hemiIntensity: 0.35, fog: C(0x3a3340) } },  // pre-dawn
  { t: 0.28, k: { top: C(0x4a7ab5), horizon: C(0xffb877), sun: C(0xffc890), sunIntensity: 0.85, hemiIntensity: 0.55, fog: C(0x9a8a7a) } },  // sunrise
  { t: 0.40, k: { top: C(0x5a9bd5), horizon: C(0xbfd9ea), sun: C(0xfff2dd), sunIntensity: 1.15, hemiIntensity: 0.75, fog: C(0xaec4d4) } },  // morning
  { t: 0.50, k: { top: C(0x4f94d8), horizon: C(0xcfe3ef), sun: C(0xffffff), sunIntensity: 1.25, hemiIntensity: 0.85, fog: C(0xbfd4e0) } },  // noon
  { t: 0.62, k: { top: C(0x5a8fc8), horizon: C(0xc8d8e2), sun: C(0xfff0d0), sunIntensity: 1.05, hemiIntensity: 0.72, fog: C(0xaabfcc) } },  // afternoon
  { t: 0.74, k: { top: C(0x35476e), horizon: C(0xff9d5c), sun: C(0xff8844), sunIntensity: 0.55, hemiIntensity: 0.45, fog: C(0x8a6a5c) } },  // sunset
  { t: 0.80, k: { top: C(0x141d33), horizon: C(0x5a3a4a), sun: C(0x884466), sunIntensity: 0.15, hemiIntensity: 0.28, fog: C(0x2a2334) } },  // dusk
  { t: 1.00, k: { top: C(0x070b14), horizon: C(0x0d1420), sun: C(0x223344), sunIntensity: 0.05, hemiIntensity: 0.18, fog: C(0x0a0f18) } },  // wrap
];

export const PHASE_PRESETS: Record<string, number> = {
  dawn: 0.27, morning: 0.38, noon: 0.5, afternoon: 0.62,
  sunset: 0.74, dusk: 0.79, night: 0.95, midnight: 0.0,
};

const DOME_VERT = `
varying vec3 vWorld;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DOME_FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
varying vec3 vWorld;
void main() {
  float h = normalize(vWorld - cameraPosition).y;
  float m = pow(max(h, 0.0), 0.55);
  gl_FragColor = vec4(mix(horizonColor, topColor, m), 1.0);
}`;

export class SkySystem {
  /** Day length in real seconds for a full cycle. */
  dayLengthSec = 600;
  /** Current phase ∈ [0,1). Starts mid-morning. */
  phase = 0.38;
  paused = false;

  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  private clouds!: THREE.Group;
  private dome: THREE.Mesh;
  private domeMat: THREE.ShaderMaterial;
  private sunSprite: THREE.Mesh;
  private moonSprite: THREE.Mesh;
  private stars: THREE.Points;
  private scene: THREE.Scene;
  private tmpA = new THREE.Color();
  private tmpB = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.domeMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x4f94d8) },
        horizonColor: { value: new THREE.Color(0xcfe3ef) },
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 12), this.domeMat);
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xddeeff, 0x445544, 0.8);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.1);
    this.sun.castShadow = true;
    // 1280px over a ±44m box: visually identical to 2048/±55 at 720p,
    // measurably cheaper per frame.
    this.sun.shadow.mapSize.set(1280, 1280);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -44; sc.right = 44; sc.top = 44; sc.bottom = -44;
    sc.near = 1; sc.far = 200;
    this.sun.shadow.bias = -0.0006;
    scene.add(this.sun);
    scene.add(this.sun.target);

    const sunGeo = new THREE.SphereGeometry(7, 16, 12);
    this.sunSprite = new THREE.Mesh(sunGeo, new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
    scene.add(this.sunSprite);
    const moonGeo = new THREE.SphereGeometry(4.4, 16, 12);
    this.moonSprite = new THREE.Mesh(moonGeo, new THREE.MeshBasicMaterial({ color: 0xc9d4e4, fog: false }));
    scene.add(this.moonSprite);

    // Clouds — a dozen flat-shaded puff clusters on a slow drift. Lambert
    // materials pick up the phase lighting, so they blush at dawn and
    // vanish into the dark on their own.
    this.clouds = new THREE.Group();
    {
      let cs = 4242;
      const crnd = () => { cs = (Math.imul(cs, 1664525) + 1013904223) >>> 0; return cs / 4294967296; };
      const mat = new THREE.MeshLambertMaterial({
        color: 0xf4f7fa, flatShading: true, transparent: true, opacity: 0.92,
      });
      for (let i = 0; i < 12; i++) {
        const cloud = new THREE.Group();
        const puffs = 2 + Math.floor(crnd() * 3);
        for (let p = 0; p < puffs; p++) {
          const r = 3.5 + crnd() * 5;
          const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
          puff.position.set((p - puffs / 2) * r * 1.1 + crnd() * 2,
                            crnd() * 2.2, crnd() * 4 - 2);
          puff.scale.y = 0.45 + crnd() * 0.15;
          cloud.add(puff);
        }
        cloud.position.set(crnd() * 360 - 180, 42 + crnd() * 22, crnd() * 360 - 180);
        this.clouds.add(cloud);
      }
      scene.add(this.clouds);
    }

    // Stars — deterministic spherical scatter
    const N = 700;
    const starPos = new Float32Array(N * 3);
    let s = 12345;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < N; i++) {
      const az = rnd() * Math.PI * 2;
      const el = Math.acos(1 - rnd());      // upper hemisphere bias
      const r = 360;
      starPos[i * 3]     = r * Math.sin(el) * Math.cos(az);
      starPos[i * 3 + 1] = Math.abs(r * Math.cos(el)) + 12;
      starPos[i * 3 + 2] = r * Math.sin(el) * Math.sin(az);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xeef2ff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, fog: false, depthWrite: false,
    });
    this.stars = new THREE.Points(starGeo, starMat);
    scene.add(this.stars);

    if (!scene.fog) scene.fog = new THREE.Fog(0xbfd4e0, 45, 190);
    this.apply();
  }

  setPhase(t: number): void {
    this.phase = ((t % 1) + 1) % 1;
    this.apply();
  }

  setPreset(name: string): boolean {
    const t = PHASE_PRESETS[name];
    if (t === undefined) return false;
    this.setPhase(t);
    return true;
  }

  /** Call each frame with dt seconds and the player position. */
  tick(dt: number, px: number, py: number, pz: number): void {
    if (!this.paused) {
      this.phase = (this.phase + dt / this.dayLengthSec) % 1;
    }
    this.apply();
    // Everything sky-sized follows the player so the dome never ends.
    this.dome.position.set(px, 0, pz);
    this.stars.position.set(px, 0, pz);

    // Clouds drift east; each wraps around a 360m box centered on the player.
    for (const c of this.clouds.children) {
      c.position.x += dt * 1.1;
      let rx = c.position.x - px, rz = c.position.z - pz;
      if (rx > 180) c.position.x -= 360;
      if (rx < -180) c.position.x += 360;
      if (rz > 180) c.position.z -= 360;
      if (rz < -180) c.position.z += 360;
    }

    const ang = (this.phase - 0.25) * Math.PI * 2; // sunrise at horizon east
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.28).normalize();
    this.sun.position.set(px + sunDir.x * 90, py + sunDir.y * 90, pz + sunDir.z * 90);
    this.sun.target.position.set(px, py, pz);
    this.sunSprite.position.set(px + sunDir.x * 330, py + sunDir.y * 330, pz + sunDir.z * 330);
    this.moonSprite.position.set(px - sunDir.x * 330, py - sunDir.y * 330, pz - sunDir.z * 330);
  }

  /** Night factor 0..1 (for gameplay flavor — lantern glow, dialogue). */
  nightFactor(): number {
    const k = this.lerped();
    return 1 - Math.min(1, k.sunIntensity / 0.85);
  }

  phaseName(): string {
    const t = this.phase;
    if (t < 0.20 || t >= 0.84) return "night";
    if (t < 0.30) return "dawn";
    if (t < 0.46) return "morning";
    if (t < 0.58) return "noon";
    if (t < 0.70) return "afternoon";
    if (t < 0.78) return "sunset";
    return "dusk";
  }

  private lerped(): PhaseColors {
    const t = this.phase;
    let a = KEYS[0], b = KEYS[KEYS.length - 1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const span = b.t - a.t || 1;
    const f = (t - a.t) / span;
    const mix = (x: THREE.Color, y: THREE.Color, out: THREE.Color) => out.copy(x).lerp(y, f);
    const out: PhaseColors = {
      top: mix(a.k.top, b.k.top, new THREE.Color()),
      horizon: mix(a.k.horizon, b.k.horizon, new THREE.Color()),
      sun: mix(a.k.sun, b.k.sun, new THREE.Color()),
      sunIntensity: a.k.sunIntensity + (b.k.sunIntensity - a.k.sunIntensity) * f,
      hemiIntensity: a.k.hemiIntensity + (b.k.hemiIntensity - a.k.hemiIntensity) * f,
      fog: mix(a.k.fog, b.k.fog, new THREE.Color()),
    };
    return out;
  }

  private apply(): void {
    const k = this.lerped();
    (this.domeMat.uniforms.topColor.value as THREE.Color).copy(k.top);
    (this.domeMat.uniforms.horizonColor.value as THREE.Color).copy(k.horizon);
    this.sun.color.copy(k.sun);
    this.sun.intensity = Math.max(0.02, k.sunIntensity);
    this.hemi.intensity = k.hemiIntensity;
    const fog = this.scene.fog as THREE.Fog;
    if (fog) fog.color.copy(k.fog);
    const night = this.nightFactor();
    (this.stars.material as THREE.PointsMaterial).opacity = night * 0.9;
    (this.sunSprite.material as THREE.MeshBasicMaterial).color.copy(k.sun);
    this.sunSprite.visible = k.sunIntensity > 0.12;
    this.moonSprite.visible = night > 0.45;
  }
}
