// 智能体对话持久化（独立于原有 chat/messages 表）
const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取当前用户的智能体会话列表（供首页对话列表展示，与商家会话合并）
router.get('/sessions', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ code: 400, error: '缺少 user_id' });
    try {
        const [rows] = await db.query(
            `SELECT s.id AS session_id, s.agent_type, s.update_time,
                (SELECT m.content FROM agent_chat_message m WHERE m.session_id = s.id ORDER BY m.create_time DESC LIMIT 1) AS last_msg
             FROM agent_chat_session s
             WHERE s.user_id = ?
             ORDER BY s.update_time DESC`,
            [user_id]
        );
        const list = (rows || []).map((r) => ({
            session_id: 'agent_' + (r.agent_type || ''),
            agent_type: r.agent_type,
            to_user_name: null,
            last_msg: r.last_msg || '',
            update_time: r.update_time,
            isAgent: true
        }));
        res.json({ code: 200, data: list });
    } catch (err) {
        const msg = err.message || '';
        if (msg.includes('doesn\'t exist') || msg.includes('agent_chat_session')) {
            return res.status(503).json({ code: 503, error: '请先执行 scripts/agent-chat-tables.sql' });
        }
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取或创建会话：同一 user_id + agent_type 唯一一个会话
router.post('/session', async (req, res) => {
    const { user_id, agent_type } = req.body || {};
    console.log('[agent-chat] POST /session body:', { user_id, agent_type });
    if (!user_id || !agent_type) {
        console.log('[agent-chat] POST /session 缺少参数');
        return res.status(400).json({ code: 400, error: '缺少 user_id 或 agent_type' });
    }
    try {
        const [rows] = await db.query(
            'SELECT id FROM agent_chat_session WHERE user_id = ? AND agent_type = ? LIMIT 1',
            [user_id, agent_type]
        );
        if (rows && rows.length > 0) {
            console.log('[agent-chat] POST /session 已有会话 session_id=', rows[0].id);
            return res.json({ code: 200, data: { session_id: rows[0].id } });
        }
        const [result] = await db.query(
            'INSERT INTO agent_chat_session (user_id, agent_type) VALUES (?, ?)',
            [user_id, agent_type]
        );
        console.log('[agent-chat] POST /session 新建会话 session_id=', result.insertId);
        res.json({ code: 200, data: { session_id: result.insertId } });
    } catch (err) {
        console.error('[agent-chat] POST /session error:', err.message);
        const msg = err.message || '';
        if (msg.includes('doesn\'t exist') || msg.includes('agent_chat_session')) {
            return res.status(503).json({ code: 503, error: '请先在数据库执行 scripts/agent-chat-tables.sql 创建智能体对话表' });
        }
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取会话下的消息列表（按时间正序，前端直接当 messages 用）
router.get('/messages', async (req, res) => {
    const { session_id } = req.query;
    console.log('[agent-chat] GET /messages session_id=', session_id);
    if (!session_id) return res.status(400).json({ code: 400, error: '缺少 session_id' });
    try {
        const [rows] = await db.query(
            'SELECT id, session_id, role, content, msg_type, extra, create_time FROM agent_chat_message WHERE session_id = ? ORDER BY create_time ASC',
            [session_id]
        );
        const list = (rows || []).map((r) => {
            if (r.msg_type === 'recommendation_card' && r.extra != null) {
                try {
                    const ex = typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra;
                    return {
                        type: 'recommendation_card',
                        demand_id: ex.demand_id,
                        ai_recommendation: ex.ai_recommendation || {},
                        merchants: ex.merchants || []
                    };
                } catch (e) {
                    return { role: r.role || 'assistant', content: r.content || '' };
                }
            }
            return { role: r.role || 'user', content: r.content || '' };
        });
        console.log('[agent-chat] GET /messages 条数=', (list || []).length);
        res.json({ code: 200, data: list });
    } catch (err) {
        console.error('[agent-chat] GET /messages error:', err.message);
        const msg = err.message || '';
        if (msg.includes('doesn\'t exist') || msg.includes('agent_chat_message')) {
            return res.status(503).json({ code: 503, error: '请先在数据库执行 scripts/agent-chat-tables.sql 创建智能体对话表' });
        }
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 追加一条消息（用户消息 / AI 回复 / 推荐卡片）
router.post('/message', async (req, res) => {
    const { session_id, role, content, msg_type, extra } = req.body || {};
    console.log('[agent-chat] POST /message', { session_id, role, msg_type, contentLength: (content && String(content).length) || 0 });
    if (!session_id) return res.status(400).json({ code: 400, error: '缺少 session_id' });
    const r = role || 'user';
    const c = content != null ? content : '';
    const mt = msg_type || null;
    const ex = extra != null ? (typeof extra === 'string' ? extra : JSON.stringify(extra)) : null;
    try {
        await db.query(
            'INSERT INTO agent_chat_message (session_id, role, content, msg_type, extra) VALUES (?, ?, ?, ?, ?)',
            [session_id, r, c, mt, ex]
        );
        res.json({ code: 200 });
    } catch (err) {
        console.error('[agent-chat] POST /message error:', err.message);
        const msg = err.message || '';
        if (msg.includes('doesn\'t exist') || msg.includes('agent_chat_message')) {
            return res.status(503).json({ code: 503, error: '请先在数据库执行 scripts/agent-chat-tables.sql 创建智能体对话表' });
        }
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;
