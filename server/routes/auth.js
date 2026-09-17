// 帳號註冊 / 登入
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { createDefaultSave } from '../engine/characterEngine.js';

const JWT_SECRET = process.env.JWT_SECRET || 'jianghu-dev-secret-please-change';
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fff]+$/;

export default function authRoutes() {
  const router = Router();
  const insertUser = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)');
  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
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
    res.json({ token, username });
  });

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const user = await findUser.get(username);
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, username: user.username });
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
