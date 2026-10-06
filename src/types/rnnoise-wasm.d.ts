declare module '@jitsi/rnnoise-wasm/dist/rnnoise-sync.js' {
  /** Emscripten factory with the wasm inlined; instantiates synchronously. */
  const createRNNWasmModuleSync: () => unknown
  export default createRNNWasmModuleSync
}
