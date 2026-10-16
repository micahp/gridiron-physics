// Units: the engine works in SI (metres, seconds, kilograms). Play scripts
// arrive in yards; convert at the boundary with YD.
export const YD = 0.9144;
export const FIELD_W_YD = 160 / 3; // 53.33 yd
export const FIELD_W = FIELD_W_YD * YD;
// NFL hash marks are 70'9" (23.58 yd) in from each sideline
export const HASH_LO = 23.583 * YD;
export const HASH_HI = (FIELD_W_YD - 23.583) * YD;
export const G = 9.81;
// Cleat-on-grass traction coefficient. Shoe/surface studies report peak
// translational friction ~0.9-1.3 for football cleats; 0.95 is conservative.
export const MU = 0.95;
export const DT = 1 / 120; // physics step (s)
export const REC_HZ = 30; // recording rate for playback
// Air density at Empower Field at Mile High (1,609 m): ~0.98 kg/m^3 vs
// 1.20 at sea level — kicks and deep balls really do carry further in Denver.
export const RHO_AIR = 0.98;
export const BALL_MASS = 0.415; // kg (14-15 oz regulation)
export const BALL_R = 0.085; // m, max radius of the prolate spheroid
export const GOAL_W = 18.5 * 0.3048; // 18'6" between uprights
export const CROSSBAR = 10 * 0.3048;

export const yd = (v) => v * YD;
export const toYd = (m) => m / YD;
