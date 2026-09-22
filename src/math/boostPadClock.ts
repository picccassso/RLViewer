export type BoostPadSize = 'Big' | 'Small';

export interface BoostPadDefinition {
  index: number;
  pad_id: string;
  size: BoostPadSize;
  position: { x: number; y: number; z: number };
}

export interface BoostPadPickupEvent {
  time: number;
  frame: number;
  pad_id: string;
  player?: any;
}

export const BOOST_PAD_RESPAWN_TIME: Record<BoostPadSize, number> = {
  Big: 10.0,
  Small: 4.0,
};

export class BoostPadClockManager {
  private pickupsByPad: Map<string, number[]> = new Map();
  private padSizes: Map<string, BoostPadSize> = new Map();

  constructor(pads: BoostPadDefinition[] = [], pickupEvents: BoostPadPickupEvent[] = []) {
    for (const pad of pads) {
      this.padSizes.set(pad.pad_id, pad.size);
      this.pickupsByPad.set(pad.pad_id, []);
    }

    for (const event of pickupEvents) {
      const times = this.pickupsByPad.get(event.pad_id);
      if (times) {
        times.push(event.time);
      }
    }

    // Ensure sorted timestamps
    for (const times of this.pickupsByPad.values()) {
      times.sort((a, b) => a - b);
    }
  }

  /**
   * Registers a pad definition.
   */
  public registerPad(padId: string, size: BoostPadSize) {
    this.padSizes.set(padId, size);
    if (!this.pickupsByPad.has(padId)) {
      this.pickupsByPad.set(padId, []);
    }
  }

  /**
   * Adds a pickup event timestamp.
   */
  public addPickup(padId: string, time: number) {
    const list = this.pickupsByPad.get(padId) ?? [];
    list.push(time);
    list.sort((a, b) => a - b);
    this.pickupsByPad.set(padId, list);
  }

  /**
   * Returns whether the pad is available at the given time,
   * along with remaining cooldown (0 if available) and progress (0 to 1).
   */
  public getPadStateAt(padId: string, currentTime: number): {
    isAvailable: boolean;
    remainingSeconds: number;
    progress: number; // 0 = just picked up, 1 = fully respawned
  } {
    const size = this.padSizes.get(padId) ?? 'Small';
    const respawnDuration = BOOST_PAD_RESPAWN_TIME[size];
    const pickups = this.pickupsByPad.get(padId) ?? [];

    if (pickups.length === 0) {
      return { isAvailable: true, remainingSeconds: 0, progress: 1 };
    }

    // Binary search or find most recent pickup at or before currentTime
    let lastPickupTime = -Infinity;
    for (let i = pickups.length - 1; i >= 0; i--) {
      if (pickups[i] <= currentTime) {
        lastPickupTime = pickups[i];
        break;
      }
    }

    if (lastPickupTime === -Infinity) {
      // Current time is before any pickup event
      return { isAvailable: true, remainingSeconds: 0, progress: 1 };
    }

    const elapsed = currentTime - lastPickupTime;
    if (elapsed >= respawnDuration) {
      return { isAvailable: true, remainingSeconds: 0, progress: 1 };
    }

    const remainingSeconds = Math.max(0, respawnDuration - elapsed);
    const progress = Math.min(Math.max(elapsed / respawnDuration, 0), 1);
    return {
      isAvailable: false,
      remainingSeconds,
      progress,
    };
  }
}
