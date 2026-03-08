-- 删除 demand_quote 表中的 demand_id 列，统一用 demand_no 关联 demand
-- 执行前请确保已执行 demand-add-demand-no.sql 且 demand_no 已回填
-- 执行方式：在 MySQL 中 source 本文件

-- 1. 删除依赖 demand_id 的唯一键与索引
ALTER TABLE `demand_quote` DROP INDEX `uk_demand_merchant`;
ALTER TABLE `demand_quote` DROP INDEX `idx_demand`;

-- 2. 删除 demand_id 列
ALTER TABLE `demand_quote` DROP COLUMN `demand_id`;

-- 3. 按 demand_no + merchant_id 保证同一商单下同一商家仅一条报价
ALTER TABLE `demand_quote` ADD UNIQUE KEY `uk_demand_no_merchant` (`demand_no`, `merchant_id`);
