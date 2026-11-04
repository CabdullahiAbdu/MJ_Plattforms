/**
 * Native iOS & Mobile Haptics Engine (Taptic Engine Bridge)
 * ---------------------------------------------------------
 * Bridges Capacitor Haptics (`window.Capacitor.Plugins.Haptics`),
 * iOS WebKit messageHandlers, and standard Vibration API so every
 * tap, filter toggle, swipe-back, and long-press feels tactile.
 */

type HapticImpactStyle = 'LIGHT' | 'MEDIUM' | 'HEAVY';
type HapticNotificationType = 'SUCCESS' | 'WARNING' | 'ERROR';

function getCapacitorHapticsPlugin(): any {
  if (typeof window === 'undefined') return null;
  const cap = (window as any).Capacitor;
  return cap?.Plugins?.Haptics || null;
}

class HapticsEngine {
  public light(): void {
    this.impact('LIGHT', 6);
  }

  public medium(): void {
    this.impact('MEDIUM', 12);
  }

  public heavy(): void {
    this.impact('HEAVY', 20);
  }

  public selection(): void {
    try {
      const plugin = getCapacitorHapticsPlugin();
      if (plugin?.selectionStart) {
        plugin.selectionChanged?.().catch?.(() => {});
        return;
      }
      if (plugin?.impact) {
        plugin.impact({ style: 'LIGHT' }).catch?.(() => {});
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(4);
      }
    } catch {
      // Ignore if unsupported
    }
  }

  public success(): void {
    this.notification('SUCCESS', [10, 30, 12]);
  }

  public warning(): void {
    this.notification('WARNING', [14, 40, 14]);
  }

  private impact(style: HapticImpactStyle, fallbackMs: number): void {
    try {
      const plugin = getCapacitorHapticsPlugin();
      if (plugin?.impact) {
        plugin.impact({ style }).catch?.(() => {});
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(fallbackMs);
      }
    } catch {
      // Ignore if unsupported
    }
  }

  private notification(type: HapticNotificationType, pattern: number[]): void {
    try {
      const plugin = getCapacitorHapticsPlugin();
      if (plugin?.notification) {
        plugin.notification({ type }).catch?.(() => {});
        return;
      }
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore if unsupported
    }
  }
}

export const haptics = new HapticsEngine();
