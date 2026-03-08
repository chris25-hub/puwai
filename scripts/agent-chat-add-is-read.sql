-- 智能体未读：为 agent_chat_message 增加 is_read 字段
-- 仅 assistant 消息参与未读统计；用户进入对话后调用 mark-read 将该会话下所有 assistant 标为已读
-- 执行: 在 MySQL 中 source 或导入此文件

ALTER TABLE `agent_chat_message`
ADD COLUMN `is_read` TINYINT NOT NULL DEFAULT 0 COMMENT '0未读 1已读，仅 assistant 消息对用户未读数有效' AFTER `create_time`;
