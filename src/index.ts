import express, { json } from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'
import StockfishEngine from './engine/ChessEngine'
import { Chess, Color } from 'chess.js'

const app = express()
const server = http.createServer(app)
const stockfishChess = new Chess()
const internetChess = new Chess()
const engine = new StockfishEngine()
let internet: number = 0
let stockfish: number = 0
let black: number = 0
let white: number = 0
const io = new Server(server, {
  cors: {
    origin: [process.env.CLIENT_URL || 'http://localhost:5173'],
  },
})

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

app.use(
  cors({
    origin: [process.env.CLIENT_URL || 'http://localhost:5173'],
  })
)

const DELAY_MS = 10000

engine.onInfo(async (line: string) => {
  if (line.startsWith('bestmove')) {
    const [_, best] = line.split(' ')
    stockfishChess.move(best)
    stockfishIo.emit('board-update', best)

    await stockfishOver()

    startVoting()
  }
})

let votes: { [key in string]: number } = {}
let internetVotes: { [key in string]: number } = {}

const stockfishUsers = new Map()
const internetUsers = new Map()
let eventTime: number | null = null
let delayUntilVotesEnd: number | null = null

function handleConnection(userId: string, map: Map<any, any>) {
  const count = map.get(userId) || 0
  map.set(userId, count + 1)
  return count === 0
}

function handleDisconnection(userId: string, map: Map<any, any>) {
  const count = map.get(userId) - 1
  if (count === 0) {
    map.delete(userId)
  } else {
    map.set(userId, count)
  }
  return count === 0
}

async function stockfishOver() {
  if (stockfishChess.isCheckmate()) {
    await delay(5000)
    const internetColor: Color = (internet + stockfish) % 2 === 0 ? 'w' : 'b'
    stockfishChess.turn() === internetColor ? stockfish++ : internet++
    stockfishChess.reset()

    stockfishIo.emit('board-reset', internetColor === 'w' ? 'b' : 'w')
    stockfishIo.emit('update-score', internet, stockfish)
    return true
  }

  if (
    stockfishChess.isStalemate() ||
    stockfishChess.isThreefoldRepetition() ||
    stockfishChess.isDraw()
  ) {
    await delay(5000)
    const internetColor: Color = (internet + stockfish) % 2 === 0 ? 'w' : 'b'
    internet += 0.5
    stockfish += 0.5
    stockfishChess.reset()
    stockfishIo.emit('board-reset', internetColor === 'w' ? 'b' : 'w')
    stockfishIo.emit('update-score', internet, stockfish)
    return true
  }

  return false
}

async function internetOver() {
  if (internetChess.isCheckmate()) {
    await delay(5000)
    internetChess.turn() === 'b' ? white++ : black++
    internetChess.reset()

    internetIo.emit('board-reset')
    internetIo.emit('update-score', white, black)
    return true
  }

  if (
    internetChess.isStalemate() ||
    internetChess.isThreefoldRepetition() ||
    internetChess.isDraw()
  ) {
    await delay(5000)
    black += 0.5
    white += 0.5
    internetChess.reset()
    internetIo.emit('board-reset')
    internetIo.emit('update-score', white, black)
    return true
  }

  return false
}

const stockfishIo = io.of('/stockfish')
const internetIo = io.of('/internet')

stockfishIo.on('connection', (socket) => {
  const id = socket.id
  const hasConnected = handleConnection(id, stockfishUsers)

  if (hasConnected) {
    stockfishIo.emit('update-users-count', stockfishUsers.size)
  }

  const internetColor: Color = (internet + stockfish) % 2 === 0 ? 'w' : 'b'

  socket.on('disconnect', () => {
    const hasDisconnected = handleDisconnection(id, stockfishUsers)

    if (hasDisconnected) {
      stockfishIo.emit('update-users-count', stockfishUsers.size)
    }
  })

  socket.emit(
    'sync-board',
    stockfishChess.fen(),
    internetColor === stockfishChess.turn(),
    internetColor === 'w' ? 'white' : 'black'
  )
  socket.emit('update-score', internet, stockfish)
  if (internetColor === stockfishChess.turn() && eventTime != null) {
    socket.emit('start-voting', Date.now(), eventTime)
  }

  socket.on('vote', (sourceSquare: string, targetSquare: string) => {
    const move = `${sourceSquare}-${targetSquare}`
    if (votes.hasOwnProperty(move)) {
      votes[move]++
    } else {
      votes[move] = 1
    }
    stockfishIo.emit('update-votes', votes)
  })
})

const INTERNET_DELAY_MS = 5000
let internetEventTime: null | number = null
let internetDelay: null | number = null

internetIo.on('connection', (socket) => {
  const id = socket.id
  const hasConnected = handleConnection(id, internetUsers)

  if (hasConnected) {
    internetIo.emit('update-users-count', internetUsers.size)
  }

  socket.on('disconnect', () => {
    const hasDisconnected = handleDisconnection(id, internetUsers)

    if (hasDisconnected) {
      internetIo.emit('update-users-count', internetUsers.size)
    }
  })

  socket.emit('sync-board', internetChess.fen())
  socket.emit('update-score', internet, stockfish)
  socket.emit('start-voting', Date.now(), internetEventTime)

  socket.on('vote', (sourceSquare: string, targetSquare: string) => {
    const move = `${sourceSquare}-${targetSquare}`
    if (internetVotes.hasOwnProperty(move)) {
      internetVotes[move]++
    } else {
      internetVotes[move] = 1
    }
    internetIo.emit('update-votes', internetVotes)
  })
})

const startVoting = async () => {
  const internetColor: Color = (internet + stockfish) % 2 === 0 ? 'w' : 'b'
  const halfMovesPlayed = stockfishChess.history().length

  if (halfMovesPlayed === 0 && internetColor === 'b') {
    engine.send('uci')
    engine.send(`position fen ${stockfishChess.fen()}`)
    engine.send('go depth 10')
    return
  }

  eventTime = Date.now() + DELAY_MS
  stockfishIo.emit('reset-votes')
  stockfishIo.emit('start-voting', Date.now(), eventTime)
  delayUntilVotesEnd = eventTime - Date.now()
  await delay(delayUntilVotesEnd)

  stockfishIo.emit('end-voting')
  let winner: string | null = null
  for (const key in votes) {
    if (!winner) {
      winner = key
      break
    }
    if (votes[winner] < votes[key]) {
      winner = key
    }
  }
  votes = {}

  if (!winner) {
    // try again
    eventTime = null
    delayUntilVotesEnd = null
    return startVoting()
    // return s'tartVoting()
  }

  const [from, to] = winner.split('-')
  stockfishChess.move({
    from,
    to,
    promotion: 'q',
  })
  stockfishIo.emit('board-update', winner.split('-').join(''))
  eventTime = null
  delayUntilVotesEnd = null

  await stockfishOver()

  stockfishIo.emit('computer-thinking')
  await delay(1000)

  engine.send('uci')
  engine.send(`position fen ${stockfishChess.fen()}`)
  engine.send('go depth 10')
}

const startInternet = async () => {
  internetEventTime = Date.now() + INTERNET_DELAY_MS
  internetIo.emit('reset-votes')
  internetIo.emit('start-voting', Date.now(), internetEventTime)

  internetDelay = internetEventTime - Date.now()
  await delay(internetDelay)

  internetIo.emit('end-voting')
  let winner: string | null = null
  for (const key in internetVotes) {
    if (!winner) {
      winner = key
      break
    }
    if (internetVotes[winner] < internetVotes[key]) {
      winner = key
    }
  }
  internetVotes = {}

  if (!winner) {
    // try again
    internetEventTime = null
    internetDelay = null
    return startInternet()
  }

  const [from, to] = winner.split('-')
  internetChess.move({
    from,
    to,
    promotion: 'q',
  })
  internetIo.emit('board-update', winner.split('-').join(''))
  internetEventTime = null
  internetDelay = null

  await internetOver()

  await delay(1000)
  startInternet()
}

app.use('/', (req, res) => {
  res.status(404).json({
    message: 'Please make a 404 page for this, mr developer, thank you',
  })
})

server.listen(3000, () => {
  console.log('listening to port 3000')
  startVoting()
  startInternet()
})
