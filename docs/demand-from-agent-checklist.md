# 智能体发单与报价流程 - 实现清单

## 一、需求与表结构摘要

- **demand 表必填**：`user_id`, `category`（1留学 2签证 3移民 4迪拜房产 5日本房产 6海外生活），业务上需要 `detail`（可写「未说明」）、建议有 `category_name`。可选：`tags`, `city`, `budget`, `ai_recommendation`。
- **merchant 表**：`rating`（评分）、`response_rate`（响应率%）用于 AI 报价分析。

## 二、实现清单（逐条检查/修改）

| # | 项 | 说明 | 状态 |
|---|----|------|------|
| 1 | 快捷操作「订单」→「发单」 | 除龙宫自营外，所有智能体快捷操作区第一个按钮改为「发单」；龙宫自营保持「订单」。 | 已完成 |
| 2 | 后端 create-from-agent | 新增 `POST /api/demand/create-from-agent`：入参 `user_id`, `agent_type`, `messages`；从对话中抽取或补全 category/category_name/detail/city/budget/tags，未填写「未说明」；写入 demand 表并返回 demand_id。 | 已完成 |
| 3 | 智能体提示词 | 除龙宫自营外，在 AGENT_PERSONAS 中补充：自然、灵活地收集需求（分类、详细说明、城市、预算等）；收集齐可自动发单或用户点击「发单」；未收集到的字段会记为「未说明」。 | 已完成 |
| 4 | 前端点击「发单」 | 非龙宫自营：点击发单 → 整理当前会话 → 调 create-from-agent → 成功后推送：AI 推荐 + 按 demand.category 匹配的自营产品 + 一条「您是否需要我提供商家参考？」；记录 demand 创建时间。 | 已完成 |
| 5 | 5 分钟与商家参考 | 用户回复「是」等同意时：若距发单不足 5 分钟 → 提示「请您稍等5分钟，商家正在报价中」；满 5 分钟后可展示报价分析。发单 5 分钟后主动推送「您好，商家报价已出，下面为你展示ai报价分析」+ 报价分析卡片。 | 已完成 |
| 6 | 报价分析 | 使用已有 `/api/quote/by-demand`、`/api/quote/ai-summary`；ai-summary 已含 rating、response_rate，前端展示报价分析卡片（含 AI 建议与各商家报价）。 | 已完成 |

## 三、涉及文件

- 前端：`puwai-client/pages/agent-chat/agent-chat.vue`（快捷按钮、发单逻辑、5 分钟与报价展示）
- 后端：`puwai-server/routes/demand.js`（create-from-agent）、`puwai-server/routes/agent.js`（提示词）、`puwai-server/routes/quote.js`（已有 ai-summary，已含评分/响应率）
