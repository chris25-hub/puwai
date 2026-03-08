-- 为 demand、demand_quote 增加商单编号 demand_no，便于按单删除且不误删多条
-- 执行方式：在 MySQL 中 source 本文件，或逐条执行
-- 新发单由应用生成 demand_no（格式 DM+日期+4位序号，如 DM202603080001）

-- 1. demand 表增加 demand_no（商单编号，唯一）
ALTER TABLE `demand`
  ADD COLUMN `demand_no` VARCHAR(32) NULL COMMENT '商单编号，与 demand_quote 一致，用于按单删除' AFTER `id`,
  ADD UNIQUE KEY `uk_demand_no` (`demand_no`);

-- 2. 为已有 demand 回填 demand_no（格式 DM+日期+序号，与生成规则一致可再统一）
UPDATE `demand` SET `demand_no` = CONCAT('DM', id, '_', UNIX_TIMESTAMP(COALESCE(create_time, NOW()))) WHERE `demand_no` IS NULL;

-- 3. demand_quote 表增加 demand_no
ALTER TABLE `demand_quote`
  ADD COLUMN `demand_no` VARCHAR(32) NULL COMMENT '商单编号，与 demand.demand_no 一致' AFTER `demand_id`,
  ADD KEY `idx_demand_no` (`demand_no`);

-- 4. 为已有 demand_quote 按 demand_id 回填 demand_no
UPDATE `demand_quote` q
  INNER JOIN `demand` d ON d.id = q.demand_id
  SET q.demand_no = d.demand_no
  WHERE q.demand_no IS NULL;
