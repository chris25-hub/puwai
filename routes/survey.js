const express = require('express');
const router = express.Router();
const db = require('../db');
const { OpenAI } = require('openai'); // 重新引入你习惯使用的 OpenAI 库

const openai = new OpenAI({
    apiKey: (process.env.DEEPSEEK_API_KEY || 'sk-41ea61f5f0c64c9fa277dda6f85c38bd').trim(),
    baseURL: 'https://api.deepseek.com'
});

// 1. 板块映射表：将前端传递的分类名转为数据库数字 ID
const categoryMap = {
    'study': 1,
    'visa': 2,
    'migration': 3,
    'estate_dubai': 4,
    'estate_japan': 5,
    'life': 6
};

// 【新增】各板块专业提示词配置
const promptContexts = {
    'study': '你是一个资深的留学专家，请重点分析申请人的背景、选校梯度和文书重点。',
    'migration': '你是一个专业的移民律师，请重点分析申请人的背景是否符合移民政策、资金来源解释难度及项目风险。',
    'estate_dubai': '你是一个迪拜房产投资顾问，请分析该区域的租金回报率(ROI)、周边配套及黄金签证办理条件。',
    'estate_japan': '你是一个日本房产投资顾问，请分析该地段的增值潜力、管理费税费成本及经营管理签证要求。',
    'visa': '你是一个签证专家，请评估材料完整度、出签率及面签核心注意事项。',
    'life': '你是一个海外生活服务管家，请评估用户需求的可行性并给出落地建议。'
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

// 2. 提交问卷接口：恢复 DeepSeek 实时诊断逻辑
// 2. 提交问卷接口：升级 AI 诊断逻辑
router.post('/submit', async (req, res) => {
    const { category, answers } = req.body || {};
    if (!category || !Array.isArray(answers)) {
        return res.status(400).json({ code: 400, error: '缺少 category 或 answers' });
    }
    const categoryId = categoryMap[category] || 1;
    const answersStr = answers.length ? answers.join(', ') : '未填写';

    try {
        const businessPrompt = promptContexts[category] || "你是一个专业的海外诊断助手。";

        const completion = await openai.chat.completions.create({
            model: "deepseek-chat",
            messages: [
                {
                    role: "system",
                    content: `${businessPrompt} 请根据用户的需求标签，输出包含 recommendation, reason, risk 三个字段的 JSON 对象。要求：recommendation、reason、risk 三个字段的正文内容必须全部使用中文撰写，面向中国客户。注意：严禁输出任何非 JSON 文字。`
                },
                {
                    role: "user",
                    content: `用户当前板块：${category}，需求标签：${answersStr}`
                }
            ],
            response_format: { type: 'json_object' }
        });

        const aiContent = JSON.parse(completion.choices[0].message.content);
        
        const sql = `
            INSERT INTO \`demand\` (user_id, category, tags, ai_recommendation, status, create_time) 
            VALUES (1, ?, ?, ?, 0, NOW())
        `;
        
        const [result] = await db.query(sql, [
            categoryId,             
            JSON.stringify(answers), 
            JSON.stringify(aiContent) 
        ]);
        
        res.json({ code: 200, demand_id: result.insertId });

    } catch (err) {
        console.error("[survey/submit]", err.message);
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