const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" } // 允许跨域
});

// 监听客户端连接
io.on('connection', (socket) => {
  console.log('有新用户连接 WebSocket:', socket.id);

  // 商家或客户进入聊天室
  socket.on('join', (sessionId) => {
    socket.join(sessionId); // 以订单号作为房间号
    console.log(`用户加入房间: ${sessionId}`);
  });

  // 监听发送消息
  socket.on('send_msg', (data) => {
    // 1. 发送给房间内的其他人 (实现实时)
    socket.to(data.session_id).emit('receive_msg', data);

    // 2. 注意：这里依然需要调用你的数据库 INSERT 逻辑，确保消息持久化
    console.log('收到实时消息:', data.content);
  });

  socket.on('disconnect', () => {
    console.log('用户断开连接');
  });
});

http.listen(3000, () => {
  console.log('服务器启动：http://localhost:3000');
});