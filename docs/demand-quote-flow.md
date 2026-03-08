# demand / demand_quote / main_order 流程说明

## 一、整体流程（当前设计）

```
用户发单 → 写入 demand（一条需求，出现在广场）
              ↓
        多个商家可以分别报价 → 每个商家一条 demand_quote（存：哪个商家、多少钱、方案说明）
              ↓
        用户「选方案」= 在多家报价里选一家 → 根据选中的那条 demand_quote 生成 main_order（用户 + 该商家）
              ↓
        用户支付 → main_order.status 0→1（进行中）；按商单编号 demand_no 物理删除 demand_quote、demand
```

---

## 二、订单列表到底「读」的是谁？

**列表里展示的三类数据：**

| 列表里看到的 | 实际读的表 | 说明 |
|-------------|------------|------|
| 进行中/已完成/已取消 的订单 | **main_order** | 一条 main_order 一行 |
| 自营单 | **self_order** | 一条 self_order 一行 |
| 「报价中」、点进去能选方案 | **demand**（不是 demand_quote） | 一条 **demand** 一行 |

也就是说：**订单列表并没有「读 demand_quote 当列表行」**。  
「报价中」那一行对应的是 **一条 demand**：

- 只展示「**该 demand 还没有对应的 main_order**」的 demand（即：用户还没选方案成单）
- **不要求**已有商家报价；没人报价也会显示「报价中」，点进去可能「暂无报价」

所以：

- **读的是 demand**：列表里每一行「报价中」对应的是 **一个 demand_id**（一个需求）。
- **用 demand_quote 做条件**：只显示「已经有人报价」的 demand，避免「没人报价也显示报价中、点进去没方案可选」。

---

## 三、为什么要有 demand_quote 这张表？

因为**一个 demand 可以对应多家商家的多个报价**：

- **demand**：只描述「用户要什么」（一条需求）。
- **demand_quote**：描述「某个商家针对这条需求报了什么价、什么方案」（谁、多少钱、摘要等）。

没有 demand_quote 的话：

- 没法存「商家 A 报 1000、商家 B 报 800」这种多选一的关系；
- 用户「选方案」时也不知道选的是哪家、多少钱、哪个 quote_id，无法生成正确的 main_order。

所以：

- **demand_quote 的存在**：是为了存「每个商家的报价内容」以及「用户选的是哪一条报价」。
- **订单列表**：读的是 **demand**（有报价、未成单的），用 demand_quote 只是过滤「有报价的 demand」，不是把 demand_quote 当列表行。

---

## 四、你说的「无论有没有报价都显示报价中」可以吗？

可以，这是另一种产品设计：

- **当前逻辑**：只显示「已经有至少一条 demand_quote」的 demand 为「报价中」→ 点进去一定有方案可选。
- **你提的逻辑**：只要用户发了 demand、且没有 main_order，就显示「报价中」→ 没人报价时也会显示，点进去可能「暂无报价」。

如果改成后者：

- 列表仍然可以**只读 demand**（不读 demand_quote 当行）：  
  「所有 demand 且该 demand 没有 main_order」都算「报价中」。
- 但 **demand_quote 表仍然需要**：因为「选方案」要选的是某一条**报价**（某家、某金额），选完后根据这条 quote 生成 main_order，所以报价内容必须存在 demand_quote 里。

小结：

- **列表要不要用 demand_quote**：可以不用来做「报价中」的过滤」，改成「没 main_order 的 demand 都显示报价中」。
- **表要不要 demand_quote**：要。选方案、支付、写入 main_order 都依赖「哪条 quote 被选中」。

---

## 五、支付后按商单编号物理删除 demand / demand_quote

当前实现为**物理删除**：

- 支付成功后（confirm-paid）：**先写入 main_order**（status 0→1），再按**商单编号 demand_no** 删除：
  - `DELETE FROM demand_quote WHERE demand_no = ?`
  - `DELETE FROM demand WHERE demand_no = ?`
- **demand** 与 **demand_quote** 两表均有 **demand_no** 字段，发单时生成（格式如 DM+日期+4位序号），同一需求下所有 quote 共用该 demand_no，删除时只删这一单，不会因仅用 user_id 误删多条。

---

## 六、用一句话串起来

- **demand**：用户发的一条需求，带 **demand_no**（商单编号）；订单列表「报价中」= 该 demand 还没有 main_order（不要求已有报价）。
- **demand_quote**：每个商家对某条 demand 的报价，带 **demand_no**；用于「选方案」和生成 main_order；支付后与 demand 一起按 demand_no 物理删除。
- **main_order**：用户选方案并支付后写入；支付成功后按 demand_no 删除对应 demand、demand_quote，列表只保留 main_order 一条。
