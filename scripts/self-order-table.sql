-- 平台自营订单表：用户购买自营商品后生成，用于「我的订单」与进度查询
-- 执行前请备份。MySQL: source 本文件路径

USE puwai_db;

CREATE TABLE IF NOT EXISTS `self_order` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `order_no` varchar(64) NOT NULL COMMENT '订单号，如 SO202503060001',
  `user_id` varchar(64) NOT NULL COMMENT '用户 uid',
  `product_id` int unsigned NOT NULL COMMENT 'self_product.id',
  `product_label` varchar(128) NOT NULL DEFAULT '' COMMENT '商品名称，冗余便于列表展示',
  `total_amount` int NOT NULL DEFAULT 0 COMMENT '实付金额（分）',
  `status` tinyint NOT NULL DEFAULT 1 COMMENT '0=待支付 1=进行中 2=已完成 3=已取消',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台自营订单';
