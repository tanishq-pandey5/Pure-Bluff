require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Global state
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['♠','♥','♦','♣'];
const AI_NAMES = ['BluffKing','QueenBluff','RaiseIt','PokerFace','AllinAlways','BlindBet','CardShark','SlickAce','WildCard','NightShift'];

let tables = [
  { id: 1, name: 'Bluff Masters', players: [], max: 6, decks: 1, minBet: 1000, gameActive: false, currentPlayerIdx: 0, currentBid: null, pile: [], cardsInLastBid: [], round: 0, log: [], timerSec: 15, timerInterval: null },
  { id: 2, name: 'Risk Takers',   players: [], max: 6, decks: 1, minBet: 500,  gameActive: false, currentPlayerIdx: 0, currentBid: null, pile: [], cardsInLastBid: [], round: 0, log: [], timerSec: 15, timerInterval: null },
  { id: 3, name: 'Ace Table',     players: [], max: 6, decks: 1, minBet: 2000, gameActive: false, currentPlayerIdx: 0, currentBid: null, pile: [], cardsInLastBid: [], round: 0, log: [], timerSec: 15, timerInterval: null },
  { id: 4, name: 'High Rollers',  players: [], max: 10,decks: 2, minBet: 5000, gameActive: false, currentPlayerIdx: 0, currentBid: null, pile: [], cardsInLastBid: [], round: 0, log: [], timerSec: 15, timerInterval: null },
  { id: 5, name: 'Fun Table',     players: [], max: 6, decks: 1, minBet: 200,  gameActive: false, currentPlayerIdx: 0, currentBid: null, pile: [], cardsInLastBid: [], round: 0, log: [], timerSec: 15, timerInterval: null },
];

// Map socket.id -> player info
const activePlayers = {};

// Helper: build a standard deck
function buildDeck(num = 1) {
  const d = [];
  for (let k = 0; k < num; k++) {
    for (const r of RANKS) {
      for (const s of SUITS) {
        d.push({ rank: r, suit: s, rankIdx: RANKS.indexOf(r) });
      }
    }
  }
  return d;
}

// Helper: shuffle array
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Helper: add log entry to table
function addTableLog(table, name, action, type = '') {
  const entry = { name, action, type };
  table.log.unshift(entry);
  if (table.log.length > 8) table.log.pop();
}

// Get clean list of tables for lobby
function getLobbyTables() {
  return tables.map(t => ({
    id: t.id,
    name: t.name,
    players: t.players.length,
    max: t.max,
    decks: t.decks,
    minBet: t.minBet
  }));
}

// Send localized game state to each player in the room (hiding hands of others)
function broadcastGameState(table) {
  table.players.forEach((p, idx) => {
    if (p.isAI) return;
    
    // Create copy of player list, hiding hands of other players
    const playersCopy = table.players.map((otherP, otherIdx) => ({
      id: otherP.id,
      name: otherP.name,
      coins: otherP.coins,
      folded: otherP.folded,
      isAI: otherP.isAI,
      seatIdx: otherP.seatIdx,
      isDealer: otherIdx === 0, // Mark index 0 as dealer
      handSize: otherP.hand.length
    }));
    
    const gameState = {
      gameActive: table.gameActive,
      players: playersCopy,
      currentPlayerIdx: table.currentPlayerIdx,
      currentBid: table.currentBid,
      round: table.round,
      pileSize: table.pile.length,
      maxPlayers: table.max,
      decks: table.decks,
      minBet: table.minBet,
      log: table.log
    };

    io.to(p.id).emit('game_state', gameState);
    io.to(p.id).emit('your_hand', p.hand);
  });
}

// Start game loop for a table
function startGame(table) {
  if (table.timerInterval) clearInterval(table.timerInterval);
  
  // Fill remaining empty seats with AI players
  const humanCount = table.players.filter(p => !p.isAI).length;
  const numAI = table.max - table.players.length;
  
  // Find currently used seat indices
  const usedSeats = table.players.map(p => p.seatIdx);
  let aiNameIdx = 0;
  for (let i = 0; i < numAI; i++) {
    // Find first vacant seat index
    let vacantSeat = 0;
    while (usedSeats.includes(vacantSeat)) vacantSeat++;
    usedSeats.push(vacantSeat);

    table.players.push({
      id: `ai_${Date.now()}_${vacantSeat}`,
      name: AI_NAMES[aiNameIdx % AI_NAMES.length],
      coins: 15000 + Math.floor(Math.random() * 20000),
      hand: [],
      folded: false,
      isAI: true,
      seatIdx: vacantSeat
    });
    aiNameIdx++;
  }

  // Shuffle and deal cards
  const deck = shuffle(buildDeck(table.decks));
  table.players.forEach(p => {
    p.hand = [];
    p.folded = false;
  });

  let ci = 0;
  while (ci < deck.length) {
    for (let p = 0; p < table.players.length; p++) {
      if (ci < deck.length) table.players[p].hand.push(deck[ci++]);
    }
  }

  table.pile = [];
  table.cardsInLastBid = [];
  table.currentBid = null;
  table.currentPlayerIdx = 0;
  table.round = 1;
  table.gameActive = true;
  table.log = [];

  addTableLog(table, 'System', 'Game Started! Good luck 🃏');
  
  // Notify everyone in the lobby that player counts updated
  io.emit('lobby_update', getLobbyTables());

  broadcastGameState(table);
  startTurn(table);
}

// Start player turn
function startTurn(table) {
  if (table.timerInterval) clearInterval(table.timerInterval);
  table.timerSec = 15;
  
  // Broadcast initial timer tick
  table.players.forEach(p => {
    if (!p.isAI) io.to(p.id).emit('timer', table.timerSec);
  });

  table.timerInterval = setInterval(() => {
    table.timerSec--;
    table.players.forEach(p => {
      if (!p.isAI) io.to(p.id).emit('timer', table.timerSec);
    });

    if (table.timerSec <= 0) {
      clearInterval(table.timerInterval);
      handleTimeout(table);
    }
  }, 1000);

  // Trigger AI turn after 2 seconds if active player is AI
  const activePlayer = table.players[table.currentPlayerIdx];
  if (activePlayer && activePlayer.isAI) {
    setTimeout(() => {
      // Ensure it is still the AI's turn (in case of quick action or reset)
      if (table.gameActive && table.players[table.currentPlayerIdx] === activePlayer) {
        clearInterval(table.timerInterval);
        aiTakeTurn(table, activePlayer);
      }
    }, 2000);
  }
}

// Handle turn timeout
function handleTimeout(table) {
  const activePlayer = table.players[table.currentPlayerIdx];
  if (!activePlayer) return;

  if (activePlayer.isAI) {
    aiTakeTurn(table, activePlayer);
  } else {
    // Human timed out: fold them (they collect the pile)
    io.to(activePlayer.id).emit('toast', 'Time out! Auto-folded.');
    executeFold(table, activePlayer);
  }
}

// AI logic implementation
function aiTakeTurn(table, ai) {
  if (ai.folded || ai.hand.length === 0) {
    nextPlayer(table);
    return;
  }

  const rand = Math.random();

  // 1. Decide: Challenge or Bid?
  if (table.currentBid) {
    let challengeProb = 0.15; // base probability
    const bidQty = table.currentBid.qty;
    const bidRankIdx = table.currentBid.rankIdx;
    
    // Count how many matching cards the AI actually has
    const aiCount = ai.hand.filter(c => c.rankIdx === bidRankIdx).length;
    const maxPossibleOutsideHand = (4 * table.decks) - aiCount;

    // AI logic: if bid quantity is impossible, challenge!
    if (bidQty > (4 * table.decks)) {
      challengeProb = 0.95;
    } else if (bidQty > aiCount + maxPossibleOutsideHand) {
      challengeProb = 1.0;
    } else if (bidQty > aiCount + (maxPossibleOutsideHand * 0.4)) {
      // If quantity is highly suspicious
      challengeProb = 0.6;
    } else if (ai.hand.length < 3) {
      // If AI is low on cards, play more aggressively (challenge more often)
      challengeProb += 0.15;
    }

    if (rand < challengeProb) {
      executeChallenge(table, ai);
      return;
    }
  }

  // 2. Decide: Bid parameters
  let newQty, newRankIdx;
  if (!table.currentBid) {
    // First bid of round: choose a card rank AI actually holds to be honest, or bluff slightly
    const distinctRanks = [...new Set(ai.hand.map(c => c.rankIdx))];
    if (distinctRanks.length > 0 && Math.random() < 0.8) {
      newRankIdx = distinctRanks[Math.floor(Math.random() * distinctRanks.length)];
      const actualCount = ai.hand.filter(c => c.rankIdx === newRankIdx).length;
      newQty = Math.max(1, Math.min(actualCount, Math.floor(Math.random() * 3) + 1));
    } else {
      // Complete random bluff
      newQty = Math.floor(Math.random() * 2) + 1;
      newRankIdx = Math.floor(Math.random() * RANKS.length);
    }
  } else {
    // Must bid higher rank OR same rank with higher quantity
    const prevRankIdx = table.currentBid.rankIdx;
    const prevQty = table.currentBid.qty;

    if (prevRankIdx === RANKS.length - 1) {
      // If rank is already Ace (highest), we can only raise quantity
      newRankIdx = prevRankIdx;
      newQty = prevQty + Math.floor(Math.random() * 2) + 1;
    } else {
      // Either raise rank or raise quantity
      if (Math.random() < 0.5) {
        // Raise quantity, keep same rank
        newRankIdx = prevRankIdx;
        newQty = prevQty + Math.floor(Math.random() * 2) + 1;
      } else {
        // Raise rank, keep quantity close or same
        newRankIdx = Math.min(prevRankIdx + Math.floor(Math.random() * 2) + 1, RANKS.length - 1);
        newQty = Math.max(1, prevQty + (Math.random() < 0.3 ? 1 : 0));
      }
    }
  }

  // 3. AI plays cards from its hand
  const cardsToPlay = [];
  // AI prefers to discard actual cards of newRankIdx if it has them
  const matchingCards = ai.hand.filter(c => c.rankIdx === newRankIdx);
  const otherCards = ai.hand.filter(c => c.rankIdx !== newRankIdx);

  let playQty = Math.min(newQty, ai.hand.length); // Cannot play more cards than held
  let matchingToPlay = Math.min(playQty, matchingCards.length);
  
  for (let i = 0; i < matchingToPlay; i++) {
    cardsToPlay.push(matchingCards[i]);
  }

  let remainingToPlay = playQty - matchingToPlay;
  // Shuffle other cards to play random bluffs
  shuffle(otherCards);
  for (let i = 0; i < remainingToPlay; i++) {
    cardsToPlay.push(otherCards[i]);
  }

  // Remove played cards from AI's hand
  cardsToPlay.forEach(card => {
    const idx = ai.hand.findIndex(c => c.rank === card.rank && c.suit === card.suit);
    if (idx !== -1) ai.hand.splice(idx, 1);
  });

  // Put played cards into pile/last bid
  table.cardsInLastBid = cardsToPlay;
  table.pile.push(...cardsToPlay);

  const isBluff = cardsToPlay.some(c => c.rankIdx !== newRankIdx);
  
  table.currentBid = {
    qty: newQty,
    rankIdx: newRankIdx,
    bidderIdx: table.currentPlayerIdx
  };

  addTableLog(table, ai.name, `Bid ${newQty} × ${RANKS[newRankIdx]}${isBluff ? ' 🎭' : ''}`);
  
  nextPlayer(table);
}

// Next player's turn
function nextPlayer(table) {
  const activePlayers = table.players.filter(p => !p.folded);
  if (activePlayers.length <= 1) {
    endGame(table);
    return;
  }

  let next = (table.currentPlayerIdx + 1) % table.players.length;
  while (table.players[next].folded) {
    next = (next + 1) % table.players.length;
  }
  
  table.currentPlayerIdx = next;
  broadcastGameState(table);
  startTurn(table);
}

// Execute challenge logic
function executeChallenge(table, challenger) {
  if (table.timerInterval) clearInterval(table.timerInterval);

  const bid = table.currentBid;
  const bidderIdx = bid.bidderIdx;
  const bidder = table.players[bidderIdx];

  // In classic Bluff/Cheat, all cards in last bid must match bid rank
  const playedCards = table.cardsInLastBid;
  const bidIsTrue = playedCards.length > 0 && playedCards.every(c => c.rankIdx === bid.rankIdx);
  const actualCount = playedCards.filter(c => c.rankIdx === bid.rankIdx).length;

  // Reveal results to clients
  table.players.forEach(p => {
    if (p.isAI) return;
    io.to(p.id).emit('challenge_reveal', {
      challengerName: challenger.name,
      bidderName: bidder.name,
      bidQty: bid.qty,
      bidRankVal: RANKS[bid.rankIdx],
      actualCount: actualCount,
      revealCards: playedCards,
      bidIsTrue: bidIsTrue
    });
  });

  let loserPlayer;
  if (bidIsTrue) {
    // Challenger lost (bid was true). Challenger takes pile.
    loserPlayer = challenger;
    table.pile.forEach(c => challenger.hand.push(c));
    addTableLog(table, challenger.name, 'Called BLUFF — BID TRUE!', 'fail');
    addTableLog(table, bidder.name, `Showed ${playedCards.length} × ${RANKS[bid.rankIdx]}`, 'success');
    addTableLog(table, challenger.name, `Picked up ${table.pile.length} cards`, 'fail');
  } else {
    // Bidder lost (caught bluffing). Bidder takes pile.
    loserPlayer = bidder;
    table.pile.forEach(c => bidder.hand.push(c));
    addTableLog(table, challenger.name, 'Called BLUFF — CORRECT!', 'success');
    addTableLog(table, bidder.name, `Picked up ${table.pile.length} cards`, 'fail');
  }

  table.pile = [];
  table.cardsInLastBid = [];
  table.currentBid = null;

  // Save index of the loser who starts the next turn
  const loserIdx = table.players.indexOf(loserPlayer);
  table.currentPlayerIdx = loserIdx !== -1 ? loserIdx : 0;

  broadcastGameState(table);
  startTurn(table);
}

// Execute fold/pass logic
function executeFold(table, player) {
  if (table.timerInterval) clearInterval(table.timerInterval);

  // Give entire pile to the player who folded
  table.pile.forEach(c => player.hand.push(c));
  table.pile = [];
  table.cardsInLastBid = [];
  table.currentBid = null;

  addTableLog(table, player.name, 'Folded & took the pile', 'fail');
  
  table.round++;
  
  // Folded player starts next round
  table.currentPlayerIdx = table.players.indexOf(player);
  if (table.currentPlayerIdx === -1) table.currentPlayerIdx = 0;

  broadcastGameState(table);
  startTurn(table);
}

// End game logic
function endGame(table) {
  if (table.timerInterval) clearInterval(table.timerInterval);
  table.gameActive = false;

  const remaining = table.players.filter(p => !p.folded);
  const loser = remaining[0] || table.players[0];

  // Distribute coin awards
  table.players.forEach(p => {
    if (p.isAI) return;
    
    const youWon = p !== loser;
    const prize = youWon ? Math.floor(Math.random() * 3000) + 1000 : -Math.min(500, p.coins);
    
    p.coins += prize;
    if (activePlayers[p.id]) activePlayers[p.id].coins = p.coins;

    // Persist coin changes in PostgreSQL
    db.updateUserCoins(p.name, prize);

    io.to(p.id).emit('game_over', {
      youWon,
      loserName: loser.name,
      prize
    });
  });

  // Log game history
  if (table.players.length > 0) {
    const winner = table.players.find(p => p !== loser && !p.isAI) || table.players.find(p => p !== loser) || table.players[0];
    db.logGame(winner.name, loser.name);
  }

  addTableLog(table, 'System', `Game Over! ${loser.name} lost.`);
  broadcastGameState(table);
  io.emit('lobby_update', getLobbyTables());
}

// Helper to handle player joining a table
function handleJoinTable(socket, id) {
  const player = activePlayers[socket.id];
  const table = tables.find(t => t.id === id);
  if (!player || !table) return;

  // Remove player from old table if any
  if (player.currentTableId) {
    leaveTable(socket, player.currentTableId);
  }

  player.currentTableId = table.id;
  socket.join(`table_${table.id}`);

  // Check if table is full (counting humans only or total seats)
  if (table.players.length >= table.max) {
    // Check if we can replace an AI player in an active game
    // Try to find an AI placeholder matching our name first, else any AI
    let aiPlayerIdx = table.players.findIndex(p => p.isAI && p.name === player.name);
    if (aiPlayerIdx === -1) {
      aiPlayerIdx = table.players.findIndex(p => p.isAI);
    }
    if (aiPlayerIdx !== -1) {
      // Convert AI to human!
      const aiPlayer = table.players[aiPlayerIdx];
      aiPlayer.id = player.id;
      aiPlayer.name = player.name;
      aiPlayer.coins = player.coins;
      aiPlayer.isAI = false;
      
      addTableLog(table, player.name, 'Replaced AI player', 'success');
      
      socket.emit('join_success', {
        id: table.id,
        name: table.name,
        max: table.max,
        decks: table.decks,
        minBet: table.minBet
      });
      
      broadcastGameState(table);
      io.emit('lobby_update', getLobbyTables());
      return;
    } else {
      // Room full and no AI, spectating
      socket.emit('toast', 'Table full. Joining as spectator.');
      socket.emit('join_success', {
        id: table.id,
        name: table.name,
        max: table.max,
        decks: table.decks,
        minBet: table.minBet
      });
      broadcastGameState(table);
      return;
    }
  }

  // Assign seat
  const usedSeats = table.players.map(p => p.seatIdx);
  let assignedSeat = 3; // Prefer seat 3
  if (usedSeats.includes(assignedSeat)) {
    assignedSeat = 0;
    while (usedSeats.includes(assignedSeat)) assignedSeat++;
  }

  table.players.push({
    id: player.id,
    name: player.name,
    coins: player.coins,
    hand: [],
    folded: false,
    isAI: false,
    seatIdx: assignedSeat
  });

  socket.emit('join_success', {
    id: table.id,
    name: table.name,
    max: table.max,
    decks: table.decks,
    minBet: table.minBet
  });

  addTableLog(table, player.name, 'Joined the table');
  io.emit('lobby_update', getLobbyTables());

  if (table.gameActive) {
    broadcastGameState(table);
  } else {
    startGame(table);
  }
}

// Socket IO communication
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Register user profile (legacy support)
  socket.on('register_player', (data) => {
    activePlayers[socket.id] = {
      id: socket.id,
      name: data.name || 'AceMaster',
      coins: data.coins || 12450,
      avatar: data.avatar || 'AC',
      currentTableId: null
    };
    
    // Broadcast initial lobby status to player
    socket.emit('lobby_update', getLobbyTables());
  });

  // DB Registration
  socket.on('register', async (data) => {
    try {
      const user = await db.registerUser(data.username, data.password, data.avatar);
      socket.emit('register_success', user);
    } catch (err) {
      socket.emit('toast', err.message || 'Registration failed');
    }
  });

  // DB Login
  socket.on('login', async (data) => {
    try {
      const user = await db.authenticateUser(data.username, data.password);
      if (!user) {
        socket.emit('login_error', 'Invalid username or password');
        return;
      }

      // Multi-login prevention
      const existingSocketId = Object.keys(activePlayers).find(
        sid => activePlayers[sid].name.toLowerCase() === user.username.toLowerCase()
      );
      if (existingSocketId) {
        io.to(existingSocketId).emit('toast', 'Logged in from another location.');
        delete activePlayers[existingSocketId];
      }

      activePlayers[socket.id] = {
        id: socket.id,
        name: user.username,
        coins: user.coins,
        avatar: user.avatar,
        currentTableId: null
      };

      socket.emit('login_success', user);
      socket.emit('lobby_update', getLobbyTables());
    } catch (err) {
      socket.emit('login_error', 'Authentication error');
    }
  });

  // Get Leaderboard
  socket.on('get_leaderboard', async () => {
    const list = await db.getLeaderboard();
    socket.emit('leaderboard_data', list);
  });

  // Create Table
  socket.on('create_table', (data) => {
    const player = activePlayers[socket.id];
    if (!player) return;

    const newTable = {
      id: Date.now(),
      name: data.name || 'My Table',
      players: [],
      max: data.maxPlayers || 6,
      decks: data.decks || 1,
      minBet: data.minBet || 500,
      gameActive: false,
      currentPlayerIdx: 0,
      currentBid: null,
      pile: [],
      cardsInLastBid: [],
      round: 0,
      log: [],
      timerSec: 15,
      timerInterval: null
    };

    tables.push(newTable);
    
    // Join the table
    player.currentTableId = newTable.id;
    newTable.players.push({
      id: player.id,
      name: player.name,
      coins: player.coins,
      hand: [],
      folded: false,
      isAI: false,
      seatIdx: 3 // visual bottom center seat
    });

    socket.join(`table_${newTable.id}`);
    socket.emit('join_success', {
      id: newTable.id,
      name: newTable.name,
      max: newTable.max,
      decks: newTable.decks,
      minBet: newTable.minBet
    });

    // Notify all in lobby
    io.emit('lobby_update', getLobbyTables());
    
    // Start game right away
    startGame(newTable);
  });

  // Join Table
  socket.on('join_table', (id) => {
    handleJoinTable(socket, id);
  });

  // Quick Join
  socket.on('quick_join', (data) => {
    const max = data.max || 6;
    const decks = data.decks || 1;
    
    // Find matching table that isn't full
    let table = tables.find(t => t.max === max && t.players.length < t.max);
    
    if (!table) {
      // Create one
      const newTableId = Date.now();
      table = {
        id: newTableId,
        name: max === 6 ? 'Quick Table' : 'Big Table',
        players: [],
        max,
        decks,
        minBet: 500,
        gameActive: false,
        currentPlayerIdx: 0,
        currentBid: null,
        pile: [],
        cardsInLastBid: [],
        round: 0,
        log: [],
        timerSec: 15,
        timerInterval: null
      };
      tables.push(table);
      io.emit('lobby_update', getLobbyTables());
    }

    // Join
    handleJoinTable(socket, table.id);
  });

  // Bid Action
  socket.on('place_bid', (data) => {
    const player = activePlayers[socket.id];
    if (!player || !player.currentTableId) return;

    const table = tables.find(t => t.id === player.currentTableId);
    if (!table || !table.gameActive) return;

    const activePlayer = table.players[table.currentPlayerIdx];
    if (!activePlayer || activePlayer.id !== socket.id) return; // Not their turn

    const qty = data.qty;
    const rankIdx = data.selectedIndices ? data.rankIdx : table.bidRankIdx;
    const indices = data.selectedIndices || [];

    // Verify turn timer
    if (table.timerInterval) clearInterval(table.timerInterval);

    // Validate bid values
    if (table.currentBid) {
      if (rankIdx < table.currentBid.rankIdx ||
          (rankIdx === table.currentBid.rankIdx && qty <= table.currentBid.qty)) {
        socket.emit('toast', 'Bid must be higher than current bid!');
        startTurn(table);
        return;
      }
    }

    // Validate selected cards quantity matches bid quantity
    if (indices.length !== qty) {
      socket.emit('toast', `Select exactly ${qty} cards to play!`);
      startTurn(table);
      return;
    }

    // Retrieve played cards from player hand using selected indices
    const playedCards = [];
    indices.sort((a, b) => b - a); // Sort descending to splice without messing up indices
    indices.forEach(idx => {
      if (idx < activePlayer.hand.length) {
        playedCards.push(activePlayer.hand[idx]);
        activePlayer.hand.splice(idx, 1);
      }
    });

    table.cardsInLastBid = playedCards;
    table.pile.push(...playedCards);

    table.currentBid = {
      qty,
      rankIdx,
      bidderIdx: table.currentPlayerIdx
    };

    addTableLog(table, activePlayer.name, `Bid ${qty} × ${RANKS[rankIdx]}`);
    
    nextPlayer(table);
  });

  // Challenge Action
  socket.on('challenge', () => {
    const player = activePlayers[socket.id];
    if (!player || !player.currentTableId) return;

    const table = tables.find(t => t.id === player.currentTableId);
    if (!table || !table.gameActive || !table.currentBid) return;

    const activePlayer = table.players[table.currentPlayerIdx];
    if (!activePlayer || activePlayer.id !== socket.id) return; // Not their turn

    executeChallenge(table, activePlayer);
  });

  // After challenge continue
  socket.on('after_challenge', () => {
    const player = activePlayers[socket.id];
    if (!player || !player.currentTableId) return;

    const table = tables.find(t => t.id === player.currentTableId);
    if (!table) return;

    // Check if player modal closed, and remove winners
    table.players.forEach(p => {
      if (p.hand.length === 0 && !p.folded) {
        p.folded = true;
        addTableLog(table, p.name, '🎉 Hand empty — safe!', 'success');
      }
    });

    const active = table.players.filter(p => !p.folded);
    if (active.length <= 1) {
      endGame(table);
    } else {
      table.round++;
      broadcastGameState(table);
      startTurn(table);
    }
  });

  // Fold Action
  socket.on('fold', () => {
    const player = activePlayers[socket.id];
    if (!player || !player.currentTableId) return;

    const table = tables.find(t => t.id === player.currentTableId);
    if (!table || !table.gameActive) return;

    const activePlayer = table.players[table.currentPlayerIdx];
    if (!activePlayer || activePlayer.id !== socket.id) return; // Not their turn

    executeFold(table, activePlayer);
  });

  // Play Again / Restart Game
  socket.on('play_again', () => {
    const player = activePlayers[socket.id];
    if (!player || !player.currentTableId) return;

    const table = tables.find(t => t.id === player.currentTableId);
    if (table && !table.gameActive) {
      // Remove any inactive/winners from table and replace them with new deck deal
      // Clean up player hands
      table.players = table.players.filter(p => !p.isAI); // Keep only humans
      startGame(table);
    }
  });

  // Lobby Refresh
  socket.on('refresh_lobby', () => {
    socket.emit('lobby_update', getLobbyTables());
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const player = activePlayers[socket.id];
    if (player) {
      if (player.currentTableId) {
        leaveTable(socket, player.currentTableId);
      }
      delete activePlayers[socket.id];
    }
  });
});

// Helper for players leaving tables
function leaveTable(socket, tableId) {
  const table = tables.find(t => t.id === tableId);
  if (!table) return;

  const playerIdx = table.players.findIndex(p => p.id === socket.id);
  if (playerIdx === -1) return;

  const p = table.players[playerIdx];
  socket.leave(`table_${tableId}`);

  if (table.gameActive) {
    // Convert to AI to avoid ruining active game
    p.isAI = true;
    p.id = `ai_replacement_${Date.now()}_${p.seatIdx}`;
    addTableLog(table, p.name, 'Left game (replaced by AI)');
    
    // If it was their turn, trigger AI turn logic
    if (table.currentPlayerIdx === playerIdx) {
      setTimeout(() => {
        if (table.gameActive && table.currentPlayerIdx === playerIdx) {
          if (table.timerInterval) clearInterval(table.timerInterval);
          aiTakeTurn(table, p);
        }
      }, 2000);
    }
  } else {
    // Game not active, remove immediately
    table.players.splice(playerIdx, 1);
    addTableLog(table, p.name, 'Left the table');
  }

  // Remove empty tables, reset default ones (1-5) to save CPU
  if (table.players.filter(p => !p.isAI).length === 0) {
    if (table.timerInterval) clearInterval(table.timerInterval);
    if (table.id <= 5) {
      table.gameActive = false;
      table.players = [];
      table.currentBid = null;
      table.pile = [];
      table.cardsInLastBid = [];
      table.log = [];
    } else {
      tables = tables.filter(t => t.id !== tableId);
    }
  }

  io.emit('lobby_update', getLobbyTables());
  broadcastGameState(table);
}

// Start Server
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
