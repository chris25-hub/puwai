// routes/chat.js
const express = require('express');
const router = express.Router();
const db = require('../db');

const BASE_URL = process.env.BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000';
function toFullUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return BASE_URL.replace(/\/$/, '') + (url.startsWith('/') ? url : '/' + url);
}

// 根据 uid 返回对端展示名与头像（客户看商家用 merchant，商家看客户用 user）
router.get('/partner-info', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ code: 400, error: '缺少 uid' });
    try {
        const [merchantRows] = await db.query('SELECT merchant_name as name, logo as avatar_url FROM merchant WHERE uid = ?', [uid]);
        if (merchantRows && merchantRows.length > 0) {
            const row = merchantRows[0] || { name: '商家', avatar_url: '' };
            return res.json({ code: 200, data: { name: row.name, avatar_url: toFullUrl(row.avatar_url) || '' } });
        }
        const [rows] = await db.query('SELECT nickname as name, avatar_url FROM user WHERE uid = ?', [uid]);
        const userRow = rows && rows[0] ? rows[0] : { name: uid, avatar_url: '' };
        return res.json({ code: 200, data: { name: userRow.name, avatar_url: toFullUrl(userRow.avatar_url) || '' } });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 用户端对话列表：订单会话 + 曾收到过消息的会话（含对方信息、最后一条消息、未读数）
// 约定：同一商家+客户只认一个会话 id = demand_id_merchant_id，按 session_id 去重避免同一条会话出现两条
router.get('/user-chat-list', async (req, res) => {
    const { user_uid } = req.query;
    if (!user_uid) return res.status(400).json({ code: 400, error: '缺少 user_uid' });
    try {
        const [rows] = await db.query(`
            SELECT t.session_id, t.to_user,
                (SELECT merchant_name FROM merchant WHERE uid = t.to_user LIMIT 1) AS to_user_name,
                (SELECT content FROM messages WHERE session_id = t.session_id ORDER BY create_time DESC LIMIT 1) AS last_msg,
                (SELECT COUNT(*) FROM messages WHERE session_id = t.session_id AND receiver_id = ? AND is_read = 0) AS unread
            FROM (
                SELECT session_id, MAX(to_user) AS to_user FROM (
                    SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, merchant_id AS to_user FROM main_order WHERE user_id = ?
                    UNION
                    SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, merchant_id AS to_user FROM unlock_order WHERE user_id = ?
                    UNION
                    SELECT DISTINCT session_id, SUBSTRING_INDEX(session_id, '_', -1) AS to_user FROM messages WHERE receiver_id = ?
                ) AS u
                GROUP BY session_id
            ) AS t`,
            [user_uid, user_uid, user_uid, user_uid]
        );
        res.json({ code: 200, data: rows || [] });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 本需求与商家的会话列表（仅当前需求下的 demand_id_merchant_id 会话，供智能体「消息」入口用）
router.get('/demand-chat-list', async (req, res) => {
    const { user_uid, demand_id } = req.query;
    if (!user_uid || !demand_id) return res.status(400).json({ code: 400, error: '缺少 user_uid 或 demand_id' });
    const prefix = String(demand_id).trim() + '_';
    try {
        const [rows] = await db.query(`
            SELECT t.session_id, t.to_user,
                (SELECT merchant_name FROM merchant WHERE uid = t.to_user LIMIT 1) AS to_user_name,
                (SELECT content FROM messages WHERE session_id = t.session_id ORDER BY create_time DESC LIMIT 1) AS last_msg,
                (SELECT COUNT(*) FROM messages WHERE session_id = t.session_id AND receiver_id = ? AND is_read = 0) AS unread
            FROM (
                SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, merchant_id AS to_user FROM main_order WHERE user_id = ? AND demand_id = ?
                UNION
                SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, merchant_id AS to_user FROM unlock_order WHERE user_id = ? AND demand_id = ?
                UNION
                SELECT CONCAT(?, '_', q.merchant_id) AS session_id, q.merchant_id AS to_user FROM demand_quote q INNER JOIN demand d ON q.demand_no = d.demand_no WHERE d.id = ?
            ) AS t
            WHERE t.session_id LIKE ?
        `, [user_uid, user_uid, demand_id, user_uid, demand_id, demand_id, demand_id, prefix + '%']);
        const seen = new Set();
        const list = (rows || []).filter((r) => (r.session_id || '').startsWith(prefix)).filter((r) => {
            if (seen.has(r.session_id)) return false;
            seen.add(r.session_id);
            return true;
        });
        const totalUnread = list.reduce((sum, r) => sum + (Number(r.unread) || 0), 0);
        res.json({ code: 200, data: list, total_unread: totalUnread });
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
            [merchant_id, user_id || '']
        );
        res.json({ code: 200, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;