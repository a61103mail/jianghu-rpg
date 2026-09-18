// 帳號註冊 / 登入
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { createDefaultSave } from '../engine/characterEngine.js';

const JWT_SECRET = process.env.JWT_SECRET || 'jianghu-dev-secret-please-change';
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fff]+$/;
// 玩家ID(遊戲內顯示暱稱,取代帳號直接曝光在畫面上):規則比照帳號,但長度上限縮短一些,
// 避免在裝備欄/戰鬥列這類寸土寸金的版面被過長的暱稱擠壓排版。
const PLAYER_ID_RE = /^[a-zA-Z0-9_\u4e00-\u9fff]+$/;

export default function authRoutes() {
  const router = Router();
  const insertUser = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)');
  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
  const findUserById = db.prepare('SELECT * FROM users WHERE id = ?');
  const findByPlayerId = db.prepare('SELECT id FROM users WHERE player_id = ?');
  const updatePlayerId = db.prepare('UPDATE users SET player_id = ? WHERE id = ?');
  const insertSave = db.prepare('INSERT INTO saves (user_id, data, updated_at) VALUES (?, ?, ?)');

  router.post('/register', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: '請輸入帳號密碼' });
    }
    if (username.length < 3 || username.length > 16) {
      return res.status(400).json({ error: '帳號需 3~16 字元' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: '帳號僅能使用英數字、底線或中文' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: '密碼至少需 4 碼' });
    }
    if (await findUser.get(username)) {
      return res.status(409).json({ error: '此帳號已被註冊' });
    }
    const hash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();
    const result = await insertUser.run(username, hash, now);
    const userId = Number(result.lastInsertRowid);
    await insertSave.run(userId, JSON.stringify(createDefaultSave()), now);
    const token = jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username, playerId: null }); // 新帳號尚未設定玩家ID,前端需先導向取ID畫面
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const user = await findUser.get(username);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username, playerId: user.player_id || null });
  });

  // 設定玩家ID(遊戲內顯示暱稱):新帳號選職業前的第一步,只能設定一次沒有的情況下才能改
  // (已經設定過的話直接拒絕,避免玩家改名造成決鬥/交易所歷史紀錄對不上人)。需全服唯一。
  router.post('/set-player-id', authMiddleware, async (req, res) => {
    const { playerId } = req.body || {};
    if (typeof playerId !== 'string' || playerId.length < 2 || playerId.length > 12) {
      return res.status(400).json({ error: '玩家ID需 2~12 字元' });
    }
    if (!PLAYER_ID_RE.test(playerId)) {
      return res.status(400).json({ error: '玩家ID僅能使用英數字、底線或中文' });
    }
    const user = await findUserById.get(req.user.userId);
    if (!user) return res.status(404).json({ error: '找不到帳號' });
    if (user.player_id) return res.status(400).json({ error: '玩家ID已設定過,無法重複設定' });
    const existing = await findByPlayerId.get(playerId);
    if (existing) return res.status(409).json({ error: '此玩家ID已被使用,換一個試試' });
    await updatePlayerId.run(playerId, user.id);
    res.json({ playerId });
  });

  // 重新整理頁面後,JWT payload 只有 userId/username(playerId 是登入後才可能設定的動態資料,
  // 沒有編進 token),前端需要靠這支 API 重新問伺服器目前的 playerId 才能恢復畫面顯示。
  router.get('/me', authMiddleware, async (req, res) => {
    const user = await findUserById.get(req.user.userId);
    if (!user) return res.status(404).json({ error: '找不到帳號' });
    res.json({ username: user.username, playerId: user.player_id || null });
  });

  return router;
}

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登入' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'token 無效或過期' });
  }
}
