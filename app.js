const express = require('express');
const http = require('http');
const bodyParser = require('body-parser');
const cors = require('cors');
const agentRouter = require('./routes/agent');
const runAgentStream = agentRouter.runAgentStream;

// 1. 引入拆分后的路由模块
const commonRouter = require('./routes/common'); 
const orderRouter = require('./routes/order');   
// 【新增】引入问卷路由
const surveyRouter = require('./routes/survey'); 

const demandRouter = require('./routes/demand');

const chatRouter = require('./routes/chat');

const adminRouter = require('./routes/admin');

const merchantRouter = require('./routes/merchant');
const walletRouter = require('./routes/wallet');
const selfOperatedRouter = require('./routes/selfOperated');

const authRouter = require('./routes/auth');
const agentChatRouter = require('./routes/agentChat');
const quoteRouter = require('./routes/quote');

const app = express();
// 云托管/容器会注入 PORT，本地默认 3000
const port = process.env.PORT || 3000;

// 2. 基础配置中间件
app.use(cors()); 
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 3. 静态资源托管
app.use('/uploads', express.static('uploads'));

// 4. 路由分发
app.use('/api/common', commonRouter);
app.use('/api/order', orderRouter);
// 【新增】挂载问卷路由，这样前端访问 /api/survey/questions 才能成功
app.use('/api/survey', surveyRouter);

// 前端 getMerchants() 访问的是 /api/demand/merchants
// 如果你现在没有 demand.js，商家列表就没法显示
app.use('/api/demand', demandRouter);

app.use('/api/chat', chatRouter);

app.use('/api/admin', adminRouter);

app.use('/api/merchant', merchantRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/self-operated', selfOperatedRouter);

app.use('/api/auth', authRouter);
app.use('/api/agent', agentRouter);
app.use('/api/agent-chat', agentChatRouter);
app.use('/api/quote', quoteRouter);

// 可选：把每次请求打到运行日志，便于排查
app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
  });

// 可选：把每次请求打到运行日志，便于排查
app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
  });

// 5. 基础根路径测试
app.get('/api/test', (req, res) => {
    res.json({
        code: 200,
        msg: "后端连接成功！",
        timestamp: new Date().getTime()
    });
});

// 6. HTTP 服务器 + Socket.IO（商家聊天 + 智能体流式）
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: '*' } });

io.on('connection', (socket) => {
    socket.on('join', (sessionId) => {
        socket.join(sessionId);
        console.log(`[socket] 加入房间: ${sessionId}`);
    });
    socket.on('send_msg', (data) => {
        socket.to(data.session_id).emit('receive_msg', data);
    });
    socket.on('agent_stream_start', async (data) => {
        const { agent_type, messages } = data || {};
        if (!agent_type) return socket.emit('agent_stream_done', { reply: '参数错误', product: null, error: '缺少 agent_type' });
        try {
            await runAgentStream(
                agent_type,
                messages || [],
                (chunk) => socket.emit('agent_stream_chunk', chunk),
                (result) => socket.emit('agent_stream_done', result)
            );
        } catch (e) {
            socket.emit('agent_stream_done', { reply: '抱歉，我暂时无法回复，请稍后再试。', product: null, error: e.message });
        }
    });
    socket.on('disconnect', () => {});
});

server.listen(port, () => {
    console.log(`服务器启动成功，监听端口: ${port}`);
    console.log(`- WebSocket (Socket.IO) 已启用：商家聊天 + 智能体流式`);
    console.log(`- 公共接口模块已加载: /api/common`);
    console.log(`- 订单业务模块已加载: /api/order`);
    console.log(`- 问卷业务模块已加载: /api/survey`);
    console.log(`- 需求/商家匹配模块已加载: /api/demand`);
    console.log(`- 智能体对话持久化: /api/agent-chat （有请求时会出现 [agent-chat] 日志）`);
    console.log(`- 多商家报价模块已加载: /api/quote`);
    console.log(`- 平台自营已加载: /api/self-operated`);
});
