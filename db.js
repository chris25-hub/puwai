// db.js - 数据库连接模块
const mysql = require('mysql2');

// 1. 创建连接池 (比单独连接更稳定，适合小程序高并发)
const pool = mysql.createPool({
    host: 'localhost',      // 数据库地址 (本地)
    user: 'root',           // 数据库用户名 (请确认您的账号)
    password: 'lbc200425@',       // 数据库密码 (请确认您的密码)
    database: 'puwai_db',   // 刚才在 Navicat 里建的数据库名
    waitForConnections: true,
    connectionLimit: 10,    // 最多同时允许10个连接
    queueLimit: 0
});




console.log('--- 数据库配置已加载 ---');

// 关键点：必须导出 promise 版本的接口
module.exports = pool.promise();