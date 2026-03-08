-- 根据 15201965602 商家，新增 17521262220 的 user + merchant 记录
-- 执行前请确保 merchant / user 表已存在

-- 1. user 表：与 15201965602 同结构（role=merchant，余额可设为 0）
INSERT INTO `user` (`uid`, `role`, `nickname`, `avatar_url`, `balance`, `phone`, `is_real_name`, `status`, `create_time`, `update_time`)
VALUES ('17521262220', 'merchant', NULL, NULL, 0, '17521262220', 0, 1, NOW(), NOW())
ON DUPLICATE KEY UPDATE `update_time` = NOW();

-- 2. merchant 表：uid 对应上述用户，其余字段与常见商家一致
INSERT INTO `merchant` (`uid`, `role`, `merchant_name`, `logo`, `service_tags`, `rating`, `response_rate`, `balance`, `status`, `reject_reason`, `create_time`)
VALUES ('17521262220', 'merchant', '商家17521262220', NULL, NULL, 5.0, 100, 0, 0, NULL, NOW())
ON DUPLICATE KEY UPDATE `merchant_name` = VALUES(`merchant_name`);
