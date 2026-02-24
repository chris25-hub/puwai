// routes/merchant.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { OpenAI } = require('openai');
const { generateOrderNo } = require('../utils/tools'); // 1. 引入工具函数



const openai = new OpenAI({
    apiKey: 'sk-41ea61f5f0c64c9fa277dda6f85c38bd',
    baseURL: 'https://api.deepseek.com'
});

// 获取商家资料（名称、头像），用于「我的」页展示；未找到时仍返回 200，字段为空便于前端兜底
router.get('/profile', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ code: 400, msg: '缺少 uid' });
    try {
        const [rows] = await db.query('SELECT merchant_name, logo FROM merchant WHERE uid = ?', [uid]);
        if (rows && rows.length > 0) {
            res.json({ code: 200, merchant_name: rows[0].merchant_name || null, logo: rows[0].logo || null });
        } else {
            res.json({ code: 200, merchant_name: null, logo: null });
        }
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// routes/merchant.js 修正版
router.get('/status', async (req, res) => {
    const { uid } = req.query;
    try {
        // 关键修复：使用 [rows] 解构，这样 rows 才是真正的记录行数组
        const [rows] = await db.query('SELECT status, reject_reason FROM merchant WHERE uid = ?', [uid]);
        
        if (rows && rows.length > 0) {
            // 现在 rows[0] 才是真正的对象 { status: 1, ... }
            res.json({ 
                code: 200, 
                status: rows[0].status, 
                reason: rows[0].reject_reason 
            });
        } else {
            res.json({ code: 404, msg: '未找到商家记录' });
        }
    } catch (err) {
        console.error('状态查询报错:', err);
        res.status(500).json({ code: 500, error: err.message });
    }
});


router.post('/register', async (req, res) => {
    const { company_name, description, license_url, user_id } = req.body;

    try {
        // 1. 调用 AI 分析商家的主营业务和标签
        const completion = await openai.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: "你是一个商家资质审核助手。请根据商家的名称和描述，总结出其主营服务的关键词标签（不超过5个），并给出初步的专业度评分（1.0-5.0）。请返回 JSON 格式：{tags: '标签1,标签2', initial_rating: 4.5}" 
                },
                { role: "user", content: `商家名称：${company_name}，描述：${description}` }
            ],
            response_format: { type: 'json_object' }
        });

        const aiResult = JSON.parse(completion.choices[0].message.content);

        // 2. 写入数据库
        const sql = `
            INSERT INTO merchant (user_id, merchant_name, logo, service_tags, rating, response_rate, status, create_time) 
            VALUES (?, ?, ?, ?, ?, 100, 0, NOW())
        `; // 初始状态为 0 (待审核) 
        
        const result = await db.query(sql, [
            user_id || 107, 
            company_name, 
            license_url, 
            aiResult.tags, 
            aiResult.initial_rating
        ]);

        res.json({ code: 200, msg: '入驻申请已提交，AI 自动解析成功', merchant_id: result.insertId });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

router.post('/submit-qualification', async (req, res) => {
    const { uid, merchant_name, service_tags, logo } = req.body;

    try {
        // merchant 表若无 update_time 字段则只更新以下字段
        const sql = `
            UPDATE merchant 
            SET 
                merchant_name = ?, 
                service_tags = ?, 
                logo = ?, 
                status = 0
            WHERE uid = ?`;
        
        const [result] = await db.query(sql, [merchant_name, service_tags, logo, uid]);

        if (result && result.affectedRows > 0) {
            res.json({ code: 200, msg: '提交成功，进入待审核状态' });
        } else {
            res.json({ code: 404, msg: '未找到该商家记录' });
        }
    } catch (err) {
        console.error('更新资质错误:', err);
        res.status(500).json({ code: 500, error: '服务器内部错误' });
    }
});

// routes/merchant.js

router.post('/grab', async (req, res) => {
    // 前端只传 UID 字符串。抢单不直接加钱：需与用户聊天后发单，用户支付后商家得 80%、平台 20%（在 order 的 update-step 完成时分账）
    const { demand_id, merchant_uid, customer_uid } = req.body;
    const order_no = await generateOrderNo('MAIN', 'main_order');

    try {
        const conn = await db.getConnection();
        await conn.beginTransaction();

        // 1. 检查需求
        const [demands] = await conn.query('SELECT status FROM demand WHERE id = ? FOR UPDATE', [demand_id]);
        if (!demands[0] || demands[0].status !== 0) {
            await conn.rollback();
            conn.release();
            return res.json({ code: 400, msg: '手慢了，该单已被抢' });
        }

        // 2. 更新需求状态
        await conn.query('UPDATE demand SET status = 1 WHERE id = ?', [demand_id]);

        // 3. 写入订单表；total_amount/paid_amount 在用户支付时更新，订单完成时按 80/20 分账
        const sql = `INSERT INTO main_order 
            (order_no, user_id, merchant_id, demand_id, total_amount, paid_amount, status, create_time) 
            VALUES (?, ?, ?, ?, 0, 0, 1, NOW())`;
        await conn.query(sql, [order_no, customer_uid, merchant_uid, demand_id]);

        await conn.commit();
        conn.release();
        res.json({ code: 200, msg: '抢单成功！请与用户沟通并发送订单，用户支付后您将获得订单金额的 80%。' });
    } catch (err) {
        if (conn) {
            await conn.rollback();
            conn.release();
        }
        console.error('抢单接口内部报错:', err.message); // 在后端控制台打印具体错误
        res.status(500).json({ code: 500, msg: '服务器错误', error: err.message });
    }
});

// 获取抢单大厅待处理需求列表（支持按 category 筛选、按 create_time 排序）
router.get('/hall-orders', async (req, res) => {
    try {
        const category = req.query.category ? parseInt(req.query.category, 10) : null;
        const order = (req.query.order === 'asc' || req.query.order === 'desc') ? req.query.order : 'desc';

        let sql = `SELECT id, user_id, category, tags, create_time FROM demand WHERE status = 0`;
        const params = [];
        if (category >= 1 && category <= 6) {
            sql += ` AND category = ?`;
            params.push(category);
        }
        sql += ` ORDER BY create_time ${order === 'asc' ? 'ASC' : 'DESC'}`;

        const [rows] = await db.query(sql, params);

        const categoryMap = { 1: '留学', 2: '签证', 3: '移民', 4: '迪拜房产', 5: '日本房产', 6: '海外生活' };

        const formattedData = rows.map(item => {
            let tagsArray = [];
            try {
                tagsArray = typeof item.tags === 'string' ? JSON.parse(item.tags) : (item.tags || []);
            } catch (e) { tagsArray = []; }

            return {
                id: item.id,
                user_id: item.user_id,
                category: item.category,
                type_name: categoryMap[item.category] || '海外生活',
                budget: '详谈',
                description: Array.isArray(tagsArray) ? tagsArray.join(' / ') : '暂无描述',
                create_time: item.create_time
            };
        });
        res.json({ code: 200, data: formattedData });
    } catch (err) {
        console.error('大厅接口报错:', err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取大厅待抢单总数统计 [cite: 141, 145]
// 修改 merchant.js 中的统计接口
router.get('/order-stats', async (req, res) => {
    try {
        // 增加 [rows] 解构
        const [rows] = await db.query('SELECT COUNT(*) as count FROM demand WHERE status = 0');
        res.json({ code: 200, count: rows[0].count });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取商家已抢到的订单列表
router.get('/my-orders', async (req, res) => {
    const { merchant_uid } = req.query;
    try {
        const sql = `SELECT * FROM main_order WHERE merchant_id = ? ORDER BY create_time DESC`;
        // 关键修复：增加 [rows] 解构，确保拿到的是对象数组
        const [rows] = await db.query(sql, [merchant_uid]);
        res.json({ code: 200, data: rows });
    } catch (err) { 
        res.status(500).json({ code: 500, error: err.message }); 
    }
});

// 2. 新增：更新订单进度接口
router.post('/update-order-status', async (req, res) => {
    const { order_no } = req.body;
    try {
        // 逻辑：将 status 字段加 1
        const sql = `UPDATE main_order SET status = status + 1 WHERE order_no = ? AND status < 4`;
        const [result] = await db.query(sql, [order_no]);
        
        if (result.affectedRows > 0) {
            res.json({ code: 200, msg: '进度更新成功' });
        } else {
            res.json({ code: 400, msg: '更新失败，可能订单已完成' });
        }
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});


// 客户咨询列表：同时拉取正式订单(main_order)与解锁对话订单(unlock_order)。session_id 统一为 demand_id_merchant_id 格式，与 messages 表一致
router.get('/chat-list', async (req, res) => {
    const { merchant_uid } = req.query;
    try {
        const sql = `
            SELECT t.session_id, t.user_id,
            (SELECT nickname FROM user WHERE uid = t.user_id LIMIT 1) AS user_nickname,
            (SELECT COUNT(*) FROM messages WHERE session_id = t.session_id AND receiver_id = ? AND is_read = 0) AS unread
            FROM (
                SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, user_id FROM main_order WHERE merchant_id = ?
                UNION
                SELECT CONCAT(demand_id, '_', merchant_id) AS session_id, user_id FROM unlock_order WHERE merchant_id = ?
            ) AS t`;
        const [rows] = await db.query(sql, [merchant_uid, merchant_uid, merchant_uid]);
        res.json({ code: 200, data: rows || [] });
    } catch (err) {
        console.error('chat-list 报错:', err);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 新增：进入聊天室后将消息设为已读
router.post('/read-messages', async (req, res) => {
    const { session_id, my_uid } = req.body;
    try {
        const sql = `UPDATE messages SET is_read = 1 WHERE session_id = ? AND receiver_id = ?`;
        await db.query(sql, [session_id, my_uid]);
        res.json({ code: 200 });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 在 merchant.js 中添加

// 发送消息
router.post('/send-message', async (req, res) => {
    const { session_id, sender_id, receiver_id, content } = req.body;
    try {
        const sql = `INSERT INTO messages (session_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)`;
        await db.query(sql, [session_id, sender_id, receiver_id, content]);
        res.json({ code: 200, msg: '发送成功' });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取聊天记录
router.get('/get-messages', async (req, res) => {
    const { session_id } = req.query;
    try {
        const [rows] = await db.query(`SELECT * FROM messages WHERE session_id = ? ORDER BY create_time ASC`, [session_id]);
        res.json({ code: 200, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 在 merchant.js 中添加或修改统计接口
// 获取首页看板统计数据
router.get('/merchant-stats', async (req, res) => {
    const { merchant_uid } = req.query;
    try {
        // 统计今日订单
        const [orderRes] = await db.query(
            `SELECT COUNT(*) as todayCount FROM main_order 
             WHERE merchant_id = ? AND DATE(create_time) = CURDATE()`, 
            [merchant_uid]
        );
        
        // 获取最新余额
        const [walletRes] = await db.query(
            `SELECT balance FROM merchant WHERE uid = ?`, 
            [merchant_uid]
        );

        res.json({ 
            code: 200, 
            todayCount: orderRes[0].todayCount || 0,
            balance: walletRes[0] ? (Number(walletRes[0].balance) / 100).toFixed(2) : '0.00'
        });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取商家资金流水明细（merchant_wallet 表用 update_time 表示流水时间，接口里别名成 create_time 给前端用）
router.get('/wallet-logs', async (req, res) => {
    const { merchant_uid } = req.query;
    const sql = `
        SELECT w.*, w.change_amount / 100 as amount_display, w.create_time as create_time
        FROM merchant_wallet w
        JOIN merchant m ON w.merchant_id = m.uid
        WHERE m.uid = ? ORDER BY w.create_time DESC`;
    const [rows] = await db.query(sql, [merchant_uid]);
    res.json({ code: 200, data: rows });
});

module.exports = router;