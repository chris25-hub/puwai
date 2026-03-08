# UID 与角色逻辑调整说明

## 新逻辑（已上线）

- **user.uid**：仅存手机号（如 `15201965602`），不再使用 `cus-`、`mer-` 前缀。
- **user.role**：`customer` | `merchant` | `admin`，由本字段区分身份。
- **登录**：按手机号查 user，不存在则新增一条、`role = 'customer'`；存在则直接返回该条（含当前 `role`）。
- **商家身份**：用户完成「商家入驻」并提交资质后，在 merchant 表插入/更新记录（`merchant.uid = 用户手机号`）；**管理员审核通过**时，除更新 `merchant.status = 1` 外，会执行 `UPDATE user SET role = 'merchant' WHERE uid = ?`，实现角色升级。

## 旧数据迁移（可选）

若库里已有带前缀的 uid（如 `cus-15201965602`、`mer-15201965602`），需要你自行做一次性迁移：

1. **合并同一手机号的多条 user**  
   同一手机号只保留一条 user，`uid` 改为纯手机号；若其中任一条为 `merchant` 或 `admin`，则保留的这条 `role` 设为 `merchant` 或 `admin`。

2. **merchant 表**  
   将 `merchant.uid` 从 `mer-手机号` 改为纯手机号，与 user 表一致。

3. **其它表**  
   凡存 `user_id` / `merchant_id` 的地方，若当前存的是带前缀的 uid，改为存纯手机号（或保持与 user/merchant 表一致即可）。

迁移完成后再用新逻辑登录，同一手机号只会对应一条 user，商家用该手机号登录即可正常出价。
