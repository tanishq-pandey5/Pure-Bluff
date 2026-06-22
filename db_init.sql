-- db_init.sql

-- Drop tables if they exist
DROP TABLE IF EXISTS game_history CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    coins INT DEFAULT 12450,
    avatar VARCHAR(5) DEFAULT 'AC',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create game_history table
CREATE TABLE game_history (
    id SERIAL PRIMARY KEY,
    winner_name VARCHAR(50) NOT NULL,
    loser_name VARCHAR(50) NOT NULL,
    played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default players for the leaderboard
INSERT INTO users (username, password_hash, coins, avatar) VALUES
('BluffKing', '$2a$10$dummyhashforbotsnotusable1234567890', 35000, 'BK'),
('QueenBluff', '$2a$10$dummyhashforbotsnotusable1234567890', 28500, 'QB'),
('RaiseIt', '$2a$10$dummyhashforbotsnotusable1234567890', 18200, 'RI'),
('PokerFace', '$2a$10$dummyhashforbotsnotusable1234567890', 15400, 'PF'),
('AllinAlways', '$2a$10$dummyhashforbotsnotusable1234567890', 14200, 'AA');
