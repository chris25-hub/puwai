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

// 用户端对话列表：当前用户作为 user_id 的 main_order / unlock_order 会话，含对方商家信息、最后一条消息、未读数（不修改原有接口，新增）
router.get('/user-chat-list', async (req, res) => {
        const db = require('../db');
    const { user_uid } = req.query;
    if (!user_uid) return res.status(400).json({ code: 400, error: '缺少 user_uid' });
    try {
        const [rows] = await db.query(`
            SELECT t.session_id, t.merchant_id AS to_user,
                (SELECT merchant_name FROM merchant WHERE uid = t.merchant_id LIMIT 1) AS to_user_name,
                (SELECT content FROM messages WHERE session_id = t.session_id ORDER BY create_time DESC LIMIT 1) AS last_msg,
                (SELECT COUNT(*) FROM messages WHERE session_id = t.session_id AND receiver_id = ? AND is_read = 0) AS unread
            FROM (
                SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, merchant_id FROM main_order WHERE user_id = ?
                UNION
                SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, merchant_id FROM unlock_order WHERE user_id = ?
            ) AS t`,
            [user_uid, user_uid, user_uid]
        );
        res.json({ code: 200, data: rows || [] });
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