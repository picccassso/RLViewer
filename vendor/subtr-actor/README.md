# @rlrml/subtr-actor (patched)

The published `@rlrml/subtr-actor@1.2.0` cannot parse replays from Rocket League's
Season 24 update (build 260918, v868.34.12). Its replay parser, boxcars 0.11.3, stops
on the new `TAGame.PRI_TA:PlayerStatus` attribute, and the camera settings attribute
also grew by 98 bits.

This is the same subtr-actor `v1.2.0` source with boxcars swapped for the unmerged fix
in [nickbabcock/boxcars#296](https://github.com/nickbabcock/boxcars/pull/296). The JS
glue and type definitions are identical to the npm release; only the `.wasm` differs.

**Remove this directory** and go back to the npm package once a subtr-actor release
ships a boxcars version with Season 24 support.

## Rebuilding

```sh
git clone https://github.com/rlrml/subtr-actor && cd subtr-actor && git checkout v1.2.0
cat >> Cargo.toml <<'TOML'

[patch.crates-io]
boxcars = { git = "https://github.com/1l1venbb/boxcars", rev = "b763a5f87c0d82f95001742f8d68cdf1146b67f6" }
TOML
cargo update -p boxcars
cargo build --release --target wasm32-unknown-unknown -p rl-replay-subtr-actor
cargo install wasm-bindgen-cli --version 0.2.108 --locked
wasm-bindgen --target web --out-dir pkg target/wasm32-unknown-unknown/release/rl_replay_subtr_actor.wasm
```

Copy `pkg/rl_replay_subtr_actor{.js,.d.ts,_bg.wasm}` here, and the `.wasm` to
`public/wasm/` as well (the parser worker's fallback).
