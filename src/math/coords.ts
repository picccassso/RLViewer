import * as THREE from 'three';

/**
 * Coordinate and unit transformation between Rocket League (Unreal Engine) space
 * and Three.js world space.
 *
 * In Unreal Engine (Rocket League):
 *   - X = side / width (or forward depending on reference frame; in standard RL arena coords:
 *         X is width -4096..+4096, Y is length -5120..+5120, Z is height 0..2044)
 *   - Y = length along field (-5120 to +5120, toward Orange / Blue goals)
 *   - Z = height (0 at turf, 2044 at ceiling)
 *
 * In Three.js:
 *   - X = X (width -4096..+4096)
 *   - Y = Z (height 0..2044)
 *   - Z = Y (length -5120..+5120)
 *
 * Transformation matrix M:
 *   [ 1, 0, 0 ]
 *   [ 0, 0, 1 ]
 *   [ 0, 1, 0 ]
 *
 * For rotation quaternions:
 *   q_rl = (x, y, z, w)
 *   q_three = (x, z, y, -w)
 *
 * This preserves the mathematical equivalence:
 *   R(q_three) = M * R(q_rl) * M^T
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** The 3x3 transformation matrix M swapping Y and Z */
export const COORD_TRANSFORM_MATRIX = new THREE.Matrix3().set(
  1, 0, 0,
  0, 0, 1,
  0, 1, 0
);

/**
 * Transforms a vector from Unreal Engine coordinates to Three.js coordinates.
 */
export function rlToThreeVec3(v: Vec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, v.y);
}

/**
 * Transforms a vector from Three.js coordinates back to Unreal Engine coordinates.
 */
export function threeToRlVec3(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.z, z: v.y };
}

/**
 * Transforms a quaternion from Unreal Engine to Three.js.
 * Remaps (x, y, z, w) -> (x, z, y, -w) which is equivalent to (-x, -z, -y, w).
 */
export function rlToThreeQuat(q: Quat): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.z, q.y, -q.w).normalize();
}

/**
 * Helper to compute 3x3 rotation matrix from quaternion.
 */
export function quatToMatrix3(q: THREE.Quaternion): THREE.Matrix3 {
  const m4 = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const e = m4.elements;
  const m3 = new THREE.Matrix3();
  // Matrix4 elements are in column-major order:
  // e[0]=m00, e[1]=m10, e[2]=m20
  // e[4]=m01, e[5]=m11, e[6]=m21
  // e[8]=m02, e[9]=m12, e[10]=m22
  m3.set(
    e[0], e[4], e[8],
    e[1], e[5], e[9],
    e[2], e[6], e[10]
  );
  return m3;
}

/**
 * Computes M * R * M^T directly for a given 3x3 rotation matrix R.
 */
export function applyMatrixTransform(r: THREE.Matrix3): THREE.Matrix3 {
  // M = [ [1,0,0], [0,0,1], [0,1,0] ]
  // R = [ [r00, r01, r02],
  //       [r10, r11, r12],
  //       [r20, r21, r22] ]
  // M * R * M^T swaps rows 1 & 2, and columns 1 & 2:
  // (M*R*M^T)_00 = r00, (M*R*M^T)_01 = r02, (M*R*M^T)_02 = r01
  // (M*R*M^T)_10 = r20, (M*R*M^T)_11 = r22, (M*R*M^T)_12 = r21
  // (M*R*M^T)_20 = r10, (M*R*M^T)_21 = r12, (M*R*M^T)_22 = r11
  const e = r.elements; // column-major in three.js: [col0: 0,1,2, col1: 3,4,5, col2: 6,7,8]
  const r00 = e[0], r10 = e[1], r20 = e[2];
  const r01 = e[3], r11 = e[4], r21 = e[5];
  const r02 = e[6], r12 = e[7], r22 = e[8];

  const res = new THREE.Matrix3();
  res.set(
    r00, r02, r01,
    r20, r22, r21,
    r10, r12, r11
  );
  return res;
}
