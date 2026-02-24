-- 删除 user 表中的 openid 列（当前未使用）
-- 执行前请确认数据库已备份，在 MySQL 中执行： source 本文件路径 或 在 Navicat 中运行

USE puwai_db;

ALTER TABLE `user` DROP COLUMN `openid`;
