const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai');
const db = require('../db');

const PRODUCT_LINK_REGEX = /PRODUCT_LINK\s*[：:]\s*(\d+)/;
const PRODUCT_LINK_REPLACE = /\s*PRODUCT_LINK\s*[：:]\s*\d+\s*/g;

const BASE_URL = process.env.BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000';
function toFullImgUrl(imgUrl) {
    if (!imgUrl || typeof imgUrl !== 'string') return '';
    if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) return imgUrl;
    return BASE_URL.replace(/\/$/, '') + (imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl);
}

const openai = new OpenAI({
    apiKey: (process.env.DEEPSEEK_API_KEY || 'sk-41ea61f5f0c64c9fa277dda6f85c38bd').trim(),
    baseURL: 'https://api.deepseek.com'
});

// 发单需求收集说明（除龙宫自营外均追加到人设末尾）
const DEMAND_COLLECT_NOTE = `

【发单与需求收集】
在对话中请自然、灵活地了解用户需求，便于后续发单：如具体需求说明（做什么、目标国家/地区、时间等）、可选的城市、预算等，不必像问卷一样逐条盘问，可在解答过程中顺带询问。当您判断已掌握足够信息时，可告知用户「我可以帮您发单到广场，匹配方案与商家报价」；用户也可随时点击底部「发单」按钮。发单时，未在对话中提到的字段会记为「未说明」。若用户已完整说明需求，您可提示「需求已齐，可点击发单或由我为您发单」。`;

// 八大智能体人设（来自 PRD 完善版介绍文案）
const AGENT_PERSONAS = {
    visa: `你是普外国际签证智能体，专注于全球各国签证办理的全流程服务。你可提供精准的签证类型评估与材料清单生成；推送平台自营签证套餐（材料整理、翻译、递签、陪同，价格透明，专属顾问跟进保障出签率）；点击发单可匹配平台认证签证服务商，收到报价后可发起自动比价，你会汇总方案对比价格、服务、周期及风险点，助用户最优选择。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。` + DEMAND_COLLECT_NOTE,
    study: `你是普外国际留学智能体，提供从选校到入学的全程规划。可基于用户的 GPA、语言成绩、预算生成专属选校方案与申请 timeline；推送自营留学套餐（选校指导、文书撰写、网申辅导、签证办理、行前培训，海外名校导师团队保障申请成功率）；点击发单匹配认证留学服务商，支持 AI 自动比价，对比方案价格、服务深度、成功案例及潜在风险。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准推荐。` + DEMAND_COLLECT_NOTE,
    migration: `你是普外国际移民智能体，专注全球各国移民政策解读与方案规划。可提供精准的移民路径评估（技术/投资/雇主担保等）与可行性分析；推送自营移民套餐（资格评估、材料准备、申请递交、面试辅导、落地安家，资深移民律师团队保障合规性）；点击发单匹配认证移民服务商，AI 比价可汇总方案对比价格、周期、成功率及风险点。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。` + DEMAND_COLLECT_NOTE,
    enterprise: `你是普外国际企业出海智能体，为中国企业提供全球市场拓展一站式解决方案。可解读目标市场准入政策、搭建合规框架、提供本地化运营建议；推送自营企业出海套餐（市场调研、公司注册、税务筹划、人才引进、合规风控，跨境商务专家团队保障出海顺利）；点击发单匹配认证服务商，AI 比价对比方案价格、服务深度、行业经验及风险点。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。` + DEMAND_COLLECT_NOTE,
    life: `你是普外国际海外生活智能体，提供海外定居、生活服务全链路支持。可查询海外租房/购车/医疗/教育等生活服务信息并推荐方案；推送自营海外生活套餐（租房中介、接机、银行开户、医疗注册，本地生活团队保障生活无忧）；点击发单匹配认证服务商，AI 比价对比方案价格、响应速度、本地资源及风险点。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。` + DEMAND_COLLECT_NOTE,
    public_welfare: `你是普外国际公益活动智能体，连接全球公益资源与爱心人士。仅提供开场白与正常闲聊：可介绍全球公益项目信息、参与方式及 impact 评估；不涉及发单、AI 推荐报告、商家报价或方案对比。对话中我会在每次回复后为您推送当前公益活动自营卡片（全部 0 元），如需参与可点击查看。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。`,
    self_operated: `你是普外国际自营服务智能体，提供平台自营全品类跨境服务。可详细介绍自营服务、价格对比及保障条款，享受平台优先保障、售后无忧及专属客服支持的专属优惠；点击发单可匹配平台认证第三方服务商，收到报价后发起 AI 比价，对比自营与第三方的优劣势、风险点及保障条款。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。`,
    square: `你是普外国际发单广场智能体，提供高效的跨境服务发单与比价服务。支持一键发单，快速发布跨境服务需求并精准匹配平台认证服务商；基于需求标签自动筛选适配服务商推送；收到多家报价后可生成 AI 对比报告，同时对比所有服务商资质、口碑、服务内容及潜在风险，保障选择安全可靠。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。` + DEMAND_COLLECT_NOTE,
    // 与 survey category 对齐的别名
    estate_dubai: `你是普外国际迪拜房产/企业出海相关智能体，可提供迪拜房产、黄金签证及企业出海政策与方案。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。` + DEMAND_COLLECT_NOTE,
    estate_japan: `你是普外国际日本房产/海外生活相关智能体，可提供日本房产、经营管理签证及海外生活服务信息。回复时请使用简体中文，分点列出关键信息，每一点单独一行，用“1、2、3、”这样的编号，不要使用 Markdown 语法（例如 **加粗**、列表符号 - 等），注意留出空行方便阅读。必要时引导用户「填写需求问卷」以获取精准方案。` + DEMAND_COLLECT_NOTE
};

const AGENT_NAMES = {
    visa: '签证智能体',
    study: '留学智能体',
    migration: '移民智能体',
    enterprise: '企业出海智能体',
    life: '海外生活智能体',
    public_welfare: '公益活动智能体',
    self_operated: '自营服务智能体',
    square: '发单广场智能体',
    estate_dubai: '迪拜房产',
    estate_japan: '日本房产'
};

// 六大类（仅龙宫自营使用，不写死具体商品名，商品从库中读）
const SELF_OPERATED_CATEGORIES = [
    { num: 1, name: '证件服务', slug: 'visa' },
    { num: 2, name: '移民规划', slug: 'migration' },
    { num: 3, name: '留学申请', slug: 'study' },
    { num: 4, name: '企业出海', slug: 'enterprise' },
    { num: 5, name: '海外生活', slug: 'life' },
    { num: 6, name: '公益社群', slug: 'public' }
];
// DB 中 category 可能与 slug 不一致，统一映射到六大类
const CATEGORY_TO_MAJOR = { visa: '证件服务', migration: '移民规划', study: '留学申请', enterprise: '企业出海', estate: '企业出海', life: '海外生活', public: '公益社群', public_welfare: '公益社群' };

async function getSelfOperatedProducts() {
    try {
        const [rows] = await db.query('SELECT id, category, label FROM self_product WHERE status = 1 ORDER BY category, sort_order ASC, id ASC');
        return rows || [];
    } catch (e) {
        return [];
    }
}

function buildSelfOperatedSystemPrompt(products) {
    const byMajor = {};
    products.forEach((p) => {
        const major = CATEGORY_TO_MAJOR[p.category] || p.category;
        if (!byMajor[major]) byMajor[major] = [];
        byMajor[major].push({ id: p.id, label: p.label || '' });
    });
    const productListText = SELF_OPERATED_CATEGORIES.map((c) => {
        const items = byMajor[c.name] || [];
        return `${c.name}：${items.map((i) => `id=${i.id} 名称=${i.label}`).join('；') || '（暂无）'}`;
    }).join('\n');

    return `你是龙宫自营智能体，像一个真人顾问一样和用户聊天，而不是机械的菜单机器人。

【对话原则】
1) 怎么聊都可以：用户打招呼你就自然回应，用户闲聊、提问、吐槽都可以接话，语气亲切、简短、有人情味，不要每次只会说「请选择以下分类」。
2) 闲聊时的固定结尾：只要当前处于「闲聊」阶段（尚未开始向用户询问大小分类、也没有推送过产品卡片），你在每条回复的最后必须单独起一行，写一句引导句，且只能从下面两句中二选一，不要改字：
   「那您现在需要我向您介绍我们的自营产品吗？」
   或
   「您想了解什么方向的产品？」
   一旦用户开始选择六大类或细分、或你已经输出了 PRODUCT_LINK 推荐了商品，就视为进入「推荐流程」，此后不要再加上述引导句；改为正常询问产品是否满意、是否需要其他帮助，直到用户明确本单结束（如满意、暂不需要、下次再说等），本单结束后若用户继续闲聊，再恢复在回复末尾加上述引导句。
3) 推荐与出链：当用户明确或间接表达了某一类/某一项需求时，从【当前平台自营商品】中匹配，先按大类再按细分引导；用户选定具体项后，用一两句话推荐，并在回复末尾单独一行输出：PRODUCT_LINK:id（id 为对应商品 id），不要写其他占位符。

【六大类】（引导时按此顺序，不要写死具体商品名）
1. 证件服务
2. 移民规划
3. 留学申请
4. 企业出海
5. 海外生活
6. 公益社群

【当前平台自营商品】（仅用于匹配与输出 PRODUCT_LINK，勿在回复中写死 id）
${productListText}

回复使用简体中文，可分点也可自然段，不要使用 Markdown（不用 **、- 列表等）。`;
}

// 智能体对话：支持流式（stream: true 时 SSE）与非流式
router.post('/chat', async (req, res) => {
    const { agent_type, messages, stream: wantStream } = req.body || {};
    const type = agent_type || 'study';
    const isSelfOperated = type === 'self_operated';

    let systemContent = AGENT_PERSONAS[type] || AGENT_PERSONAS.study;
    if (isSelfOperated) {
        const products = await getSelfOperatedProducts();
        systemContent = buildSelfOperatedSystemPrompt(products);
    } else if (type !== 'public_welfare') {
        systemContent += '\n\n若用户需要精准方案或推荐，请明确建议其点击「填写需求问卷」，问卷完成后我会在对话中给出 AI 推荐报告与匹配商家。';
    }

    const chatMessages = Array.isArray(messages) && messages.length > 0
        ? messages
            .filter(m => m.role && (m.content != null && m.content !== '' || m.role === 'user'))
            .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content != null ? m.content : '') }))
        : [{ role: 'user', content: '你好' }];
    if (chatMessages.length === 0) chatMessages.push({ role: 'user', content: '你好' });

    // 流式：后端调用 DeepSeek stream，以 SSE 推给前端
    if (wantStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders && res.flushHeaders();
        let fullContent = '';
        try {
            const stream = await openai.chat.completions.create({
                model: 'deepseek-chat',
                messages: [{ role: 'system', content: systemContent }, ...chatMessages],
                max_tokens: 1024,
                temperature: 0.7,
                stream: true
            });
            for await (const chunk of stream) {
                const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
                if (delta) {
                    fullContent += delta;
                    res.write('data: ' + JSON.stringify({ content: delta }) + '\n\n');
                    if (res.flush) res.flush();
                }
            }
            let reply = fullContent || '抱歉，我暂时无法回复，请稍后再试。';
            let product = null;
            const productLinkMatch = reply.match(PRODUCT_LINK_REGEX);
            if (productLinkMatch && isSelfOperated) {
                const productId = parseInt(productLinkMatch[1], 10);
                try {
                    const [rows] = await db.query('SELECT id, category, label, price, img_url FROM self_product WHERE status = 1 AND id = ?', [productId]);
                    if (rows && rows[0]) {
                        const r = rows[0];
                        product = { id: r.id, label: r.label, category: r.category, price: r.price, img_url: toFullImgUrl(r.img_url) };
                        reply = reply.replace(PRODUCT_LINK_REPLACE, '').trim();
                        if (reply && !reply.endsWith('。') && !reply.endsWith('：')) reply += '。';
                        if (reply) reply += '\n\n点击下方卡片查看详情。';
                    }
                } catch (e) {}
            }
            if (!product && isSelfOperated && chatMessages.length > 0) {
                const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
                const text = (lastUser && lastUser.content) ? String(lastUser.content).trim() : '';
                if (text) {
                    try {
                        const [rows] = await db.query('SELECT id, category, label, price, img_url FROM self_product WHERE status = 1');
                        const list = rows || [];
                        const match = list.find((p) => p.label && (text.includes(p.label) || p.label.includes(text)));
                        if (match) {
                            product = { id: match.id, label: match.label, category: match.category, price: match.price, img_url: toFullImgUrl(match.img_url) };
                            reply = reply.replace(PRODUCT_LINK_REPLACE, '').trim();
                            if (reply && !reply.endsWith('。') && !reply.endsWith('：')) reply += '。';
                            if (reply) reply += '\n\n点击下方卡片查看详情。';
                        }
                    } catch (e) {}
                }
            }
            res.write('data: ' + JSON.stringify({ done: true, reply, product }) + '\n\n');
        } catch (err) {
            console.error('Agent chat stream error:', err.message);
            const msg = (err.status === 401) ? 'DeepSeek API Key 无效或已过期' : (err.message || '智能体回复失败');
            res.write('data: ' + JSON.stringify({ done: true, error: msg, reply: '抱歉，我暂时无法回复，请稍后再试。' }) + '\n\n');
        }
        res.end();
        return;
    }

    // 非流式：一次性返回
    try {
        const completion = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: systemContent }, ...chatMessages],
            max_tokens: 1024,
            temperature: 0.7
        });

        let reply = completion.choices[0] && completion.choices[0].message
            ? completion.choices[0].message.content
            : '抱歉，我暂时无法回复，请稍后再试。';

        let product = null;
        const productLinkMatch = reply.match(PRODUCT_LINK_REGEX);
        if (productLinkMatch && isSelfOperated) {
            const productId = parseInt(productLinkMatch[1], 10);
            try {
                const [rows] = await db.query('SELECT id, category, label, price, img_url FROM self_product WHERE status = 1 AND id = ?', [productId]);
                if (rows && rows[0]) {
                    const r = rows[0];
                    product = { id: r.id, label: r.label, category: r.category, price: r.price, img_url: toFullImgUrl(r.img_url) };
                    reply = reply.replace(PRODUCT_LINK_REPLACE, '').trim();
                    if (reply && !reply.endsWith('。') && !reply.endsWith('：')) reply += '。';
                    if (reply) reply += '\n\n点击下方卡片查看详情。';
                }
            } catch (e) {}
        }
        if (!product && isSelfOperated && chatMessages.length > 0) {
            const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
            const text = (lastUser && lastUser.content) ? String(lastUser.content).trim() : '';
            if (text) {
                try {
                    const [rows] = await db.query('SELECT id, category, label, price, img_url FROM self_product WHERE status = 1');
                    const list = rows || [];
                    const match = list.find((p) => p.label && (text.includes(p.label) || p.label.includes(text)));
                    if (match) {
                        product = { id: match.id, label: match.label, category: match.category, price: match.price, img_url: toFullImgUrl(match.img_url) };
                        reply = reply.replace(PRODUCT_LINK_REPLACE, '').trim();
                        if (reply && !reply.endsWith('。') && !reply.endsWith('：')) reply += '。';
                        if (reply) reply += '\n\n点击下方卡片查看详情。';
                    }
                } catch (e) {}
            }
        }

        res.json({ code: 200, data: product ? { reply, product } : { reply } });
    } catch (err) {
        console.error('Agent chat error:', err.message);
        const msg = (err.status === 401) ? 'DeepSeek API Key 无效或已过期，请更换' : '智能体回复失败，请稍后再试';
        res.status(500).json({ code: 500, error: msg });
    }
});

// 获取智能体展示信息（名称、描述）供前端标题用
router.get('/info', (req, res) => {
    const { agent_type } = req.query;
    const type = agent_type || 'study';
    res.json({
        code: 200,
        data: {
            name: AGENT_NAMES[type] || '智能体',
            desc: '普外国际'
        }
    });
});

/**
 * 供 WebSocket 使用的流式调用：按 chunk 回调，结束时 onDone(reply, product, error)
 */
async function runAgentStream(agent_type, messages, onChunk, onDone) {
    const type = agent_type || 'study';
    const isSelfOperated = type === 'self_operated';
    let systemContent = AGENT_PERSONAS[type] || AGENT_PERSONAS.study;
    if (isSelfOperated) {
        const products = await getSelfOperatedProducts();
        systemContent = buildSelfOperatedSystemPrompt(products);
    } else if (type !== 'public_welfare') {
        systemContent += '\n\n若用户需要精准方案或推荐，请明确建议其点击「填写需求问卷」，问卷完成后我会在对话中给出 AI 推荐报告与匹配商家。';
    }
    const chatMessages = Array.isArray(messages) && messages.length > 0
        ? messages
            .filter(m => m.role && (m.content != null && m.content !== '' || m.role === 'user'))
            .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: String(m.content != null ? m.content : '') }))
        : [{ role: 'user', content: '你好' }];
    if (chatMessages.length === 0) chatMessages.push({ role: 'user', content: '你好' });

    let fullContent = '';
    try {
        const stream = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [{ role: 'system', content: systemContent }, ...chatMessages],
            max_tokens: 1024,
            temperature: 0.7,
            stream: true
        });
        for await (const chunk of stream) {
            const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
            if (delta) {
                fullContent += delta;
                if (onChunk) onChunk({ content: delta });
            }
        }
        let reply = fullContent || '抱歉，我暂时无法回复，请稍后再试。';
        let product = null;
        const productLinkMatch = reply.match(PRODUCT_LINK_REGEX);
        if (productLinkMatch && isSelfOperated) {
            const productId = parseInt(productLinkMatch[1], 10);
            try {
                const [rows] = await db.query('SELECT id, category, label, price, img_url FROM self_product WHERE status = 1 AND id = ?', [productId]);
                if (rows && rows[0]) {
                    const r = rows[0];
                    product = { id: r.id, label: r.label, category: r.category, price: r.price, img_url: toFullImgUrl(r.img_url) };
                    reply = reply.replace(PRODUCT_LINK_REPLACE, '').trim();
                    if (reply && !reply.endsWith('。') && !reply.endsWith('：')) reply += '。';
                    if (reply) reply += '\n\n点击下方卡片查看详情。';
                }
            } catch (e) {}
        }
        if (!product && isSelfOperated && chatMessages.length > 0) {
            const lastUser = chatMessages.filter((m) => m.role === 'user').pop();
            const text = (lastUser && lastUser.content) ? String(lastUser.content).trim() : '';
            if (text) {
                try {
                    const [rows] = await db.query('SELECT id, category, label, price, img_url FROM self_product WHERE status = 1');
                    const list = rows || [];
                    const match = list.find((p) => p.label && (text.includes(p.label) || p.label.includes(text)));
                    if (match) {
                        product = { id: match.id, label: match.label, category: match.category, price: match.price, img_url: toFullImgUrl(match.img_url) };
                        reply = reply.replace(PRODUCT_LINK_REPLACE, '').trim();
                        if (reply && !reply.endsWith('。') && !reply.endsWith('：')) reply += '。';
                        if (reply) reply += '\n\n点击下方卡片查看详情。';
                    }
                } catch (e) {}
            }
        }
        if (onDone) onDone({ reply, product });
    } catch (err) {
        console.error('Agent stream error:', err.message);
        const msg = (err.status === 401) ? 'DeepSeek API Key 无效或已过期' : (err.message || '智能体回复失败');
        if (onDone) onDone({ reply: '抱歉，我暂时无法回复，请稍后再试。', product: null, error: msg });
    }
}

module.exports = router;
module.exports.runAgentStream = runAgentStream;
