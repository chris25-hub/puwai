# 广场需求卡头像不显示 - 原因与排查

## 现象

- 用户已上传新头像，数据库 `user` 表里 `avatar_url` 为完整 URL，个人页等能正常显示头像。
- 广场页（需求列表）部分需求卡片左侧头像仍是灰色占位，不显示图片。

## 数据流简述

1. **广场列表**：`GET /api/merchant/hall-orders`  
   - 查 `demand` 表并 `LEFT JOIN user u ON …`，取发单人的 `u.avatar_url`。  
   - 返回每条需求时带 `avatar: toFullUrl(item.avatar_url)`（已是 http 则原样返回）。

2. **前端**：`pages/merchant/hall.vue` 用 `item.avatar || '/static/user-avatar.png'` 作为头像 `src`。  
   - 若接口未返回该条需求的 `avatar`（或为 null），则显示占位图。

## 常见原因

1. **JOIN 未匹配到用户**  
   `demand.user_id` 与 `user.uid` 不一致时（如一方带空格、或历史数据格式不同），`LEFT JOIN` 会得不到 `avatar_url`，接口该条返回 `avatar: null`。  
   - **已做处理**：大厅接口中 JOIN 条件改为 `TRIM(COALESCE(d.user_id,'')) = TRIM(COALESCE(u.uid,''))`，减少因空格导致的匹配失败。

2. **头像 URL 不完整**（少见）  
   若 `user.avatar_url` 在库中被截断，前端拿到的 URL 无效，图片会加载失败。  
   - 可检查表中该用户的 `avatar_url` 是否完整；若字段长度不足，可执行 `scripts/fix-user-avatar-url-length.sql` 扩展长度后重新上传头像。

3. **小程序域名与缓存**  
   若在微信小程序中测试，需在后台配置「下载文件域名」包含头像所在域名；并注意下拉刷新或清除缓存后再看广场列表。

## 相关文件

- 广场接口与头像返回：`puwai-server/routes/merchant.js`（`/hall-orders`、`toFullUrl`）
- 广场页展示：`puwai-client/pages/merchant/hall.vue`（`item.avatar`）
- 头像上传与写入：`puwai-client/pages/me/me.vue`、`puwai-server/routes/auth.js`（`update-avatar`）
