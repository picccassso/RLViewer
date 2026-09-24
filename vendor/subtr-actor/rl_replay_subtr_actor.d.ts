/* tslint:disable */
/* eslint-disable */

/**
 * Get column headers for the NDArray (useful for understanding the data structure)
 */
export function get_column_headers(global_feature_adders?: string[] | null, player_feature_adders?: string[] | null): any;

export function get_legacy_stats_timeline_json(data: Uint8Array): Uint8Array;

/**
 * Get NDArray data with metadata from replay data
 */
export function get_ndarray_with_info(data: Uint8Array, global_feature_adders?: string[] | null, player_feature_adders?: string[] | null, fps?: number | null): any;

export function get_replay_bundle_json_parts_with_progress(data: Uint8Array, callback: Function, report_every_n_frames?: number | null, max_frame_chunk_bytes?: number | null): any;

export function get_replay_bundle_json_with_progress(data: Uint8Array, callback: Function, report_every_n_frames?: number | null): any;

/**
 * Get structured frame data using ReplayDataCollector
 * This matches Python behavior - no FPS resampling, so goal frame numbers align
 */
export function get_replay_frames_data(data: Uint8Array): any;

export function get_replay_frames_data_json_with_progress(data: Uint8Array, callback: Function, report_every_n_frames?: number | null): Uint8Array;

export function get_replay_frames_data_with_progress(data: Uint8Array, callback: Function, report_every_n_frames?: number | null): any;

/**
 * Get basic replay information (version, etc.)
 */
export function get_replay_info(data: Uint8Array): any;

/**
 * Get only the replay metadata (without processing frames)
 */
export function get_replay_meta(data: Uint8Array, global_feature_adders?: string[] | null, player_feature_adders?: string[] | null): any;

/**
 * Get compact event-backed stats frames for each replay sample.
 */
export function get_stats_timeline(data: Uint8Array): any;

export function get_stats_timeline_json(data: Uint8Array): Uint8Array;

export function get_stats_timeline_json_parts(data: Uint8Array, max_frame_chunk_bytes?: number | null): any;

export function main(): void;

/**
 * Create a fresh lossless representation from a typed `TrainingPack`
 * (create-from-scratch; nothing unknown exists yet).
 */
export function new_training_pack(typed_pack: any): string;

/**
 * Parse a replay file and return the raw replay data as JavaScript object
 */
export function parse_replay(data: Uint8Array): any;

/**
 * Parse an encrypted `.tem` file into the typed `TrainingPack` view.
 */
export function parse_training_pack(data: Uint8Array): any;

/**
 * Parse an encrypted `.tem` file into the lossless JSON representation
 * (see the module docs). This is the value every editing entry point takes
 * and returns.
 */
export function parse_training_pack_lossless(data: Uint8Array): string;

/**
 * Serialize a lossless representation back into encrypted `.tem` bytes.
 */
export function serialize_training_pack(lossless: string): Uint8Array;

/**
 * Append a typed round to a lossless representation.
 */
export function training_pack_add_round(lossless: string, round: any): string;

/**
 * Append an archetype to the round at `round_index`.
 */
export function training_pack_add_round_archetype(lossless: string, round_index: number, archetype: any): string;

/**
 * Append every round of `other_lossless` to `lossless` (whole property
 * lists are copied, including unknown per-round properties).
 */
export function training_pack_append_rounds(lossless: string, other_lossless: string): string;

/**
 * Duplicate the round at `index`, inserting the copy right after it.
 */
export function training_pack_duplicate_round(lossless: string, index: number): string;

/**
 * Build the typed `TrainingPack` view of a lossless representation.
 */
export function training_pack_from_lossless(lossless: string): any;

/**
 * Insert a typed round at `index` (clamped to the round count).
 */
export function training_pack_insert_round(lossless: string, index: number, round: any): string;

/**
 * Move the round at `from` to position `to`.
 */
export function training_pack_move_round(lossless: string, from: number, to: number): string;

/**
 * Remove the round at `index`.
 */
export function training_pack_remove_round(lossless: string, index: number): string;

/**
 * Remove the archetype at `archetype_index` of round `round_index`.
 */
export function training_pack_remove_round_archetype(lossless: string, round_index: number, archetype_index: number): string;

/**
 * Parse the archetypes of the round at `round_index` into an array of
 * typed `Archetype` values (a `kind`-tagged union; unrecognized strings
 * come back as `kind: "Unknown"` carrying the raw string verbatim).
 */
export function training_pack_round_archetypes(lossless: string, round_index: number): any;

/**
 * Replace the archetype at `archetype_index` of round `round_index`.
 */
export function training_pack_set_round_archetype(lossless: string, round_index: number, archetype_index: number, archetype: any): string;

/**
 * Set the ball of the round at `round_index`: replaces the round's first
 * ball archetype, or inserts one at position 0 if the round has none.
 */
export function training_pack_set_round_ball(lossless: string, round_index: number, ball: any): string;

/**
 * Set the time limit of the round at `round_index` in place (0 removes the
 * property, matching the game's omit-default convention).
 */
export function training_pack_set_round_time_limit(lossless: string, round_index: number, time_limit: number): string;

/**
 * Apply the metadata fields of a typed `TrainingPack` onto a lossless
 * representation, preserving unknown properties.
 *
 * Applies: guid, code, name, training type, difficulty, creator name,
 * description, tags, map name (only when non-null; the underlying crate
 * cannot unset it), created/updated timestamps, player team number,
 * unowned, perfect-completed, and shots-completed.
 *
 * Does **not** apply `rounds` (use the round operations, which preserve
 * per-round unknown properties) or `creator_player_id` (read-only).
 */
export function update_training_pack_metadata(lossless: string, typed_pack: any): string;

/**
 * Validate that a replay file can be parsed
 */
export function validate_replay(data: Uint8Array): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly get_column_headers: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly get_legacy_stats_timeline_json: (a: number, b: number) => [number, number, number, number];
    readonly get_ndarray_with_info: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly get_replay_bundle_json_parts_with_progress: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly get_replay_bundle_json_with_progress: (a: number, b: number, c: any, d: number) => [number, number, number];
    readonly get_replay_frames_data: (a: number, b: number) => [number, number, number];
    readonly get_replay_frames_data_json_with_progress: (a: number, b: number, c: any, d: number) => [number, number, number, number];
    readonly get_replay_frames_data_with_progress: (a: number, b: number, c: any, d: number) => [number, number, number];
    readonly get_replay_info: (a: number, b: number) => [number, number, number];
    readonly get_replay_meta: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly get_stats_timeline: (a: number, b: number) => [number, number, number];
    readonly get_stats_timeline_json: (a: number, b: number) => [number, number, number, number];
    readonly get_stats_timeline_json_parts: (a: number, b: number, c: number) => [number, number, number];
    readonly main: () => void;
    readonly parse_replay: (a: number, b: number) => [number, number, number];
    readonly validate_replay: (a: number, b: number) => [number, number, number];
    readonly new_training_pack: (a: any) => [number, number, number, number];
    readonly parse_training_pack: (a: number, b: number) => [number, number, number];
    readonly parse_training_pack_lossless: (a: number, b: number) => [number, number, number, number];
    readonly serialize_training_pack: (a: number, b: number) => [number, number, number, number];
    readonly training_pack_add_round: (a: number, b: number, c: any) => [number, number, number, number];
    readonly training_pack_add_round_archetype: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly training_pack_append_rounds: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly training_pack_duplicate_round: (a: number, b: number, c: number) => [number, number, number, number];
    readonly training_pack_from_lossless: (a: number, b: number) => [number, number, number];
    readonly training_pack_insert_round: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly training_pack_move_round: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly training_pack_remove_round: (a: number, b: number, c: number) => [number, number, number, number];
    readonly training_pack_remove_round_archetype: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly training_pack_round_archetypes: (a: number, b: number, c: number) => [number, number, number];
    readonly training_pack_set_round_archetype: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly training_pack_set_round_ball: (a: number, b: number, c: number, d: any) => [number, number, number, number];
    readonly training_pack_set_round_time_limit: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly update_training_pack_metadata: (a: number, b: number, c: any) => [number, number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
