declare module 'stockfish' {
  function stockfish(): {
    postMessage(cmd: string): void
    onmessage: (event: { data: string }) => void
  }
  export = stockfish
}

declare module 'stockfish/src/stockfish-nnue-16-single.js' {
  export default function stockfish(): {
    postMessage(cmd: string): void
    onmessage: (e: { data: string }) => void
  }
}
