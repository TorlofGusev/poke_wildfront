/** Battle playback speed (1×, 2× or 4×): how fast moves, hits and the foes' turns play out. Remembered per browser. */
export const BATTLE_SPEEDS = [1, 2, 4] as const;
export type BattleSpeed = (typeof BATTLE_SPEEDS)[number];

const SPEED_KEY = "wildfront:battleSpeed";

let speed: BattleSpeed = (() => {
  try {
    const v = Number(localStorage.getItem(SPEED_KEY));
    return (BATTLE_SPEEDS as readonly number[]).includes(v) ? (v as BattleSpeed) : 1;
  } catch {
    return 1;
  }
})();

export const getBattleSpeed = (): BattleSpeed => speed;

/** The next speed in the cycle 1× → 2× → 4× → 1×, remembered. */
export function cycleBattleSpeed(): BattleSpeed {
  speed = BATTLE_SPEEDS[(BATTLE_SPEEDS.indexOf(speed) + 1) % BATTLE_SPEEDS.length]!;
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Storage blocked: the speed still applies for this session.
  }
  return speed;
}
