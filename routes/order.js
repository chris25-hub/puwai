const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateOrderNo } = require('../utils/tools'); // 1. 引入工具函数

// 1. 解锁商家接口：修复了 order_no 缺失和拼写错误
// routes/order.js

// 约定：业务上严格用 uid 匹配（mer-/cus-/rot-+手机号），id 仅作表内序号
router.post('/unlock-merchant', async (req, res) => {
    const { demand_id, merchant_id, amount, user_id } = req.body;
    const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : null;
    if (!userUid) return res.status(400).json({ code: 400, error: '缺少 user_id' });
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
        await db.query('UPDATE user SET balance = balance + ? WHERE uid = ?', [amount, merchantUid]);
        await db.query(`INSERT INTO wallet_logs (uid, order_no, change_amount, type) VALUES (?, ?, ?, 'unlock')`, [merchantUid, orderNo, amount]);

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

// 检查当前会话是否已解锁（是否有 unlock_order），供聊天页进入时判断是否不再弹窗
router.get('/check-unlocked', async (req, res) => {
    const { session_id, user_id } = req.query;
    const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : null;
    const sessionId = (session_id != null && String(session_id).trim() !== '') ? String(session_id).trim() : null;
    if (!userUid || !sessionId) return res.json({ code: 200, unlocked: false });
    const parts = sessionId.split('_');
    const demand_id = parts[0] || null;
    const merchant_id = parts[1] || null;
    if (!demand_id || !merchant_id) return res.json({ code: 200, unlocked: false });
    try {
        const [rows] = await db.query(
            'SELECT 1 FROM unlock_order WHERE user_id = ? AND demand_id = ? AND merchant_id = ? LIMIT 1',
            [userUid, demand_id, merchant_id]
        );
        res.json({ code: 200, unlocked: rows && rows.length > 0 });
    } catch (err) {
        res.json({ code: 200, unlocked: false });
    }
});

// 2. 模拟发起主订单（user_id / merchant_id 均为 uid）
router.post('/create-main', async (req, res) => {
    const { merchant_id, demand_id, amount } = req.body;
    const userUid = (req.body.user_id != null && String(req.body.user_id).trim() !== '') ? String(req.body.user_id).trim() : null;
    if (!userUid) return res.status(400).json({ code: 400, error: '缺少 user_id' });

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

// 2.1 用户在多家报价中选择其一，基于 quote 生成主订单
router.post('/create-from-quote', async (req, res) => {
    const { quote_id } = req.body || {};
    if (!quote_id) return res.status(400).json({ code: 400, error: '缺少 quote_id' });

    try {
        await db.query('START TRANSACTION');

        // 1. 读取报价与需求信息（demand_quote 已无 demand_id，用 demand_no 关联 demand）
        const [quoteRows] = await db.query(
            `SELECT q.*, d.id AS demand_id, d.user_id AS demand_user_id 
             FROM demand_quote q
             LEFT JOIN demand d ON q.demand_no = d.demand_no
             WHERE q.id = ? FOR UPDATE`,
            [quote_id]
        );
        if (!quoteRows || quoteRows.length === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ code: 404, error: '报价不存在' });
        }
        const quote = quoteRows[0];
        if (Number(quote.status) === 1) {
            await db.query('ROLLBACK');
            return res.status(400).json({ code: 400, error: '该报价已被其他选择' });
        }

        const rawUserId = quote.user_id || quote.demand_user_id;
        const userUid = rawUserId ? String(rawUserId).trim() : null;
        const merchantUid = quote.merchant_id;
        const demandId = quote.demand_id;
        const demandNo = quote.demand_no;
        const amount = quote.amount;

        if (!userUid || !merchantUid || !demandId || !amount) {
            await db.query('ROLLBACK');
            return res.status(400).json({ code: 400, error: '报价信息不完整，无法创建订单' });
        }

        // 2. 为该需求与商家创建主订单
        const orderNo = await generateOrderNo('MAIN', 'main_order');
        // status=0 待支付，用户支付后 confirm-paid 改为 1 进行中；商家 update-step step=4 时改为 2 已完成
        const sql = `
            INSERT INTO main_order (order_no, user_id, merchant_id, demand_id, total_amount, paid_amount, status, current_step, create_time)
            VALUES (?, ?, ?, ?, ?, 0, 0, 1, NOW())
        `;
        const [result] = await db.query(sql, [orderNo, userUid, merchantUid, demandId, amount]);

        // 3. 更新报价状态：选中的标记为 1，其它同商单的报价标记为 2（已拒绝），按 demand_no
        await db.query('UPDATE demand_quote SET status = 1 WHERE id = ?', [quote_id]);
        if (demandNo) {
            await db.query('UPDATE demand_quote SET status = 2 WHERE demand_no = ? AND id <> ?', [demandNo, quote_id]);
        }

        // 4. 将需求状态更新为“已选中方案”（这里约定 2 为已选中待支付，可按需要调整）
        await db.query('UPDATE demand SET status = 2 WHERE id = ?', [demandId]);

        await db.query('COMMIT');
        res.json({ code: 200, order_id: result.insertId, order_no: orderNo });
    } catch (err) {
        await db.query('ROLLBACK');
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 3. 获取我的订单列表：仅含 main_order、self_order、demand_quoting（订单管理不展示 unlock_order）
router.get('/my-list', async (req, res) => {
    const { user_id } = req.query;
    const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : null;
    if (!userUid) return res.status(400).json({ code: 400, error: '缺少 user_id' });
    try {
        const [mainRows] = await db.query(
            `SELECT o.*, m.merchant_name, m.logo, d.category_name
             FROM main_order o
             LEFT JOIN merchant m ON o.merchant_id = m.uid
             LEFT JOIN demand d ON o.demand_id = d.id
             WHERE o.user_id = ?
             ORDER BY o.create_time DESC`,
            [userUid]
        );
        let selfRows = [];
        try {
            const [sr] = await db.query(
                'SELECT id, order_no, user_id, product_id, product_label, total_amount, status, create_time FROM self_order WHERE user_id = ? ORDER BY create_time DESC',
                [userUid]
            );
            selfRows = sr || [];
        } catch (e) {}
        // 状态键 status_key：前端用 _statusKey 做筛选和 mapSenderStatus 展示。合法值：quoting|processing|done|cancel
        console.log('[my-list] userUid=', userUid, 'main=', (mainRows && mainRows.length) || 0, 'self=', selfRows.length);
        // main_order.status：0=待支付 1=进行中 2=已完成 3=已取消。只有 current_step=4 时才显示「已完成」
        const mainList = (mainRows || []).map(r => {
            const step = r.current_step != null ? Number(r.current_step) : 0;
            let statusKey = 'processing';
            if (r.status === 0) statusKey = 'quoting';
            else if (r.status === 1) statusKey = 'processing';
            else if (r.status === 2) statusKey = (step === 4 ? 'done' : 'processing'); // 仅进度到 4 才算已完成
            else if (r.status === 3) statusKey = 'cancel';
            return {
                ...r,
                type: 'main',
                is_self: false,
                session_id: `${r.demand_id}_${r.merchant_id}`,
                status_key: statusKey
            };
        });
        // 自营单 self_order.status：0待支付 1进行中 2已完成 3已取消 → 0 显示为报价中，与 main 对齐
        const selfList = (selfRows || []).map(r => ({
            ...r,
            type: 'self',
            is_self: true,
            category_name: r.product_label,
            status_key: r.status === 0 ? 'quoting' : r.status === 1 ? 'processing' : r.status === 2 ? 'done' : r.status === 3 ? 'cancel' : 'quoting'
        }));
        // 用户发了 demand 且尚未成单的，均展示为「报价中」（不要求已有商家报价，点进去可能暂无报价）
        let demandQuotingList = [];
        try {
            const [dqRows] = await db.query(`
                SELECT d.id AS demand_id, d.demand_no, d.category_name, d.create_time
                FROM demand d
                WHERE TRIM(d.user_id) = ?
                AND NOT EXISTS (SELECT 1 FROM main_order o WHERE o.demand_id = d.id AND TRIM(o.user_id) = ?)
                ORDER BY d.create_time DESC
            `, [userUid, userUid]);
            demandQuotingList = (dqRows || []).map(r => ({
                id: r.demand_id,
                demand_id: r.demand_id,
                demand_no: r.demand_no,
                category_name: r.category_name || null,
                create_time: r.create_time,
                type: 'demand_quoting',
                is_self: false,
                status_key: 'quoting',
                order_no: r.demand_no || null
            }));
        } catch (e) {}
        const combined = [...mainList, ...selfList, ...demandQuotingList].sort((a, b) => new Date(b.create_time) - new Date(a.create_time));
        res.json({ code: 200, data: combined });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 3.1 创建平台自营订单（用户支付自营商品后调用，状态直接为「进行中」）。pay_channel: wechat/alipay/wallet/mock
router.post('/create-self-order', async (req, res) => {
    const { user_id, product_id, product_label, total_amount, pay_channel } = req.body || {};
    const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : null;
    if (!userUid || !product_id) {
        return res.status(400).json({ code: 400, error: '缺少 user_id 或 product_id' });
    }
    const amount = Math.abs(parseInt(total_amount, 10) || 0);
    const label = (product_label && String(product_label).trim()) || '自营服务';
    const channel = (pay_channel && String(pay_channel).trim()) || 'mock';
    try {
        const orderNo = await generateOrderNo('SO', 'self_order');
        if (channel === 'wallet') {
            await db.query('START TRANSACTION');
            const [rows] = await db.query(
                'SELECT COALESCE(balance, 0) AS balance FROM user WHERE uid = ? FOR UPDATE',
                [userUid]
            );
            if (!rows || !rows[0]) {
                await db.query('ROLLBACK');
                return res.status(400).json({ code: 400, error: '用户不存在' });
            }
            const balance = Math.max(0, Number(rows[0].balance));
            if (balance < amount) {
                await db.query('ROLLBACK');
                return res.status(400).json({ code: 400, error: '余额不足' });
            }
            await db.query('UPDATE user SET balance = balance - ? WHERE uid = ?', [amount, userUid]);
            await db.query(
                'INSERT INTO wallet_logs (uid, order_no, change_amount, type, create_time) VALUES (?, ?, ?, \'wallet_pay\', NOW())',
                [userUid, orderNo, -amount]
            );
        }
        await db.query(
            'INSERT INTO self_order (order_no, user_id, product_id, product_label, total_amount, pay_channel, status, create_time) VALUES (?, ?, ?, ?, ?, ?, 1, NOW())',
            [orderNo, userUid, product_id, label, amount, channel]
        );
        if (channel === 'wallet') await db.query('COMMIT');
        res.json({ code: 200, msg: '自营订单已创建', order_no: orderNo });
    } catch (err) {
        if (channel === 'wallet') { try { await db.query('ROLLBACK'); } catch (_) {} }
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 4. 更新进度并分佣结算
// 3.2 用户支付完成：将 main_order 从「报价中」改为「进行中」。pay_channel=wallet 时扣用户余额并写 wallet_logs 负流水
router.post('/confirm-paid', async (req, res) => {
    const { order_no, pay_channel, user_id } = req.body || {};
    if (!order_no || String(order_no).trim() === '') {
        return res.status(400).json({ code: 400, error: '缺少 order_no' });
    }
    const orderNo = String(order_no).trim();
    const channel = (pay_channel && String(pay_channel).trim()) || '';

    try {
        if (channel === 'wallet') {
            const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : null;
            if (!userUid) return res.status(400).json({ code: 400, error: '钱包支付缺少 user_id' });

            await db.query('START TRANSACTION');

            const [orderRows] = await db.query(
                'SELECT user_id, total_amount, demand_id FROM main_order WHERE order_no = ? AND status = 0 FOR UPDATE',
                [orderNo]
            );
            if (!orderRows || orderRows.length === 0) {
                await db.query('ROLLBACK');
                return res.json({ code: 200, msg: '订单已支付或不存在', changed: false });
            }
            const { user_id: orderUserId, total_amount: amount, demand_id: demandId } = orderRows[0];
            if (orderUserId !== userUid) {
                await db.query('ROLLBACK');
                return res.status(403).json({ code: 403, error: '订单与当前用户不一致' });
            }
            const payAmount = Math.max(0, Number(amount) || 0);
            if (payAmount <= 0) {
                await db.query('ROLLBACK');
                return res.status(400).json({ code: 400, error: '订单金额异常' });
            }

            const [balanceRows] = await db.query(
                'SELECT COALESCE(balance, 0) AS balance FROM user WHERE uid = ? FOR UPDATE',
                [userUid]
            );
            if (!balanceRows || balanceRows.length === 0) {
                await db.query('ROLLBACK');
                return res.status(400).json({ code: 400, error: '用户不存在' });
            }
            const balance = Math.max(0, Number(balanceRows[0].balance));
            if (balance < payAmount) {
                await db.query('ROLLBACK');
                return res.status(400).json({ code: 400, error: '余额不足' });
            }

            await db.query('UPDATE user SET balance = balance - ? WHERE uid = ?', [payAmount, userUid]);
            await db.query(
                'INSERT INTO wallet_logs (uid, order_no, change_amount, type, create_time) VALUES (?, ?, ?, \'wallet_pay\', NOW())',
                [userUid, orderNo, -payAmount]
            );
            await db.query('UPDATE main_order SET status = 1 WHERE order_no = ? AND status = 0', [orderNo]);

            if (demandId != null) {
                const [dRows] = await db.query('SELECT demand_no FROM demand WHERE id = ?', [demandId]);
                if (dRows && dRows[0] && dRows[0].demand_no) {
                    const demandNo = dRows[0].demand_no;
                    await db.query('DELETE FROM demand_quote WHERE demand_no = ?', [demandNo]);
                    await db.query('DELETE FROM demand WHERE demand_no = ?', [demandNo]);
                }
            }
            await db.query('COMMIT');
            return res.json({ code: 200, msg: '已更新为进行中', changed: true });
        }

        // 非钱包支付（模拟/微信等）：仅更新状态并删需求
        const [result] = await db.query(
            'UPDATE main_order SET status = 1 WHERE order_no = ? AND status = 0',
            [orderNo]
        );
        if (result.affectedRows === 0) {
            return res.json({ code: 200, msg: '订单已支付或不存在', changed: false });
        }
        const [rows] = await db.query('SELECT demand_id FROM main_order WHERE order_no = ?', [orderNo]);
        if (rows && rows[0] && rows[0].demand_id != null) {
            const [dRows] = await db.query('SELECT demand_no FROM demand WHERE id = ?', [rows[0].demand_id]);
            if (dRows && dRows[0] && dRows[0].demand_no) {
                const demandNo = dRows[0].demand_no;
                await db.query('DELETE FROM demand_quote WHERE demand_no = ?', [demandNo]);
                await db.query('DELETE FROM demand WHERE demand_no = ?', [demandNo]);
            }
        }
        res.json({ code: 200, msg: '已更新为进行中', changed: true });
    } catch (err) {
        if (channel === 'wallet') try { await db.query('ROLLBACK'); } catch (_) {}
        console.error('[order] confirm-paid error:', err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 4. 更新进度并分佣结算
router.post('/update-step', async (req, res) => {
    const { order_id, step } = req.body;
    try {
        await db.query('START TRANSACTION');
        
        // 1. 更新订单进度；商家点「完成」时（step=4）同时把 status 设为 2（已完成）
        if (Number(step) === 4) {
            await db.query('UPDATE `main_order` SET current_step = ?, status = 2 WHERE id = ?', [step, order_id]);
        } else {
            await db.query('UPDATE `main_order` SET current_step = ? WHERE id = ?', [step, order_id]);
        }

        // 2. 如果是完成阶段，执行分账
        if (Number(step) === 4) {
            const [orderRows] = await db.query('SELECT order_no, total_amount, merchant_id, user_id FROM `main_order` WHERE id = ?', [order_id]);
            
            if (orderRows.length > 0) {
                const { order_no, total_amount, merchant_id, user_id } = orderRows[0];
                
                // 计算抽成：商家 80%，平台 20%
                const merchantIncome = Math.floor(total_amount * 0.8);
                const platformIncome = total_amount - merchantIncome;

                // A. 给商家加钱并记流水（wallet_logs + merchant.balance + user.balance 三处同步）
                await db.query('UPDATE merchant SET balance = balance + ? WHERE uid = ?', [merchantIncome, merchant_id]);
                await db.query('UPDATE user SET balance = balance + ? WHERE uid = ?', [merchantIncome, merchant_id]);
                await db.query(`INSERT INTO wallet_logs (uid, order_no, change_amount, type) VALUES (?, ?, ?, 'commission')`, [merchant_id, order_no, merchantIncome]);

                // B. 给管理端记明细并更新平台(rot)用户余额
                const platformSql = `INSERT INTO platform_wallet 
                    (order_no, user_id, merchant_id, total_amount, amount, type, create_time) 
                    VALUES (?, ?, ?, ?, ?, 'commission', NOW())`;
                await db.query(platformSql, [order_no, user_id, merchant_id, total_amount, platformIncome]);
                const [rotRows] = await db.query("SELECT uid FROM user WHERE uid LIKE 'rot-%' LIMIT 1");
                if (rotRows && rotRows.length > 0) {
                    await db.query('UPDATE user SET balance = balance + ? WHERE uid = ?', [platformIncome, rotRows[0].uid]);
                }
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

// 4.1 回撤进度：仅允许回退到「收材料」（current_step 最低为 1），当前为收材料时不可回退
router.post('/rollback-step', async (req, res) => {
    const { order_id } = req.body || {};
    const orderId = order_id != null ? Number(order_id) : null;
    if (!orderId) return res.status(400).json({ code: 400, error: '缺少 order_id' });
    try {
        const [rows] = await db.query('SELECT current_step FROM main_order WHERE id = ?', [orderId]);
        if (!rows || rows.length === 0) return res.status(404).json({ code: 404, error: '订单不存在' });
        const currentStep = Number(rows[0].current_step) || 1;
        if (currentStep <= 1) {
            return res.status(400).json({ code: 400, error: '当前状态不能回退' });
        }
        const prevStep = currentStep - 1;
        await db.query('UPDATE main_order SET current_step = ? WHERE id = ?', [prevStep, orderId]);
        res.json({ code: 200, msg: '已回退至' + (prevStep === 1 ? '收材料' : prevStep === 2 ? '审核中' : '递交中') });
    } catch (err) {
        console.error('[order] rollback-step error:', err.message);
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