-- 一次性同步：将 merchant.balance 写入对应用户的 user.balance，将 platform_wallet 总额写入 rot 用户
-- 请在执行 add-user-balance.sql 之后、且已有商家/平台数据时执行。执行前请备份。

USE puwai_db;

-- 商家：按 uid 同步 merchant.balance -> user.balance
UPDATE user u
INNER JOIN merchant m ON u.uid = m.uid
SET u.balance = m.balance;

-- 平台(rot)：将 platform_wallet 的 amount 之和写入唯一 rot 用户（若存在）
UPDATE user u
SET u.balance = (SELECT COALESCE(SUM(amount), 0) FROM platform_wallet)
WHERE u.uid LIKE 'rot-%'
LIMIT 1;
