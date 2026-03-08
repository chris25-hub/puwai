-- 在 user 表增加余额字段：顾客/商家/平台的总余额统一从 user.balance 读取，单位：分，最低为 0
-- 执行前请备份。MySQL: source 本文件路径

USE puwai_db;

ALTER TABLE `user`
  ADD COLUMN `balance` int NOT NULL DEFAULT 0 COMMENT '账户零钱余额（分），仅非负，顾客/商家/平台统一读此字段' AFTER `avatar_url`;
