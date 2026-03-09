// 智能体对话持久化（独立于原有 chat/messages 表）
const express = require('express');
const router = express.Router();
const db = require('../db');

// 首次创建会话时的智能体开场白（用于在对话列表中形成一条默认记录）
const ENTRY_GREETINGS = {
    visa: '你好，我是普外国际签证智能体，可以帮你梳理各国签证类型、材料清单和办理流程，有签证相关的问题都可以先跟我聊。',
    migration: '你好，我是普外国际移民智能体，可以根据你的家庭情况和预算，帮你梳理各国移民路径、政策要求和大致成本。',
    study: '你好，我是普外国际留学智能体，可以结合你的成绩和目标国家，帮你规划本硕博留学方案、选校和申请步骤。',
    enterprise: '你好，我是普外国际企业出海智能体，可以帮你了解海外公司注册、合规要求以及本地运营的关键注意事项。',
    life: '你好，我是普外国际海外生活智能体，可以解答海外租房、就医、子女教育等落地生活相关的问题。',
    estate_dubai: '你好，我是普外国际迪拜房产智能体，可以为你介绍迪拜买房政策、热门区域以及与黄金签证相关的要求。',
    estate_japan: '你好，我是普外国际日本房产智能体，可以为你介绍日本购房、经营管理签证以及当地生活配套信息。',
    public_welfare: '你好，我是普外国际公益社群智能体，可以帮你了解海外华人互助、公益项目以及参与方式。',
    self_operated: '你好，我是龙宫自营智能体，可以优先为你推荐平台自营的签证、留学、移民等服务方案，并帮助你对比第三方商家报价。'
};

// 获取所有智能体头像（供前端动态覆盖本地图标）
router.get('/avatars', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT agent_type, avatar_url FROM agent_avatar');
        const data = {};
        for (const r of rows) {
            if (r.avatar_url) {
                data[r.agent_type] = r.avatar_url;
            }
        }
        res.json({ code: 200, data });
    } catch (err) {
        // 如果表不存在，忽略并返回空
        res.json({ code: 200, data: {} });
    }
});

// 获取当前用户的智能体会话列表（供首页对话列表展示，与商家会话合并）
router.get('/sessions', async (req, res) => {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ code: 400, error: '缺少 user_id' });
    try {
        const [rows] = await db.query(
            `SELECT s.id AS session_id, s.agent_type, s.update_time,
                (SELECT m.content FROM agent_chat_message m WHERE m.session_id = s.id ORDER BY m.create_time DESC LIMIT 1) AS last_msg,
                (SELECT COUNT(*) FROM agent_chat_message m WHERE m.session_id = s.id AND m.role = 'assistant' AND COALESCE(m.is_read, 0) = 0) AS unread
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
            unread: Number(r.unread || 0),
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
        const sessionId = result.insertId;
        console.log('[agent-chat] POST /session 新建会话 session_id=', sessionId);

        // 为新会话写入一条默认的智能体开场白，便于对话列表直接展示入口
        const greet = ENTRY_GREETINGS[agent_type];
        if (greet) {
            try {
                await db.query(
                    'INSERT INTO agent_chat_message (session_id, role, content, msg_type, extra) VALUES (?, ?, ?, NULL, NULL)',
                    [sessionId, 'assistant', greet]
                );
            } catch (e) {
                console.warn('[agent-chat] 写入默认开场白失败:', e.message || e);
            }
        }

        res.json({ code: 200, data: { session_id: sessionId } });
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
            `SELECT id, session_id, role, content, msg_type, extra, create_time 
             FROM agent_chat_message 
             WHERE session_id = ? 
               AND create_time >= COALESCE((SELECT MAX(create_time) FROM agent_chat_message WHERE session_id = ? AND msg_type = 'clear_history'), '1970-01-01')
             ORDER BY create_time ASC`,
            [session_id, session_id]
        );
        const list = (rows || []).filter(r => r.msg_type !== 'clear_history').map((r) => {
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
            if (r.msg_type === 'product_card' && r.extra != null) {
                try {
                    const ex = typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra;
                    return {
                        type: 'product_card',
                        product_id: ex.product_id,
                        product_label: ex.product_label || ex.label,
                        product_image: ex.product_image,
                        product_price: ex.product_price
                    };
                } catch (e) {
                    return { role: r.role || 'assistant', content: r.content || '' };
                }
            }
            if (r.msg_type === 'quote_analysis_card' && r.extra != null) {
                try {
                    const ex = typeof r.extra === 'string' ? JSON.parse(r.extra) : r.extra;
                    return {
                        type: 'quote_analysis_card',
                        demand_id: ex.demand_id,
                        ai_summary: ex.ai_summary || null,
                        quotes: ex.quotes || []
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

// 进入智能体对话后标记该会话下所有 assistant 消息为已读（用于对话列表未读红点清零）
router.post('/mark-read', async (req, res) => {
    const { session_id } = req.body || {};
    if (session_id == null || session_id === '') return res.status(400).json({ code: 400, error: '缺少 session_id' });
    const sid = Number(session_id);
    if (isNaN(sid) || sid <= 0) return res.status(400).json({ code: 400, error: 'session_id 无效' });
    try {
        await db.query(
            'UPDATE agent_chat_message SET is_read = 1 WHERE session_id = ? AND role = ?',
            [sid, 'assistant']
        );
        res.json({ code: 200 });
    } catch (err) {
        console.error('[agent-chat] POST /mark-read error:', err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 清空当前智能体的聊天记录（通过插入一个断点标记，使查询接口忽略此前的所有消息，并附带一条新的开场白）
router.post('/clear', async (req, res) => {
    const { session_id, agent_type } = req.body || {};
    if (!session_id || !agent_type) return res.status(400).json({ code: 400, error: '缺少 session_id 或 agent_type' });
    try {
        // 1. 插入清空断点
        await db.query(
            'INSERT INTO agent_chat_message (session_id, role, content, msg_type) VALUES (?, ?, ?, ?)',
            [session_id, 'system', 'clear', 'clear_history']
        );
        // 2. 写入新的默认开场白
        const greet = ENTRY_GREETINGS[agent_type];
        if (greet) {
            // 注意：这里需要稍微延迟一点点时间或者直接插入，因为获取时是以 create_time 为条件的。
            // 由于上面是一个 query，接下来这个也是一个 query，如果同一秒执行的话可能会有问题。
            // 在 MySQL 5.6+ 中 datetime 默认精度是秒，如果两行在同一秒插入，create_time 会相同。
            // 但我们的查询条件是 >= (MAX clear_history)，所以只要 create_time >= clear_history 的 create_time，
            // 这条开场白就能被查出来，所以同一秒也没有关系，它会被保留。
            await db.query(
                'INSERT INTO agent_chat_message (session_id, role, content, msg_type) VALUES (?, ?, ?, NULL)',
                [session_id, 'assistant', greet]
            );
        }
        res.json({ code: 200 });
    } catch (err) {
        console.error('[agent-chat] POST /clear error:', err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;
