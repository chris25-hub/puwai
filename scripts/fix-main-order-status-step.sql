-- 修复 main_order：status=2（已完成）但 current_step 未到 4 的脏数据，改回 status=1（进行中）
-- 约定：只有 current_step=4 时才算真正完成，status 才应为 2
UPDATE main_order SET status = 1 WHERE status = 2 AND (current_step IS NULL OR current_step < 4);
