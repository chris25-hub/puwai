-- 统一钱包流水表：用户端与商家端共用，通过 uid 区分
-- 执行前请备份数据库。在 MySQL 中执行： source 本文件路径
--
-- 流水与总余额约定：
--   - change_amount 可为正（入账）或负（扣款）；总余额统一读 user.balance，且应用层保证 user.balance 不低于 0。
--   - 扣款时：先校验 user.balance >= 扣款金额，再 INSERT 负流水并 UPDATE user SET balance = balance + change_amount。
--
-- type 流水类型说明：
--   unlock    解锁咨询费：用户支付给商家的咨询解锁费用
--   commission 服务分佣：订单完成后平台分给商家的收入
--   grab      抢单入账：商家抢单产生的收入
--   self      自营订单收入：自营业务产生的商家收入
--   recharge  用户充值：用户从平台充值到零钱（需在充值接口中写入此类型流水）
--   withdraw  提现：用户从零钱提现，change_amount 为负值（扣款）
--   wallet_pay 钱包支付：用户使用零钱支付（如自营单），change_amount 为负值
--
USE puwai_db;

CREATE TABLE IF NOT EXISTS `wallet_logs` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `uid` varchar(64) NOT NULL COMMENT '用户或商家 uid，如 cus-xxx / mer-xxx',
  `order_no` varchar(64) DEFAULT NULL COMMENT '关联订单号，可选',
  `change_amount` int NOT NULL DEFAULT 0 COMMENT '变动金额（分），正数入账、负数扣款，流水表允许负值',
  `type` varchar(32) NOT NULL DEFAULT '' COMMENT '流水类型，见下表说明',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_uid` (`uid`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='统一钱包流水（用户+商家）。change_amount 可正可负；总余额以 user.balance 为准且不低于 0。type：unlock/commission/grab/self/recharge 等';

-- 可选：从旧表迁移数据（把 merchant_wallet 的 merchant_id 当作 uid 迁入）
-- INSERT INTO wallet_logs (uid, order_no, change_amount, type, create_time)
-- SELECT merchant_id, order_no, change_amount, type, IFNULL(create_time, NOW()) FROM merchant_wallet;
