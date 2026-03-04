# 智能体对话持久化 - 数据流说明

- **后端**：`puwai-server/routes/agentChat.js`（挂载在 `/api/agent-chat`）
- **前端**：`puwai-client/pages/agent-chat/agent-chat.vue`（`ensureAgentSession`、`loadAgentHistory`、`saveAgentMessage`）
- **建表**：`puwai-server/scripts/agent-chat-tables.sql`

## 1. 数据是怎么写的（代码流程）

- **进入智能体对话页**（带 `agent_type`，无 `session_id`）时：
  1. `ensureAgentSession()`  
     - 请求：`POST /api/agent-chat/session`，body: `{ user_id, agent_type }`（user_id 来自 `uni.getStorageSync('userUID')`）  
     - 后端：在表 `agent_chat_session` 里按 `user_id + agent_type` 查找，没有则 INSERT，返回 `session_id`  
     - 前端：把返回的 `session_id` 存到 `this.agentSessionId`
  2. `loadAgentHistory()`  
     - 请求：`GET /api/agent-chat/messages?session_id=xxx`  
     - 后端：从表 `agent_chat_message` 按 `session_id` 查消息列表，按时间正序返回  
     - 前端：用返回结果赋给 `this.messages` 展示历史
  3. 若没有历史且没有 `demand_id`：调用 `sendAgentGreeting()` 发欢迎语，并在前端调用 `saveAgentMessage({ role: 'assistant', content: reply })` 把这条写入数据库。

- **用户发一条消息**时：
  1. 前端先把这条消息 push 到 `this.messages`，并立刻调用  
     `saveAgentMessage({ role: 'user', content: text })`  
     - 请求：`POST /api/agent-chat/message`，body: `{ session_id, role: 'user', content }`  
     - 后端：`INSERT INTO agent_chat_message (session_id, role, content, ...)` 写入一条记录  
  2. 再调 `POST /api/agent/chat` 拿 AI 回复，把回复 push 到界面后，再调用  
     `saveAgentMessage({ role: 'assistant', content: reply })`  
     - 同上，只是 `role: 'assistant'`，把 AI 回复写入 `agent_chat_message`。

- **问卷完成后带 demand_id 回对话页**时：
  - 会先执行上面的 1、2（拿到/创建 session、拉历史），再请求 `/api/survey/result` 拿到推荐结果，在前端 push 一条推荐卡片，并调用  
    `saveAgentMessage({ role: 'assistant', msg_type: 'recommendation_card', extra: { demand_id, ai_recommendation, merchants } })`  
  - 请求：`POST /api/agent-chat/message`，body 里带 `msg_type` 和 `extra`，后端同样 INSERT 到 `agent_chat_message`。

**结论**：所有“写入数据库”都是通过上述三个接口完成的：`POST /session`（建会话）、`POST /message`（每条消息一条 INSERT）。如果数据库里没有任何数据，说明这些请求要么没发出去，要么失败（4xx/5xx），要么连错了后端/没建表。

---

## 2. 如何排查“没有历史、数据库没写入、没有报错”

1. **确认表已建**  
   在 MySQL 里执行：  
   `puwai-server/scripts/agent-chat-tables.sql`  
   确认存在表：`agent_chat_session`、`agent_chat_message`。

2. **看后端日志**  
   运行 `node app.js` 的终端里，每次请求会打印：  
   - `[agent-chat] POST /session`、`GET /messages`、`POST /message`  
   - 若报错会打印 `[agent-chat] error: ...`  
   若这里都看不到请求，说明请求没打到这台后端（例如小程序走了云托管，没走本机）。

3. **看前端请求与错误提示**  
   - 开发者工具 → Network：看是否有  
     `POST .../api/agent-chat/session`、  
     `GET .../api/agent-chat/messages?session_id=...`、  
     `POST .../api/agent-chat/message`  
   - 若接口失败，页面会弹出 Toast 提示（例如“会话创建失败”“历史加载失败”“消息保存失败”），可据此判断是会话、拉历史还是写消息出错。

4. **小程序走的是哪台后端**  
   - 若编译为 **微信小程序**，且用了 `wx.cloud.callContainer`，请求会发到 **微信云托管**，不会发到本机 `localhost`。  
   - 需在云托管里部署当前后端代码，并在云托管所在环境执行上面的建表 SQL，数据库才会有数据。

---

## 3. 接口与表对应关系

| 前端操作           | 请求                               | 后端表/操作                    |
|--------------------|------------------------------------|---------------------------------|
| 进入智能体对话     | POST /api/agent-chat/session       | agent_chat_session 查/插        |
| 拉历史             | GET /api/agent-chat/messages       | agent_chat_message 按 session 查 |
| 发消息 / AI 回复 / 推荐卡片 | POST /api/agent-chat/message | agent_chat_message INSERT 一条  |
