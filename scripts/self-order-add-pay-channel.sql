-- 自营订单增加支付渠道字段，用于区分微信/支付宝/钱包/模拟支付
-- 执行：source 本文件路径 或 在 MySQL 中执行下面一行

USE puwai_db;

ALTER TABLE self_order
  ADD COLUMN pay_channel varchar(32) DEFAULT NULL COMMENT 'wechat/alipay/wallet/mock' AFTER total_amount;
