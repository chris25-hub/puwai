// utils/tools.js
const db = require('../db'); // 引入数据库连接

/**
 * 通用单号生成函数：前缀 + 日期 + 4位顺序号
 * @param {String} prefix - 单号前缀，如 'UL' 或 'MAIN'
 * @param {String} tableName - 对应的数据库表名，用于统计当日单量
 */
async function generateOrderNo(prefix, tableName) {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const todayStr = `${year}${month}${day}`; // 格式如 20260221

    try {
        // 查询该表今天已经产生的订单数量
        const sql = `SELECT COUNT(*) as count FROM \`${tableName}\` WHERE DATE(create_time) = CURDATE()`;
        const [rows] = await db.query(sql);
        
        // 生成 4 位顺序号，如 0001, 0002
        const sequence = (rows[0].count + 1).toString().padStart(4, '0'); 
        return `${prefix}${todayStr}${sequence}`;
    } catch (err) {
        console.error('单号生成失败:', err);
        // 如果查询失败，降级使用时间戳，确保业务不中断
        return `${prefix}${todayStr}${Date.now().toString().slice(-4)}`;
    }
}

module.exports = {
    generateOrderNo
};