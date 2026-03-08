// 统一钱包接口：顾客/商家/平台总余额均读 user.balance；明细：顾客/商家查 wallet_logs，平台查 platform_wallet
// 流水表 wallet_logs.change_amount 可正可负；扣款时须先校验 user.balance >= 扣款额，再写负流水并更新 user.balance，且保证 balance 不低于 0
const express = require('express');
const router = express.Router();
const db = require('../db');

// 获取钱包流水明细（用户/商家都用 uid 查）
router.get('/logs', async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ code: 400, msg: '缺少 uid' });
  try {
    const [rows] = await db.query(
      `SELECT id, uid, order_no, change_amount, type, create_time,
              change_amount / 100 AS amount_display
       FROM wallet_logs
       WHERE uid = ?
       ORDER BY create_time DESC`,
      [uid]
    );
    res.json({ code: 200, data: rows || [] });
  } catch (err) {
    console.error('[wallet/logs]', err);
    res.status(500).json({ code: 500, error: err.message });
  }
});

// 获取当前余额（分）：统一从 user.balance 读取（顾客/商家/平台均一致），总余额不低于 0
router.get('/balance', async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).json({ code: 400, msg: '缺少 uid' });
  try {
    const [rows] = await db.query(
      `SELECT COALESCE(balance, 0) AS balance FROM user WHERE uid = ?`,
      [uid]
    );
    const balance = rows && rows[0] ? Math.max(0, Number(rows[0].balance)) : 0;
    res.json({ code: 200, data: { balance } });
  } catch (err) {
    console.error('[wallet/balance]', err);
    res.status(500).json({ code: 500, error: err.message });
  }
});

// 提现：从零钱扣款，写负流水，type = 'withdraw'（默认为负值/扣款）
router.post('/withdraw', async (req, res) => {
  const { uid, amount } = req.body || {};
  if (!uid) return res.status(400).json({ code: 400, msg: '缺少 uid' });
  const amt = Math.abs(parseInt(amount, 10) || 0);
  if (amt <= 0) return res.status(400).json({ code: 400, msg: '提现金额须大于 0' });
  try {
    await db.query('START TRANSACTION');
    const [rows] = await db.query(
      'SELECT COALESCE(balance, 0) AS balance FROM user WHERE uid = ? FOR UPDATE',
      [uid]
    );
    if (!rows || !rows[0]) {
      await db.query('ROLLBACK');
      return res.status(400).json({ code: 400, msg: '用户不存在' });
    }
    const balance = Math.max(0, Number(rows[0].balance));
    if (balance < amt) {
      await db.query('ROLLBACK');
      return res.status(400).json({ code: 400, msg: '余额不足' });
    }
    await db.query('UPDATE user SET balance = balance - ? WHERE uid = ?', [amt, uid]);
    await db.query(
      'INSERT INTO wallet_logs (uid, order_no, change_amount, type, create_time) VALUES (?, NULL, ?, \'withdraw\', NOW())',
      [uid, -amt]
    );
    await db.query('COMMIT');
    res.json({ code: 200, msg: '提现成功', data: { amount: amt } });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('[wallet/withdraw]', err);
    res.status(500).json({ code: 500, error: err.message });
  }
});

module.exports = router;
