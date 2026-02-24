-- 商家资金流水表：按订单号区分流水，同一商家可有多条记录（每次解锁/分佣一条）
-- 移除对 merchant_id 的唯一约束 uk_merchant，避免重复支付同一商家时报 Duplicate entry
-- 执行前请备份数据库。在 MySQL 中执行： source 本文件路径 或 在 Navicat 中运行

USE puwai_db;

ALTER TABLE merchant_wallet DROP INDEX uk_merchant;
