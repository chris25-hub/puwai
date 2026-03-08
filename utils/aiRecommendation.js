/**
 * 根据 demand 整合后的需求内容（detail + category）生成 AI 建议（recommendation / reason / risk）
 * 供：智能体发单 create-from-agent、调查问卷 submit 等统一使用
 */
const { OpenAI } = require('openai');

const openai = new OpenAI({
    apiKey: (process.env.DEEPSEEK_API_KEY || '').trim() || 'sk-41ea61f5f0c64c9fa277dda6f85c38bd',
    baseURL: 'https://api.deepseek.com'
});

// category 数字 1-6 -> 分类名（与问卷/智能体一致）
const CATEGORY_ID_TO_NAME = { 1: 'study', 2: 'visa', 3: 'migration', 4: 'estate_dubai', 5: 'estate_japan', 6: 'life' };
const AI_PROMPT_BY_CATEGORY = {
    study: '你是一个资深的留学专家，请重点分析申请人的背景、选校梯度和文书重点。',
    visa: '你是一个签证专家，请评估材料完整度、出签率及面签核心注意事项。',
    migration: '你是一个专业的移民律师，请重点分析申请人的背景是否符合移民政策、资金来源解释难度及项目风险。',
    estate_dubai: '你是一个迪拜房产投资顾问，请分析该区域的租金回报率(ROI)、周边配套及黄金签证办理条件。',
    estate_japan: '你是一个日本房产投资顾问，请分析该地段的增值潜力、管理费税费成本及经营管理签证要求。',
    life: '你是一个海外生活服务管家，请评估用户需求的可行性并给出落地建议。'
};

/**
 * 根据需求描述和分类生成 AI 建议
 * @param {string} detail - 需求描述（来自 demand.detail，如智能体整合的对话或问卷答案整合）
 * @param {number} categoryId - demand.category 1-6
 * @returns {Promise<{ recommendation?: string, reason?: string, risk?: string } | null>}
 */
async function generateFromDemandContent(detail, categoryId) {
    const categoryName = CATEGORY_ID_TO_NAME[categoryId] || 'life';
    const businessPrompt = AI_PROMPT_BY_CATEGORY[categoryName] || AI_PROMPT_BY_CATEGORY.life;
    const content = (detail && String(detail).trim()) ? detail.trim() : '用户未填写具体需求。';
    try {
        const completion = await openai.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: `${businessPrompt} 请根据用户的需求描述，输出包含 recommendation、reason、risk 三个字段的 JSON 对象。要求：三个字段的正文必须全部使用中文。严禁输出任何非 JSON 文字。`
                },
                { role: 'user', content: `用户需求描述：${content}` }
            ],
            response_format: { type: 'json_object' }
        });
        const aiContent = JSON.parse(completion.choices[0].message.content || '{}');
        if (aiContent && (aiContent.recommendation != null || aiContent.reason != null || aiContent.risk != null)) {
            return aiContent;
        }
    } catch (err) {
        console.error('[aiRecommendation] generateFromDemandContent error:', err.message);
    }
    return null;
}

module.exports = { generateFromDemandContent };
