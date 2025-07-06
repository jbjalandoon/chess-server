import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import readline from 'readline'

export default class StockfishEngine {
  private proc: ChildProcessWithoutNullStreams
  private rl: readline.Interface

  constructor(path = 'stockfish') {
    this.proc = spawn(path)
    this.rl = readline.createInterface({ input: this.proc.stdout })
    this.proc.stderr.on('data', (d) => console.error('[SF ERR]', d.toString()))
    this.send('uci')
  }

  onInfo(cb: (info: string) => void) {
    const listener = (line: string) => {
      // when we get the bestmove, stop listening
      if (line.startsWith('bestmove')) {
        cb(line)
      }
    }
    this.rl.on('line', listener)
  }

  send(cmd: string) {
    this.proc.stdin.write(cmd + '\n')
  }

  quit() {
    this.send('quit')
    this.rl.close()
  }
}
