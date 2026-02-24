const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

// 1. 引入拆分后的路由模块
const commonRouter = require('./routes/common'); 
const orderRouter = require('./routes/order');   
// 【新增】引入问卷路由
const surveyRouter = require('./routes/survey'); 

const demandRouter = require('./routes/demand');

const chatRouter = require('./routes/chat');

const adminRouter = require('./routes/admin');

const merchantRouter = require('./routes/merchant');

const authRouter = require('./routes/auth');

const app = express();
const port = 3000;

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

app.use('/api/auth', authRouter);

// 5. 基础根路径测试
app.get('/api/test', (req, res) => {
    res.json({
        code: 200,
        msg: "后端连接成功！",
        timestamp: new Date().getTime()
    });
});

// 6. 启动服务器
app.listen(port, () => {
    console.log(`服务器启动成功，监听端口: ${port}`);
    console.log(`- 公共接口模块已加载: /api/common`);
    console.log(`- 订单业务模块已加载: /api/order`);
    console.log(`- 问卷业务模块已加载: /api/survey`);
    console.log(`- 需求/商家匹配模块已加载: /api/demand`);
});