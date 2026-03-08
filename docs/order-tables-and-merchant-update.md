# 订单相关表梳理 & 商家端更新哪张表

## 一、五张表各自是干什么的

| 表名 | 含义 | 谁创建/谁用 | 商家端要不要更新 |
|------|------|-------------|------------------|
| **demand** | 广场需求（用户发的一条需求） | 用户发单/智能体发单 → 写入；大厅展示、报价、抢单时读 | **不更新**（只有抢单/选报价时后端自动改 status 0→1→2） |
| **demand_quote** | 某条需求下的商家报价 | 商家对某 demand 提交报价 → 写入；用户选报价时更新 status | **不更新**（选报价时后端把选中改为 1、其余改为 2） |
| **main_order** | **客户与商家之间的正式订单** | 用户选报价成单 / 商家抢单 → 写入；订单列表、进度、分佣都看这张表 | **要更新**（见下） |
| **self_order** | 平台自营单（用户买自营商品） | 用户买自营商品支付后 → 写入 | **商家不碰**（平台自营，无商家） |
| **unlock_order** | 解锁对话（用户付费解锁与某商家的私聊） | 用户付费解锁会话 → 写入；只用于能否聊天，不算「订单进度」 | **不更新**（一次性解锁，没有「提交资料/完成订单」的状态） |

结论：**商家端要更新的「商家和客户的单子」只对应一张表：`main_order`。**

---

## 二、表与表之间的关系（简化）

```
用户发单 → demand（一条需求）
    ↓
商家报价 → demand_quote（一个 demand 可有多条 quote）
    ↓
用户选一家报价 或 商家抢单 → 生成 main_order（一个 demand 最多对应一家商家的一个 main_order）
    ↓
商家/用户后续操作（支付、提交资料、完成）→ 只改 main_order 的 status / current_step
```

- **self_order**：用户直接买自营商品，和 demand / main_order 无关。
- **unlock_order**：用户只为「能和某商家聊天」付费，没有订单进度，不做状态流转。

---

## 三、商家端更新「订单」发生在哪一张表？→ 只有 main_order

所有「用户提交资料」「完成订单」等状态，都是**客户和商家之间的订单**，对应表：**main_order**。

### 1. main_order 里和「状态」有关的字段（约定）

- **status**（订单大状态，与表注释一致）
  - **0** = 待支付（报价中）
  - **1** = 进行中
  - **2** = 已完成（**仅当商家把 current_step 更新为 4 时由后端写入**）
  - **3** = 已取消/退款
- **current_step**（进度阶段：收材料 → 审核中 → 递交中 → 已完成）
  - 1、2、3、4；**4 = 最后一步「已完成」**，会触发分佣，并同时把 status 设为 2。

**用户端展示规则**：只有 `current_step = 4` 时才显示「已完成」；若 `status = 2` 但 `current_step ≠ 4`，仍显示「进行中」。

### 2. 商家端目前两个更新接口（都在改 main_order）

| 接口 | 作用 | 改的是哪张表、哪个字段 |
|------|------|------------------------|
| **POST /api/merchant/update-order-status** | 商家点击「更新状态」推进大状态 | **main_order**，`status = status + 1`（0→1→2→3）；前端「已完成」以 current_step=4 为准 |
| **POST /api/order/update-step** | 商家更新进度（收材料/审核中/递交中/已完成）；**step=4 时**会分佣**并**把 status 设为 2 | **main_order**，`current_step = ?`，step=4 时同时 `status = 2` |

也就是说：**商家端更新订单 = 只动 main_order 表**；「完成订单」应由 **update-step 把 step 推到 4**，而不是单靠 update-order-status。

---

## 四、其他表商家端不用动

- **demand**：只在「抢单」时由后端把该需求的 status 从 0 改为 1；用户「选报价成单」时由后端改为 2。商家端没有「更新需求状态」的入口。
- **demand_quote**：选报价时后端会更新选中/拒绝，商家端只读或用于展示，不在这里更新「订单状态」。
- **self_order**：自营单，和商家无关，商家端不更新。
- **unlock_order**：只表示「已解锁对话」，没有订单进度，不需要商家更新状态。

---

## 五、选方案并支付之后列表为什么只显示一条？

- 用户选方案并支付后：会**写入 main_order**（create-from-quote + confirm-paid），并更新 demand.status=2、demand_quote 选中/拒绝状态。
- **不物理删除** demand / demand_quote（保留审计与关联）；订单列表接口 **my-list** 里「报价中」来自：有 demand_quote 且**该 demand 尚未存在 main_order** 的需求。一旦该 demand 已有 main_order，就不会再出现在「报价中」列表里，所以用户端只会看到一条「进行中」的 main_order。

若同一需求在列表里出现两条（一条报价中、一条进行中），请检查该 demand 的 main_order 是否已正确写入且 `user_id` 与 demand 的 `user_id` 一致（含空格/TRIM）。

---

## 六、修复历史数据（status=2 但 current_step≠4）

若库里已有「status=2 已完成但 current_step=1 收材料」的脏数据，可执行一次：

```sql
-- 将「未真正完成」的订单从 2 改回 1（进行中），仅当 current_step < 4 时
UPDATE main_order SET status = 1 WHERE status = 2 AND (current_step IS NULL OR current_step < 4);
```

---

## 七、总结

- **商家端要更新的「商家和客户的单子」= 只更新 `main_order` 表。**
- 用户提交资料、完成订单：用 **update-step** 推进 current_step，**step=4 时**后端会自动把 status 设为 2（已完成）并分佣。
- 「报价中」那条来自 demand_quote（有报价且该 demand 尚无 main_order）；选方案并支付后只显示 main_order，不删 demand/demand_quote。
