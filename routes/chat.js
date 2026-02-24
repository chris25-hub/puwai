// routes/chat.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// 根据 uid 返回对端展示名（客户看商家用 merchant_name，商家看客户用 user.nickname）
router.get('/partner-info', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ code: 400, error: '缺少 uid' });
    try {
        if (String(uid).startsWith('mer-')) {
            const [rows] = await db.query('SELECT merchant_name as name, logo as avatar_url FROM merchant WHERE uid = ?', [uid]);
            return res.json({ code: 200, data: rows && rows[0] ? rows[0] : { name: '商家', avatar_url: '' } });
        }
        const [rows] = await db.query('SELECT nickname as name, avatar_url FROM user WHERE uid = ?', [uid]);
        return res.json({ code: 200, data: rows && rows[0] ? rows[0] : { name: uid, avatar_url: '' } });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取聊天记录：与商家端统一使用 messages 表（按 session_id）；无 session_id 时兼容旧接口 chat_messages
router.get('/history', async (req, res) => {
    const { session_id, merchant_id, user_id } = req.query;
    try {
        if (session_id) {
            const [rows] = await db.query(
                'SELECT * FROM messages WHERE session_id = ? ORDER BY create_time ASC',
                [session_id]
            );
            return res.json({ code: 200, data: rows });
        }
        const [rows] = await db.query(
            'SELECT content, sender_type as role FROM chat_messages WHERE merchant_id = ? AND user_id = ? ORDER BY create_time ASC',
            [merchant_id, user_id || 'cus-1']
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;