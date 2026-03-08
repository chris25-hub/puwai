// 平台自营：轮播图与商品从数据库读取，图片地址由接口返回（与头像一致）
const express = require('express');
const router = express.Router();
const db = require('../db');

const BASE_URL = process.env.BASE_URL || process.env.API_BASE_URL || 'http://localhost:3000';

function toFullUrl(imgUrl) {
  if (!imgUrl || typeof imgUrl !== 'string') return '';
  if (imgUrl.startsWith('http://') || imgUrl.startsWith('https://')) return imgUrl;
  const path = imgUrl.startsWith('/') ? imgUrl : '/' + imgUrl;
  return BASE_URL.replace(/\/$/, '') + path;
}

// 轮播图列表
router.get('/banners', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, img_url, sort_order FROM self_banner ORDER BY sort_order ASC, id ASC'
    );
    const list = (rows || []).map((r) => ({
      id: r.id,
      img: toFullUrl(r.img_url),
      img_url: toFullUrl(r.img_url),
      sort_order: r.sort_order
    }));
    res.json({ code: 200, data: list });
  } catch (err) {
    console.error('[self-operated/banners]', err);
    res.status(500).json({ code: 500, error: err.message });
  }
});

// 自营商品列表（可选按 category 筛选；前端「热门」取全部或前 N 条）
router.get('/products', async (req, res) => {
  const { category } = req.query;
  try {
    let sql = 'SELECT id, category, label, price, img_url, sort_order FROM self_product WHERE status = 1';
    const params = [];
    if (category && category !== 'hot') {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' ORDER BY sort_order ASC, id ASC';
    const [rows] = await db.query(sql, params);
    const isPublic = category === 'public';
    const list = (rows || []).map((r) => ({
      id: r.id,
      category: r.category,
      label: r.label,
      price: isPublic || r.category === 'public' ? 0 : r.price,
      img: toFullUrl(r.img_url),
      img_url: toFullUrl(r.img_url),
      sort_order: r.sort_order
    }));
    res.json({ code: 200, data: list });
  } catch (err) {
    console.error('[self-operated/products]', err);
    res.status(500).json({ code: 500, error: err.message });
  }
});

// 单条自营商品（详情页用，含完整图片 URL）
router.get('/product/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ code: 400, msg: '缺少 id' });
  try {
    const [rows] = await db.query(
      'SELECT id, category, label, price, img_url, sort_order FROM self_product WHERE status = 1 AND id = ?',
      [id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ code: 404, msg: '商品不存在' });
    }
    const r = rows[0];
    const isPublic = r.category === 'public';
    res.json({
      code: 200,
      data: {
        id: r.id,
        category: r.category,
        label: r.label,
        name: r.label,
        price: isPublic ? 0 : r.price,
        img: toFullUrl(r.img_url),
        img_url: toFullUrl(r.img_url),
        pic: toFullUrl(r.img_url),
        sort_order: r.sort_order
      }
    });
  } catch (err) {
    console.error('[self-operated/product]', err);
    res.status(500).json({ code: 500, error: err.message });
  }
});

module.exports = router;
