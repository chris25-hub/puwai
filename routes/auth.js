const express = require('express');
const router = express.Router();
const db = require('../db');




// routes/auth.js 完整修复版

router.post('/register-login', async (req, res) => {
    const { phone, role, code, nickname, avatar_url } = req.body;

    if (code !== '123456') return res.json({ code: 400, msg: '验证码错误' });

    if (role === 'admin') {
        const [adminRows] = await db.query('SELECT * FROM user WHERE phone = ? AND role = "admin"', [phone]);
        if (!adminRows || adminRows.length === 0) {
            return res.json({ code: 403, msg: '非法操作：该账号无管理权限' });
        }
    }

    const prefix = role === 'merchant' ? 'mer-' : (role === 'admin' ? 'rot-' : 'cus-');
    const uid = `${prefix}${phone}`;

    try {
        // mysql2 query 返回 [rows, fields]，必须解构
        const [existing] = await db.query('SELECT * FROM user WHERE phone = ? AND role = ?', [phone, role]);

        if (!existing || existing.length === 0) {
            // 首次登录：写入 user 表（客户/商家/管理员都会有一条身份记录）
            await db.query(
                'INSERT INTO user (uid, phone, role, nickname, avatar_url, create_time) VALUES (?, ?, ?, ?, ?, NOW())',
                [uid, phone, role, nickname || null, avatar_url || null]
            );

            // 商家：仅当 merchant 表还没有该 uid 时才插入；必填字段 merchant_name 用占位值，入驻后再更新
            if (role === 'merchant') {
                const [merchantRows] = await db.query('SELECT uid FROM merchant WHERE uid = ?', [uid]);
                if (!merchantRows || merchantRows.length === 0) {
                    await db.query(
                        'INSERT INTO merchant (uid, merchant_name, status, create_time) VALUES (?, ?, 4, NOW())',
                        [uid, '待完善']
                    );
                }
            }
        } else {
            // 老用户：若有传 nickname/avatar_url（如微信拉取）则更新
            if (nickname != null || avatar_url != null) {
                await db.query(
                    'UPDATE user SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url), update_time = NOW() WHERE uid = ?',
                    [nickname || null, avatar_url || null, uid]
                );
            }
        }

        res.json({
            code: 200,
            data: { uid, role },
            msg: (existing && existing.length > 0) ? '登录成功' : '注册成功'
        });
    } catch (err) {
        console.error('登录接口错误:', err);
        res.status(500).json({ code: 500, error: '服务器内部错误' });
    }
});

module.exports = router;