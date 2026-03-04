-- 智能体对话独立表（与原有 chat/messages 区分）
-- 执行: 在 MySQL 中 source 或导入此文件

CREATE TABLE IF NOT EXISTS `agent_chat_session` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(64) NOT NULL COMMENT '用户 uid，如 cus-1',
  `agent_type` varchar(32) NOT NULL COMMENT '智能体类型 visa/study/migration 等',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_agent` (`user_id`, `agent_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='智能体对话会话';

CREATE TABLE IF NOT EXISTS `agent_chat_message` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `session_id` int unsigned NOT NULL COMMENT '关联 agent_chat_session.id',
  `role` varchar(20) NOT NULL DEFAULT 'user' COMMENT 'user | assistant',
  `content` text COMMENT '文本内容，推荐卡片时可为空',
  `msg_type` varchar(32) DEFAULT NULL COMMENT '普通为 null，推荐卡片为 recommendation_card',
  `extra` json DEFAULT NULL COMMENT '推荐卡片时存 demand_id, ai_recommendation, merchants',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_session` (`session_id`),
  KEY `idx_session_time` (`session_id`, `create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='智能体对话消息';
