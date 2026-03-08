const express = require('express');
const router = express.Router();
const db = require('../db');
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: (process.env.DEEPSEEK_API_KEY || 'sk-41ea61f5f0c64c9fa277dda6f85c38bd').trim(),
    baseURL: 'https://api.deepseek.com'
});

// 商家提交报价（或平台自营录入报价）
router.post('/merchant', async (req, res) => {
    const { demand_id, merchant_id, user_id, amount, summary, details, is_self_operated, valid_minutes } = req.body || {};

    if (!demand_id || !merchant_id || !amount) {
        return res.status(400).json({ code: 400, error: '缺少 demand_id / merchant_id / amount' });
    }

    try {
        // 1. 校验需求是否存在、仍可报价
        const [demandRows] = await db.query('SELECT id, user_id, status, demand_no FROM demand WHERE id = ?', [demand_id]);
        if (!demandRows || demandRows.length === 0) {
            return res.status(404).json({ code: 404, error: '需求不存在' });
        }
        const demand = demandRows[0];
        const demandNo = demand.demand_no || null;
        if (!demandNo) {
            return res.status(400).json({ code: 400, error: '该需求缺少商单编号，请先执行 demand-add-demand-no.sql 并回填' });
        }
        // 这里暂时只限制已经成单/关闭的需求不再接收报价；status 约定后续可细化
        if (demand.status != null && Number(demand.status) >= 3) {
            return res.status(400).json({ code: 400, error: '该需求已关闭或已成单，无法继续报价' });
        }

        const quoteUserId = user_id || demand.user_id || null;
        const isSelf = is_self_operated ? 1 : 0;
        const cents = Number(amount);
        if (!Number.isFinite(cents) || cents <= 0) {
            return res.status(400).json({ code: 400, error: 'amount 金额非法' });
        }

        let validUntil = null;
        if (valid_minutes && Number(valid_minutes) > 0) {
            validUntil = new Date(Date.now() + Number(valid_minutes) * 60 * 1000);
        }

        // 2. 同一商家对同一需求只保留一条最新报价：按 demand_no + merchant_id 查
        const [existRows] = await db.query(
            'SELECT id FROM demand_quote WHERE demand_no = ? AND merchant_id = ?',
            [demandNo, merchant_id]
        );

        if (existRows && existRows.length > 0) {
            const quoteId = existRows[0].id;
            await db.query(
                `UPDATE demand_quote 
                 SET amount = ?, summary = ?, details = ?, is_self_operated = ?, status = 0, valid_until = ?, demand_no = ? 
                 WHERE id = ?`,
                [cents, summary || null, details || null, isSelf, validUntil, demandNo, quoteId]
            );
        } else {
            await db.query(
                `INSERT INTO demand_quote 
                 (demand_no, user_id, merchant_id, is_self_operated, amount, currency, summary, details, status, valid_until) 
                 VALUES (?, ?, ?, ?, ?, 'CNY', ?, ?, 0, ?)`,
                [demandNo, quoteUserId, merchant_id, isSelf, cents, summary || null, details || null, validUntil]
            );
        }

        res.json({ code: 200, msg: '报价已提交' });
    } catch (err) {
        console.error('[quote] POST /merchant error:', err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 按需求查看所有报价（供 AI 分析 / 前端展示）；入参 demand_id 对应 demand.id，内部按 demand_no 查 demand_quote
router.get('/by-demand', async (req, res) => {
    const { demand_id } = req.query;
    if (!demand_id) return res.status(400).json({ code: 400, error: '缺少 demand_id' });

    try {
        const [dRows] = await db.query('SELECT demand_no FROM demand WHERE id = ?', [demand_id]);
        if (!dRows || !dRows[0] || !dRows[0].demand_no) {
            return res.json({ code: 200, data: [] });
        }
        const demandNo = dRows[0].demand_no;
        const [rows] = await db.query(
            `SELECT 
                q.id,
                q.demand_no,
                q.user_id,
                q.merchant_id,
                q.is_self_operated,
                q.amount,
                q.currency,
                q.summary,
                q.details,
                q.status,
                q.valid_until,
                q.create_time,
                q.update_time,
                m.merchant_name,
                m.service_tags,
                m.logo,
                m.rating,
                m.response_rate
             FROM demand_quote q
             LEFT JOIN merchant m ON q.merchant_id = m.uid
             WHERE q.demand_no = ?
             ORDER BY q.is_self_operated DESC, q.amount ASC, q.create_time ASC`,
            [demandNo]
        );

        res.json({ code: 200, data: rows || [] });
    } catch (err) {
        console.error('[quote] GET /by-demand error:', err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// AI 分析多个报价，给出推荐与排序
router.get('/ai-summary', async (req, res) => {
    const { demand_id } = req.query;
    if (!demand_id) return res.status(400).json({ code: 400, error: '缺少 demand_id' });

    try {
        // 1. 取需求基本信息
        const [demandRows] = await db.query('SELECT id, category, tags, ai_recommendation FROM demand WHERE id = ?', [demand_id]);
        if (!demandRows || demandRows.length === 0) {
            return res.status(404).json({ code: 404, error: '需求不存在' });
        }
        const demand = demandRows[0];

        // 2. 取所有报价 + 商家信息（按 demand_no 查 demand_quote）
        const [dnRows] = await db.query('SELECT demand_no FROM demand WHERE id = ?', [demand_id]);
        const demandNoForQuotes = (dnRows && dnRows[0] && dnRows[0].demand_no) ? dnRows[0].demand_no : null;
        if (!demandNoForQuotes) {
            return res.status(404).json({ code: 404, error: '需求不存在' });
        }
        const [quoteRows] = await db.query(
            `SELECT 
                q.id,
                q.amount,
                q.is_self_operated,
                q.summary,
                q.details,
                q.status,
                m.merchant_name,
                m.service_tags,
                m.rating,
                m.response_rate
             FROM demand_quote q
             LEFT JOIN merchant m ON q.merchant_id = m.uid
             WHERE q.demand_no = ?
             ORDER BY q.is_self_operated DESC, q.amount ASC, q.create_time ASC`,
            [demandNoForQuotes]
        );

        if (!quoteRows || quoteRows.length === 0) {
            return res.status(400).json({ code: 400, error: '当前暂无报价，无法分析' });
        }

        const tagsArray = (() => {
            try {
                return typeof demand.tags === 'string' ? JSON.parse(demand.tags) : (demand.tags || []);
            } catch (_) { return []; }
        })();

        const quotesForLLM = quoteRows.map(q => ({
            id: q.id,
            price: q.amount / 100,
            is_self_operated: !!q.is_self_operated,
            summary: q.summary || '',
            details: q.details || '',
            merchant_name: q.merchant_name || '',
            service_tags: q.service_tags || '',
            rating: q.rating ?? null,
            response_rate: q.response_rate ?? null
        }));

        const systemPrompt = `
你是普外国际平台的智能比价助手，帮助用户在多个服务方案中做出决策。
请严格按照以下 JSON 结构返回，不要输出任何额外文字：
{
  "recommended_quote_id": 123,       // 推荐首选方案的 quote id
  "reason": "为什么推荐这个方案，面向普通用户，用中文说明",
  "risk": "选择该方案的注意事项和潜在风险，避免夸大收益",
  "ranking": [123, 456, 789]         // 按推荐优先级排序的 quote id 数组，长度等于报价数量
}
`;

        const userPrompt = `
用户需求信息：
- 需求ID: ${demand.id}
- 需求标签: ${tagsArray.join(' / ')}

报价列表（单位：人民币元）：
${quotesForLLM.map(q => (
`- 报价ID: ${q.id}
  价格: ${q.price}
  是否平台自营: ${q.is_self_operated ? '是' : '否'}
  商家名称: ${q.merchant_name}
  商家标签: ${q.service_tags}
  商家评分: ${q.rating ?? '-'}
  响应率: ${q.response_rate ?? '-'}%
  报价摘要: ${q.summary}
  详细说明: ${q.details}`
        )).join('\n\n')}
`;

        const completion = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' }
        });

        const aiContent = JSON.parse(completion.choices[0].message.content);

        res.json({
            code: 200,
            data: {
                ai_summary: aiContent,
                quotes: quoteRows
            }
        });
    } catch (err) {
        console.error('[quote] GET /ai-summary error:', err.message);
        const msg = (err.status === 401) ? 'DeepSeek API Key 无效或已过期，请更换' : (err.message || 'AI 分析失败');
        res.status(500).json({ code: 500, error: msg });
    }
});

module.exports = router;

