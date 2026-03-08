-- 报价表：支持同一需求被多家商家及平台自营同时报价
-- 执行方式：在当前使用的 MySQL 实例中 source 本文件
--   SOURCE /path/to/quote-tables.sql;

CREATE TABLE IF NOT EXISTS `demand_quote` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `demand_no` varchar(32) NOT NULL COMMENT '商单编号，与 demand.demand_no 一致',
  `user_id` varchar(64) NOT NULL COMMENT '需求发起方 uid，如 cus-xxx，冗余便于统计',
  `merchant_id` varchar(64) NOT NULL COMMENT '出价方 uid，mer-xxx；自营方案可用固定 uid 或配合 is_self_operated 标记',
  `is_self_operated` tinyint(1) NOT NULL DEFAULT 0 COMMENT '是否平台自营方案 0-否 1-是',
  `amount` int NOT NULL COMMENT '报价金额，单位：分（人民币）',
  `currency` varchar(8) NOT NULL DEFAULT 'CNY' COMMENT '币种，默认 CNY',
  `summary` varchar(255) DEFAULT NULL COMMENT '一句话报价说明，例：美国硕士申请全程服务',
  `details` text COMMENT '详细服务内容、包含项/不包含项',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '0-待用户选择 1-用户已选中 2-已被拒绝 3-已过期 4-已撤回',
  `valid_until` datetime DEFAULT NULL COMMENT '报价有效期（可选）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_demand_no` (`demand_no`),
  KEY `idx_merchant` (`merchant_id`),
  UNIQUE KEY `uk_demand_no_merchant` (`demand_no`,`merchant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='需求多方报价记录表';

