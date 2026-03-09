// routes/demand.js

const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateFromDemandContent } = require('../utils/aiRecommendation');
const { reverseGeocode } = require('../utils/geo');
const { generateOrderNo } = require('../utils/tools');

// 智能体类型 -> demand.category（1留学 2签证 3移民 4迪拜房产 5日本房产 6海外生活）
const AGENT_TYPE_TO_CATEGORY = {
    study: 1,
    visa: 2,
    migration: 3,
    estate_dubai: 4,
    estate_japan: 5,
    life: 6,
    enterprise: 6,
    public_welfare: 6,
    square: 6
};

// 智能体类型 -> 展示用大类名
const AGENT_TYPE_TO_CATEGORY_NAME = {
    study: '留学',
    visa: '签证',
    migration: '移民',
    estate_dubai: '迪拜房产',
    estate_japan: '日本房产',
    life: '海外生活',
    enterprise: '企业出海',
    public_welfare: '公益社群',
    square: '发单广场'
};

// 各大类下的小分类（供 AI 判断，与 coop/问卷 一致）
const SUBCATEGORIES_BY_AGENT = {
    study: ['本硕博申请', '中学留学', '研究生申请', '本科申请', '文书写作', '选校定位', '奖学金申请', '面试辅导', '行前指导'],
    visa: ['旅游签证办理', '商务签证办理', '探亲访友签证', '留学签证', '签证加急', '材料整理', '线上面签辅导', '签证续签'],
    migration: ['技术移民评估', '投资移民方案', '购房移民', '跨境税务筹划', '家庭资产配置', '移民后续服务'],
    enterprise: ['海外公司注册', '跨境合规', '商标与知识产权', '本地电商落地', '市场调研', '法务合规', '员工签证', '跨境物流方案', '税务筹划', '本地团队搭建'],
    life: ['海外租房买房', '换汇理财', '就医预约', '翻译陪同', '接送机', '子女入学', '社保福利', '生活顾问', '银行开户', '子女教育规划'],
    estate_dubai: ['迪拜房产咨询', '购房服务', '黄金签证', '租金回报分析'],
    estate_japan: ['日本房产咨询', '购房服务', '经营管理签证', '税费分析']
};

/**
 * 从对话消息中简单抽取文本：用户消息拼接为 detail
 */
function extractFromMessages(messages, agentType) {
    const userTexts = (messages || [])
        .filter((m) => m.role === 'user' && m.content && typeof m.content === 'string')
        .map((m) => m.content.trim())
        .filter(Boolean);
    const detail = userTexts.length > 0 ? userTexts.join('\n') : '未说明';
    const category = AGENT_TYPE_TO_CATEGORY[agentType] || 6;
    const category_name = AGENT_TYPE_TO_CATEGORY_NAME[agentType] || '海外生活';
    return {
        category,
        category_name,
        detail,
        city: null,
        budget: null,
        tags: null
    };
}

/**
 * 根据需求内容用 AI 判断小分类，返回「大类-小类」用于广场展示
 */
async function inferCategoryNameWithSub(agentType, detail, majorName) {
    const subs = SUBCATEGORIES_BY_AGENT[agentType];
    if (!subs || subs.length === 0) return majorName;
    const { OpenAI } = require('openai');
    const openai = new OpenAI({
        apiKey: (process.env.DEEPSEEK_API_KEY || '').trim(),
        baseURL: 'https://api.deepseek.com',
        timeout: 5000, // 增加 5 秒超时，防止 DeepSeek 响应慢导致云托管 102002 错误
        maxRetries: 1
    });
    try {
        const completion = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: `你只能从给定的小分类列表中选一个最贴切用户需求的，只输出该小分类名称，不要引号、不要编号、不要其他任何文字。`
                },
                {
                    role: 'user',
                    content: `小分类列表：${subs.join('、')}\n\n用户需求：\n${(detail || '').slice(0, 800)}`
                }
            ],
            max_tokens: 32
        });
        const text = (completion.choices[0].message.content || '').trim().replace(/^["']|["']$/g, '');
        const matched = subs.find((s) => s === text || text.includes(s));
        if (matched) return `${majorName}-${matched}`;
    } catch (e) {
        console.error('[demand] inferCategoryNameWithSub error:', e.message);
    }
    return majorName;
}

// 从智能体对话创建 demand（发单）：写入 demand 表并出现在广场
router.post('/create-from-agent', async (req, res) => {
    const { user_id, agent_type, messages, city: bodyCity, latitude, longitude } = req.body || {};
    if (!user_id || !agent_type) {
        return res.status(400).json({ code: 400, error: '缺少 user_id 或 agent_type' });
    }
    const extracted = extractFromMessages(messages || [], agent_type);
    const category = extracted.category;
    let category_name = extracted.category_name;
    let detail = extracted.detail;
    let city = bodyCity != null && String(bodyCity).trim() !== '' ? String(bodyCity).trim() : extracted.city;
    let budget = extracted.budget;
    const tags = extracted.tags;

    if (!detail || detail === '未说明') detail = '用户通过智能体发单，具体需求见对话记录。';

    let cents = null;
    if (budget != null && budget !== '' && budget !== '未说明') {
        const num = parseFloat(budget);
        if (!isNaN(num) && num > 0) cents = Math.round(num * 100);
    }
    const tagsStr = tags != null && typeof tags !== 'string' ? JSON.stringify(tags) : (tags || null);

    try {
        const demandNo = await generateOrderNo('DM', 'demand');
        const sql = `
            INSERT INTO demand (demand_no, user_id, category, category_name, detail, city, budget, tags, status, create_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NOW())
        `;
        const params = [
            demandNo,
            String(user_id).trim(),
            category,
            category_name, // 初始默认的大类名
            detail,
            city || null, // 初始传入的 city 或 null
            cents,
            tagsStr
        ];
        const [result] = await db.query(sql, params);
        const demandId = result.insertId;

        // 发单后根据 demand 整合的需求内容生成 AI 建议（同步执行，保证前端时序：发单 -> ai分析报告 -> 自营卡片）
        try {
            const aiContent = await generateFromDemandContent(detail, category);
            if (aiContent) {
                await db.query('UPDATE demand SET ai_recommendation = ? WHERE id = ?', [
                    JSON.stringify(aiContent),
                    demandId
                ]);
            }
        } catch (aiErr) {
            console.error('[demand] create-from-agent AI recommendation error:', aiErr.message);
        }

        // 快速响应前端，避免 102002 超时（仅地理位置和分类推断走异步）
        res.json({ code: 200, demand_id: demandId });

        // 以下耗时操作放入后台异步执行
        (async () => {
            try {
                let finalCategoryName = category_name;
                let finalCity = city;

                // 1. 异步：逆地理位置解析
                if (!finalCity && latitude != null && longitude != null) {
                    try {
                        const geoCity = await reverseGeocode(latitude, longitude);
                        if (geoCity) {
                            finalCity = geoCity;
                            console.log(`[demand async] 成功解析地理位置: demandId=${demandId}, city=${geoCity}`);
                        } else {
                            console.log(`[demand async] 地理位置解析为空: demandId=${demandId}`);
                        }
                    } catch (e) {
                        console.error('[demand async] reverseGeocode error:', e.message);
                    }
                }

                // 2. 异步：智能体判断小分类
                try {
                    finalCategoryName = await inferCategoryNameWithSub(agent_type, detail, category_name);
                    if (finalCategoryName !== category_name) {
                        console.log(`[demand async] 成功推断分类: demandId=${demandId}, category=${finalCategoryName}`);
                    }
                } catch (e) {
                    console.error('[demand async] inferCategory error:', e.message);
                }

                // 如果分类名称或城市有更新，则更新到数据库
                if (finalCategoryName !== category_name || finalCity !== city) {
                    await db.query('UPDATE demand SET category_name = ?, city = ? WHERE id = ?', [
                        finalCategoryName,
                        finalCity || null,
                        demandId
                    ]);
                    console.log(`[demand async] 已将新分类/城市更新至数据库: demandId=${demandId}`);
                }

            } catch (asyncErr) {
                console.error('[demand async] background task error:', asyncErr.message);
            }
        })();

    } catch (err) {
        console.error('[demand] create-from-agent error:', err.message);
        res.status(500).json({ code: 500, error: err.message });
    }
});

// 从前端获取经纬度逆地理位置
router.post('/reverse-geocode', async (req, res) => {
    const { latitude, longitude } = req.body || {};
    if (latitude == null || longitude == null) {
        return res.status(400).json({ code: 400, error: '缺少 latitude 或 longitude' });
    }
    try {
        const city = await reverseGeocode(latitude, longitude);
        res.json({ code: 200, city: city || null });
    } catch (e) {
        res.status(500).json({ code: 500, error: '解析失败' });
    }
});

// 广场发单：创建一条新的 demand 记录（广场/手动发单用）
// 约定：user_id 传入用户 uid（手机号）
router.post('/create-from-square', async (req, res) => {
    const { user_id, category, category_name, detail, city, budget } = req.body || {};

    if (!user_id || !category_name || !detail) {
        return res.status(400).json({ code: 400, error: '缺少 user_id / category_name / detail' });
    }

    const categoryMap = { study: 1, visa: 2, migration: 3, estate_dubai: 4, estate_japan: 5, life: 6 };
    let catId = Number(category);
    if (!catId || isNaN(catId)) catId = categoryMap[category] || 6;

    let cents = null;
    if (budget != null && budget !== '') {
        const num = parseFloat(budget);
        if (!isNaN(num) && num > 0) cents = Math.round(num * 100);
    }

    try {
        const demandNo = await generateOrderNo('DM', 'demand');
        const sql = `
            INSERT INTO demand (demand_no, user_id, category, category_name, detail, city, budget, status, create_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, NOW())
        `;
        const params = [
            demandNo,
            String(user_id).trim(),
            catId,
            category_name,
            detail,
            city || null,
            cents
        ];
        const [result] = await db.query(sql, params);
        res.json({ code: 200, demand_id: result.insertId });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;
