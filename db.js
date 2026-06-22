const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

let pool = null;
let useDb = false;

// Fallback in-memory store if DB is down/not configured
const memoryUsers = new Map();
const defaultLeaderboard = [
  { username: 'BluffKing', coins: 35000, avatar: 'BK' },
  { username: 'QueenBluff', coins: 28500, avatar: 'QB' },
  { username: 'RaiseIt', coins: 18200, avatar: 'RI' },
  { username: 'PokerFace', coins: 15400, avatar: 'PF' },
  { username: 'AllinAlways', coins: 14200, avatar: 'AA' }
];

// Seed memory users
defaultLeaderboard.forEach(p => {
  memoryUsers.set(p.username.toLowerCase(), {
    id: Math.floor(Math.random() * 10000),
    username: p.username,
    passwordHash: '$2a$10$dummyhashforbotsnotusable1234567890',
    coins: p.coins,
    avatar: p.avatar
  });
});

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Add short timeout to fail fast if DB is down on startup
    connectionTimeoutMillis: 3000
  });

  // Test the database connection
  pool.query('SELECT NOW()')
    .then(() => {
      console.log('✅ PostgreSQL Database connected successfully!');
      useDb = true;
    })
    .catch(err => {
      console.warn('⚠️ WARNING: PostgreSQL connection failed. Running in OFFLINE/IN-MEMORY fallback mode.', err.message);
      useDb = false;
    });

  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err.message);
  });
} else {
  console.warn('⚠️ WARNING: No DATABASE_URL specified. Running in OFFLINE/IN-MEMORY fallback mode.');
}

// ── REGISTRATION ──
async function registerUser(username, password, avatar) {
  const cleanUsername = username.trim();
  const key = cleanUsername.toLowerCase();
  
  if (!cleanUsername || !password) {
    throw new Error('Username and password are required');
  }

  if (useDb) {
    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO users (username, password_hash, avatar) VALUES ($1, $2, $3) RETURNING id, username, coins, avatar',
        [cleanUsername, passwordHash, avatar || 'AC']
      );
      return result.rows[0];
    } catch (error) {
      if (error.code === '23505') {
        throw new Error('Username already exists');
      }
      throw error;
    }
  } else {
    // In-memory fallback
    if (memoryUsers.has(key)) {
      throw new Error('Username already exists');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id: Date.now(),
      username: cleanUsername,
      passwordHash: passwordHash,
      coins: 12450,
      avatar: avatar || 'AC'
    };
    memoryUsers.set(key, newUser);
    return {
      id: newUser.id,
      username: newUser.username,
      coins: newUser.coins,
      avatar: newUser.avatar
    };
  }
}

// ── LOGIN ──
async function authenticateUser(username, password) {
  const cleanUsername = username.trim();
  const key = cleanUsername.toLowerCase();
  if (!cleanUsername || !password) return null;

  if (useDb) {
    try {
      const result = await pool.query('SELECT * FROM users WHERE LOWER(username) = $1', [key]);
      if (result.rows.length === 0) return null;
      
      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return null;

      return {
        id: user.id,
        username: user.username,
        coins: user.coins,
        avatar: user.avatar
      };
    } catch (error) {
      console.error('Error during DB authentication:', error);
      return null;
    }
  } else {
    // In-memory fallback
    const user = memoryUsers.get(key);
    if (!user) return null;
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return null;
    return {
      id: user.id,
      username: user.username,
      coins: user.coins,
      avatar: user.avatar
    };
  }
}

// ── COINS ADJUSTMENT ──
async function updateUserCoins(username, change) {
  const key = username.toLowerCase();
  if (useDb) {
    try {
      const result = await pool.query(
        'UPDATE users SET coins = coins + $1 WHERE LOWER(username) = $2 RETURNING coins',
        [change, key]
      );
      if (result.rows.length > 0) {
        return result.rows[0].coins;
      }
      return null;
    } catch (error) {
      console.error('Error updating coins in DB:', error);
      return null;
    }
  } else {
    // In-memory fallback
    const user = memoryUsers.get(key);
    if (user) {
      user.coins = Math.max(0, user.coins + change);
      return user.coins;
    }
    return null;
  }
}

// ── LEADERBOARD QUERY ──
async function getLeaderboard() {
  if (useDb) {
    try {
      const result = await pool.query(
        'SELECT username, coins, avatar FROM users ORDER BY coins DESC LIMIT 5'
      );
      return result.rows;
    } catch (error) {
      console.error('Error fetching leaderboard from DB:', error);
      return defaultLeaderboard;
    }
  } else {
    // In-memory fallback
    const sorted = [...memoryUsers.values()]
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 5)
      .map(u => ({ username: u.username, coins: u.coins, avatar: u.avatar }));
    return sorted;
  }
}

// ── LOG GAME HISTORY ──
async function logGame(winnerName, loserName) {
  if (useDb) {
    try {
      await pool.query(
        'INSERT INTO game_history (winner_name, loser_name) VALUES ($1, $2)',
        [winnerName, loserName]
      );
    } catch (error) {
      console.error('Error logging game to history:', error);
    }
  }
}

module.exports = {
  registerUser,
  authenticateUser,
  updateUserCoins,
  getLeaderboard,
  logGame
};
