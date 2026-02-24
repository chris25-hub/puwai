const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateOrderNo } = require('../utils/tools'); // 1. 引入工具函数

// 1. 解锁商家接口：修复了 order_no 缺失和拼写错误
// routes/order.js

// 约定：业务上严格用 uid 匹配（mer-/cus-/rot-+手机号），id 仅作表内序号
router.post('/unlock-merchant', async (req, res) => {
    const { demand_id, merchant_id, amount, user_id } = req.body;
    // 接收方必须用当前登录用户 uid，不能写死 cus-1
    const userUid = (user_id && String(user_id).startsWith('cus-')) ? user_id : 'cus-1';
    const orderNo = await generateOrderNo('UL', 'unlock_order');

    try {
        await db.query('START TRANSACTION');

        const [merchantRows] = await db.query(
            'SELECT uid, merchant_name FROM merchant WHERE uid = ?',
            [merchant_id]
        );
        if (!merchantRows || merchantRows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(400).json({ code: 400, error: '商家不存在' });
        }
        const merchant = merchantRows[0];
        const merchantUid = merchant.uid;
        const merchantName = merchant.merchant_name || '商家';

        const unlockSql = `INSERT INTO unlock_order (order_no, user_id, merchant_id, demand_id, amount, status, create_time) VALUES (?, ?, ?, ?, ?, 1, NOW())`;
        await db.query(unlockSql, [orderNo, userUid, merchantUid, demand_id, amount]);

        await db.query('UPDATE merchant SET balance = balance + ? WHERE uid = ?', [amount, merchantUid]);
        const [rows] = await db.query('SELECT balance FROM merchant WHERE uid = ?', [merchantUid]);
        const currentBalance = rows && rows[0] ? rows[0].balance : 0;
        const walletLogSql = `INSERT INTO merchant_wallet (merchant_id, balance, order_no, change_amount, type) VALUES (?, ?, ?, ?, 'unlock')`;
        await db.query(walletLogSql, [merchantUid, currentBalance, orderNo, amount]);

        const platformSql = `INSERT INTO platform_wallet (order_no, user_id, merchant_id, total_amount, amount, type, create_time) VALUES (?, ?, ?, ?, 0, 'unlock', NOW())`;
        await db.query(platformSql, [orderNo, userUid, merchantUid, amount]);

        // session_id 含义：一次“解锁会话”的唯一标识 = demand_id_merchant_uid，方便前后端按会话拉取消息
        const sessionId = `${demand_id}_${merchantUid}`;
        const welcomeMsg = `您好！我是【${merchantName}】的专属顾问，已收到您的诊断需求，很高兴为您服务。`;
        await db.query(
            `INSERT INTO messages (session_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)`,
            [sessionId, merchantUid, userUid, welcomeMsg]
        );

        await db.query('COMMIT');
        res.json({ code: 200, msg: '解锁成功', order_no: orderNo });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error("解锁过程报错:", err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 2. 模拟发起主订单（user_id / merchant_id 均为 uid）
router.post('/create-main', async (req, res) => {
    const { merchant_id, demand_id, amount } = req.body;
    const userUid = req.body.user_id || 'cus-1';

    try {
        const [existing] = await db.query(
            'SELECT id FROM main_order WHERE user_id = ? AND merchant_id = ? AND status < 4',
            [userUid, merchant_id]
        );
        if (existing && existing.length > 0) {
            return res.json({ code: 200, msg: '检测到已有进行中的订单，正在为您跳转...', order_id: existing[0].id });
        }

        const orderNo = await generateOrderNo('MAIN', 'main_order');
        const sql = `
            INSERT INTO main_order (order_no, user_id, merchant_id, demand_id, total_amount, paid_amount, status, current_step, create_time)
            VALUES (?, ?, ?, ?, ?, ?, 1, 1, NOW())
        `;
        const [result] = await db.query(sql, [orderNo, userUid, merchant_id, demand_id, amount, amount]);
        res.json({ code: 200, order_id: result.insertId, order_no: orderNo });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 3. 获取我的订单列表：含正式订单(main_order)与解锁咨询(unlock_order)，便于进入对话或查看进度
router.get('/my-list', async (req, res) => {
    const { user_id } = req.query;
    const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : 'cus-1';
    try {
        const [mainRows] = await db.query(
            `SELECT o.*, m.merchant_name, m.logo
             FROM main_order o
             LEFT JOIN merchant m ON o.merchant_id = m.uid
             WHERE o.user_id = ?
             ORDER BY o.create_time DESC`,
            [userUid]
        );
        const [unlockRows] = await db.query(
            `SELECT u.id, u.order_no, u.demand_id, u.merchant_id, u.amount, u.create_time, m.merchant_name, m.logo
             FROM unlock_order u
             LEFT JOIN merchant m ON u.merchant_id = m.uid
             WHERE TRIM(u.user_id) = ?
             ORDER BY u.create_time DESC`,
            [userUid]
        );
        console.log('[my-list] req.query.user_id=', JSON.stringify(req.query.user_id), 'userUid=', JSON.stringify(userUid), 'mainCount=', (mainRows && mainRows.length) || 0, 'unlockCount=', (unlockRows && unlockRows.length) || 0);
        const mainList = (mainRows || []).map(r => ({ ...r, type: 'main', session_id: `${r.demand_id}_${r.merchant_id}` }));
        const unlockList = (unlockRows || []).map(r => ({
            id: r.id,
            order_no: r.order_no,
            demand_id: r.demand_id,
            merchant_id: r.merchant_id,
            merchant_name: r.merchant_name,
            logo: r.logo,
            amount: r.amount,
            create_time: r.create_time,
            type: 'unlock',
            session_id: `${r.demand_id}_${r.merchant_id}`
        }));
        const combined = [...mainList, ...unlockList].sort((a, b) => new Date(b.create_time) - new Date(a.create_time));
        res.json({ code: 200, data: combined });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 4. 更新进度并分佣结算
// 4. 更新进度并分佣结算
router.post('/update-step', async (req, res) => {
    const { order_id, step } = req.body;
    try {
        await db.query('START TRANSACTION');
        
        // 1. 更新订单状态
        await db.query('UPDATE `main_order` SET current_step = ? WHERE id = ?', [step, order_id]);

        // 2. 如果是完成阶段，执行分账
        if (Number(step) === 4) {
            const [orderRows] = await db.query('SELECT order_no, total_amount, merchant_id, user_id FROM `main_order` WHERE id = ?', [order_id]);
            
            if (orderRows.length > 0) {
                const { order_no, total_amount, merchant_id, user_id } = orderRows[0];
                
                // 计算抽成：商家 80%，平台 20%
                const merchantIncome = Math.floor(total_amount * 0.8);
                const platformIncome = total_amount - merchantIncome;

                // A. 给商家加钱并记流水（merchant_id 存 uid）
                await db.query('UPDATE merchant SET balance = balance + ? WHERE uid = ?', [merchantIncome, merchant_id]);
                await db.query(`INSERT INTO merchant_wallet (merchant_id, order_no, change_amount, type) VALUES (?, ?, ?, 'commission')`,
                    [merchant_id, order_no, merchantIncome]);

                // B. 给管理端记明细：修正 SQL 占位符数量与类型
                const platformSql = `INSERT INTO platform_wallet 
                    (order_no, user_id, merchant_id, total_amount, amount, type, create_time) 
                    VALUES (?, ?, ?, ?, ?, 'commission', NOW())`;
                
                // 确保参数顺序：单号, 用户UID, 商家UID, 总价, 平台抽成
                await db.query(platformSql, [order_no, user_id, merchant_id, total_amount, platformIncome]);
            }
        }

        await db.query('COMMIT');
        res.json({ code: 200, msg: '进度同步并分佣成功' });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error("分佣失败:", err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 5. 获取订单实时进度详情（order_id 为 main_order 表的主键 id，仅作记录序号）
router.get('/progress', async (req, res) => {
    const { order_id } = req.query;
    try {
        const [rows] = await db.query('SELECT current_step FROM main_order WHERE id = ?', [order_id]);
        res.json({ code: 200, data: rows && rows[0] ? rows[0] : null });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;