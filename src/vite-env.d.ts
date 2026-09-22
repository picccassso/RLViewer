/// <reference types="vite/client" />

declare module '*.wasm?url' {
  const content: string;
  export default content;
}
