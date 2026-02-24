// db.js - 数据库连接模块（支持环境变量，便于云托管/容器部署）
const mysql = require('mysql2');

const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'puwai_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});




console.log('--- 数据库配置已加载 ---');

// 关键点：必须导出 promise 版本的接口
module.exports = pool.promise();