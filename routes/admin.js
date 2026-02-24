const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取待审核列表 (status = 0)
router.get('/pending-list', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT uid, merchant_name, service_tags FROM merchant WHERE status = 0');
        res.json({ code: 200, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 审核操作 (修改 status 为 1 或 2)
router.post('/audit-action', async (req, res) => {
    const { uid, status } = req.body;
    try {
        await db.query('UPDATE merchant SET status = ? WHERE uid = ?', [status, uid]);
        res.json({ code: 200, msg: '审核操作成功' });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 用户数据管理：分页读取 user 表全部字段，每页最多 10 条
router.get('/user-list', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(10, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
        const offset = (page - 1) * pageSize;

        const [[countRow]] = await db.query('SELECT COUNT(*) AS total FROM user');
        const total = countRow?.total ?? 0;

        const [rows] = await db.query(
            'SELECT id, uid, role, nickname, avatar_url, phone, is_real_name, status, create_time, update_time FROM user ORDER BY id DESC LIMIT ? OFFSET ?',
            [pageSize, offset]
        );
        res.json({ code: 200, data: { list: rows, total } });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 管理端财务对账接口 
// 在 admin.js 中添加财务统计接口
router.get('/finance', async (req, res) => {
    try {
        // 直接从你命名的 platform_wallet 表中查询
        const sql = `
            SELECT 
                order_no, 
                user_id as source_user_id, 
                merchant_id as related_merchant_id, 
                total_amount, 
                amount as platform_profit, 
                type, 
                create_time 
            FROM platform_wallet 
            ORDER BY create_time DESC`;
        
        const [rows] = await db.query(sql);
        res.json({ code: 200, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;