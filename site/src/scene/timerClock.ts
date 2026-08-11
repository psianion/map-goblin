// R3F's Canvas always builds its own `new THREE.Clock()` internally (store.ts
// — there's no prop to swap it pre-mount) and THREE.Clock has been
// deprecated since three r183 in favor of THREE.Timer. Timer has a different
// (update-then-query) surface, so this adapts one behind the handful of
// members R3F's frame loop actually touches — getDelta(), elapsedTime,
// start()/stop() (see @react-three/fiber's update()/setFrameloop()) — and
// gets swapped into the store once via Canvas's onCreated in Canvas3D.tsx.
import * as THREE from 'three';

export function createTimerClock(): THREE.Clock {
  const timer = new THREE.Timer();
  const clock = {
    autoStart: true,
    startTime: 0,
    oldTime: 0,
    elapsedTime: 0,
    running: true,
    start() {
      timer.reset();
      this.running = true;
    },
    stop() {
      this.running = false;
    },
    getDelta() {
      timer.update();
      const delta = timer.getDelta();
      this.oldTime = this.elapsedTime;
      this.elapsedTime += delta;
      return delta;
    },
    getElapsedTime() {
      return this.elapsedTime;
    },
  };
  return clock as unknown as THREE.Clock;
}
