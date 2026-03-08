-- 修复：user.avatar_url 字段长度过短导致头像 URL 被截断（如存成 http://localho），广场/个人页头像不显示
-- 上传接口返回完整 URL 如：http://localhost:3000/uploads/xxx.jpg，需至少约 512 字符
ALTER TABLE `user`
  MODIFY COLUMN `avatar_url` varchar(512) DEFAULT NULL COMMENT '用户头像 URL';
