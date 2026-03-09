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

// 审核操作 (status 1=通过 2=拒绝)。通过时将该用户的 user.role 升级为 merchant
router.post('/audit-action', async (req, res) => {
    const { uid, status } = req.body;
    if (!uid) return res.status(400).json({ code: 400, error: '缺少 uid' });
    try {
        await db.query('UPDATE merchant SET status = ? WHERE uid = ?', [status, uid]);
        if (Number(status) === 1) {
            await db.query('UPDATE user SET role = ? WHERE uid = ?', ['merchant', uid]);
        }
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

// 管理端商品管理接口
router.get('/products', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, category, label, price, img_url, sort_order, status FROM self_product ORDER BY category ASC, sort_order ASC');
        res.json({ code: 200, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

router.post('/product/toggle-status', async (req, res) => {
    const { id, status } = req.body;
    if (!id || status === undefined) return res.status(400).json({ code: 400, error: '参数缺失' });
    try {
        await db.query('UPDATE self_product SET status = ? WHERE id = ?', [status, id]);
        res.json({ code: 200, msg: '状态已更新' });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

router.post('/product/save', async (req, res) => {
    const { id, category, label, price, img_url, sort_order, status } = req.body;
    try {
        if (id) {
            await db.query(
                'UPDATE self_product SET category=?, label=?, price=?, img_url=?, sort_order=?, status=? WHERE id=?',
                [category, label, price || 0, img_url || '', sort_order || 0, status ?? 1, id]
            );
            res.json({ code: 200, msg: '更新成功' });
        } else {
            await db.query(
                'INSERT INTO self_product (category, label, price, img_url, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)',
                [category, label, price || 0, img_url || '', sort_order || 0, status ?? 1]
            );
            res.json({ code: 200, msg: '新增成功' });
        }
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;