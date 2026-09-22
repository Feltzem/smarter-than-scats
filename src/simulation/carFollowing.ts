/**
 * Intelligent Driver Model (IDM) car-following.
 *
 * a = a_max * [1 - (v/v0)^4 - (s*(v, Δv) / s)^2]
 *
 * Where s*(v, Δv) = s0 + v*T + v*Δv / (2*sqrt(a_max * b))
 */

// IDM parameters
const V0 = 50 / 3.6; // desired speed: 50 km/h → m/s
const A_MAX = 2.5; // max acceleration (m/s²)
const B_COMFORT = 4.5; // comfortable deceleration (m/s²)
const S0 = 2.0; // minimum gap (m)
const T_HEADWAY = 1.5; // desired time headway (s)
const CAR_LENGTH = 4.5; // vehicle length (m)

export const IDM_PARAMS = { V0, A_MAX, B_COMFORT, S0, T_HEADWAY, CAR_LENGTH };

export interface FollowingProfile {
  desiredSpeed: number;
  maxAcceleration: number;
  comfortDeceleration: number;
  standstillGap: number;
  timeHeadway: number;
}

const DEFAULT_PROFILE: FollowingProfile = {
  desiredSpeed: V0,
  maxAcceleration: A_MAX,
  comfortDeceleration: B_COMFORT,
  standstillGap: S0,
  timeHeadway: T_HEADWAY,
};

/**
 * Compute IDM acceleration.
 *
 * @param v - current speed (m/s)
 * @param s - gap to leader (m, bumper-to-bumper)
 * @param deltaV - speed difference (v - v_leader), positive means approaching
 * @returns acceleration (m/s²)
 */
export function idmAcceleration(
  v: number,
  s: number,
  deltaV: number,
  profile: FollowingProfile = DEFAULT_PROFILE,
): number {
  const desiredSpeed = Math.max(1, profile.desiredSpeed);
  const maxAcceleration = Math.max(0.2, profile.maxAcceleration);
  const comfortDeceleration = Math.max(0.5, profile.comfortDeceleration);
  const standstillGap = Math.max(0.5, profile.standstillGap);
  const timeHeadway = Math.max(0.4, profile.timeHeadway);

  // Desired gap
  const sStar =
    standstillGap +
    Math.max(
      0,
      v * timeHeadway +
        (v * deltaV) / (2 * Math.sqrt(maxAcceleration * comfortDeceleration)),
    );

  // Ensure minimum gap to avoid division by zero
  const sEffective = Math.max(s, 0.1);

  const accel =
    maxAcceleration *
    (1 - Math.pow(v / desiredSpeed, 4) - Math.pow(sStar / sEffective, 2));

  // Clamp to reasonable bounds
  return Math.max(-8, Math.min(maxAcceleration, accel));
}

/**
 * Free-flow acceleration (no leader).
 */
export function freeFlowAcceleration(
  v: number,
  profile: FollowingProfile = DEFAULT_PROFILE,
): number {
  const desiredSpeed = Math.max(1, profile.desiredSpeed);
  const maxAcceleration = Math.max(0.2, profile.maxAcceleration);
  return maxAcceleration * (1 - Math.pow(v / desiredSpeed, 4));
}

/**
 * Compute acceleration considering both a lead vehicle and a signal stop line.
 *
 * @param v - current speed (m/s)
 * @param distToLeader - distance to lead vehicle (m), Infinity if none
 * @param leaderSpeed - lead vehicle speed (m/s)
 * @param distToStopLine - distance to stop line (m)
 * @param signalIsGreen - whether the signal is green (or effectively permissive)
 */
export function computeAcceleration(
  v: number,
  distToLeader: number,
  leaderSpeed: number,
  distToStopLine: number,
  signalIsGreen: boolean,
  profile: FollowingProfile = DEFAULT_PROFILE,
  leaderLength: number = CAR_LENGTH,
): number {
  let accel: number;

  // Car-following acceleration (response to leader)
  if (distToLeader < Infinity) {
    const gap = distToLeader - Math.max(3, leaderLength);
    const deltaV = v - leaderSpeed;
    accel = idmAcceleration(v, gap, deltaV, profile);
  } else {
    accel = freeFlowAcceleration(v, profile);
  }

  // Signal response: treat red/yellow stop line as a stationary virtual leader
  if (!signalIsGreen && distToStopLine > 0 && distToStopLine < 150) {
    const signalAccel = idmAcceleration(v, distToStopLine, v, profile);
    accel = Math.min(accel, signalAccel);
  }

  return accel;
}

export { V0 as FREE_FLOW_SPEED };
