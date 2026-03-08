const express = require('express');
const router = express.Router();
const db = require('../db');




// routes/auth.js 完整修复版

// 登录/注册：uid 仅存手机号，不再使用 cus-/mer- 前缀。同一手机号唯一一条 user 记录，角色由 role 字段区分。
router.post('/register-login', async (req, res) => {
    const { phone, role: bodyRole, code, nickname, avatar_url } = req.body;

    if (code !== '123456') return res.json({ code: 400, msg: '验证码错误' });
    const phoneStr = String(phone || '').trim();
    if (!phoneStr) return res.json({ code: 400, msg: '手机号不能为空' });

    try {
        // 按手机号查唯一用户（不再按 phone+role 区分）
        const [existing] = await db.query('SELECT uid, role FROM user WHERE phone = ? LIMIT 1', [phoneStr]);

        if (existing && existing.length > 0) {
            const row = existing[0];
            const uid = row.uid;
            const role = row.role;
            // 管理员入口：仅允许已存在的 admin 账号
            if (bodyRole === 'admin') {
                if (role !== 'admin') {
                    return res.json({ code: 403, msg: '非法操作：该账号无管理权限' });
                }
            }
            if (nickname != null || avatar_url != null) {
                await db.query(
                    'UPDATE user SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url), update_time = NOW() WHERE uid = ?',
                    [nickname || null, avatar_url || null, uid]
                );
            }
            return res.json({
                code: 200,
                data: { uid, role },
                msg: '登录成功'
            });
        }

        // 新用户：仅创建一条记录，角色固定为 customer；商家身份在「商家入驻并审核通过」后升级为 merchant
        if (bodyRole === 'admin') {
            return res.json({ code: 403, msg: '非法操作：该账号无管理权限' });
        }
        await db.query(
            'INSERT INTO user (uid, phone, role, nickname, avatar_url, create_time) VALUES (?, ?, ?, ?, ?, NOW())',
            [phoneStr, phoneStr, 'customer', nickname || null, avatar_url || null]
        );

        res.json({
            code: 200,
            data: { uid: phoneStr, role: 'customer' },
            msg: '注册成功'
        });
    } catch (err) {
        console.error('登录接口错误:', err);
        res.status(500).json({ code: 500, error: '服务器内部错误' });
    }
});

// 获取当前用户资料（昵称、头像、角色），用于「我的」页展示及前端刷新 role
router.get('/profile', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ code: 400, msg: '缺少 uid' });
    try {
        const [rows] = await db.query('SELECT nickname, avatar_url, role FROM user WHERE uid = ?', [uid]);
        if (!rows || rows.length === 0) {
            return res.json({ code: 200, data: { nickname: '', avatar_url: '', role: 'customer' } });
        }
        res.json({
            code: 200,
            data: {
                nickname: rows[0].nickname || '',
                avatar_url: rows[0].avatar_url || '',
                role: rows[0].role || 'customer'
            }
        });
    } catch (err) {
        console.error('获取用户资料错误:', err);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 更新用户头像（写入 user.avatar_url）
router.post('/update-avatar', async (req, res) => {
    const { uid, avatar_url } = req.body;
    if (!uid || !avatar_url) return res.status(400).json({ code: 400, msg: '缺少 uid 或 avatar_url' });
    try {
        const [result] = await db.query('UPDATE user SET avatar_url = ?, update_time = NOW() WHERE uid = ?', [avatar_url.trim(), uid]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ code: 404, msg: '用户不存在' });
        }
        res.json({ code: 200, msg: '头像已更新', data: { avatar_url: avatar_url.trim() } });
    } catch (err) {
        console.error('更新头像错误:', err);
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;