const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateFromDemandContent } = require('../utils/aiRecommendation');
const { generateOrderNo } = require('../utils/tools');

// 1. 板块映射表：将前端传递的分类名转为数据库数字 ID
const categoryMap = {
    'study': 1,
    'visa': 2,
    'migration': 3,
    'estate_dubai': 4,
    'estate_japan': 5,
    'life': 6
};

// category 数字 ID -> 中文名称（写入 demand.category_name）
const categoryIdToName = {
    1: '留学',
    2: '签证',
    3: '移民',
    4: '迪拜房产',
    5: '日本房产',
    6: '海外生活'
};

// 智能体逐步发题：按 step 返回当前题（用于对话式问卷）
router.get('/next-question', async (req, res) => {
    const categoryName = req.query.category || 'study';
    const step = parseInt(req.query.step, 10) || 0;
    const categoryId = categoryMap[categoryName] || 1;

    try {
        const [rows] = await db.query(
            'SELECT id, question_text, options, sort FROM `survey_question` WHERE category = ? ORDER BY sort ASC',
            [categoryId]
        );
        const total = (rows && rows.length) || 0;
        if (step >= total) {
            return res.json({ code: 200, data: { done: true, total } });
        }
        const q = rows[step];
        let options = [];
        if (q.options) {
            try {
                options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
            } catch (e) {
                options = [];
            }
        }
        res.json({
            code: 200,
            data: {
                done: false,
                step,
                total,
                question: {
                    id: q.id,
                    title: q.question_text || q.questionText || '',
                    options
                }
            }
        });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 获取题目接口
router.get('/questions', async (req, res) => {
    // 获取前端传来的分类（如 study）并转为数字 1
    const categoryName = req.query.category || 'study';
    const categoryId = categoryMap[categoryName] || 1;

    try {
        // 匹配你截图中的 survey_question 表名及 category 字段
        const sql = 'SELECT * FROM `survey_question` WHERE category = ? ORDER BY sort ASC';
        // mysql2 的 query 返回 [rows, fields]，不能把整个返回值当 rows 用，否则前端会收到 [行数组, 列信息]
        const [rows] = await db.query(sql, [categoryId]);
        res.json({ code: 200, data: rows });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

// routes/survey.js

// 问卷提交：先写入 demand（detail = 问卷答案整合），再按 demand 内容统一生成 AI 建议（与智能体发单同源）
router.post('/submit', async (req, res) => {
    const { category, answers, user_id } = req.body || {};
    if (!category || !Array.isArray(answers)) {
        return res.status(400).json({ code: 400, error: '缺少 category 或 answers' });
    }
    const categoryId = categoryMap[category] || 1;
    const detail = answers.length ? answers.join('；') : '未填写';
    const category_name = categoryIdToName[categoryId] || '海外生活';
    const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : null;
    if (!userUid) return res.status(400).json({ code: 400, error: '缺少 user_id' });

    try {
        // 1) 先插入 demand，以「需求描述」形式写入问卷答案（detail），不写 ai_recommendation
        const demandNo = await generateOrderNo('DM', 'demand');
        const sql = `
            INSERT INTO \`demand\` (demand_no, user_id, category, category_name, detail, tags, status, create_time)
            VALUES (?, ?, ?, ?, ?, ?, 0, NOW())
        `;
        const [result] = await db.query(sql, [
            demandNo,
            userUid,
            categoryId,
            category_name,
            detail,
            JSON.stringify(answers)
        ]);
        const demandId = result.insertId;

        // 2) 根据 demand 整合后的内容（detail + category）统一生成 AI 建议
        const aiContent = await generateFromDemandContent(detail, categoryId);
        if (aiContent) {
            await db.query('UPDATE demand SET ai_recommendation = ? WHERE id = ?', [
                JSON.stringify(aiContent),
                demandId
            ]);
        }

        res.json({ code: 200, demand_id: demandId });
    } catch (err) {
        console.error('[survey/submit]', err.message);
        const msg = (err.status === 401) ? 'DeepSeek API Key 无效或已过期，请更换' : (err.message || '诊断生成失败，请稍后再试');
        res.status(500).json({ code: 500, error: msg });
    }
});

// --- 3. 获取诊断结果接口 (保持不变，确保解析 JSON) ---
router.get('/result', async (req, res) => {
    const { id } = req.query;
    try {
        const [demandRows] = await db.query('SELECT * FROM `demand` WHERE id = ?', [id]);
        if (!demandRows || demandRows.length === 0) return res.status(404).json({ code: 404, msg: '记录不存在' });

        let demand = demandRows[0];
        
        // 关键：将数据库存的字符串解析为 JSON 给前端模板渲染
        if (typeof demand.ai_recommendation === 'string') {
            demand.ai_recommendation = JSON.parse(demand.ai_recommendation);
        }

        const [merchantRows] = await db.query('SELECT * FROM `merchant` WHERE status = 1 LIMIT 5');

        res.json({
            code: 200,
            data: {
                ai_recommendation: demand.ai_recommendation,
                demand: demand,
                merchants: merchantRows || []
            }
        });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;