// routes/demand.js

const express = require('express');
const router = express.Router();
const db = require('../db');

// 对应前端 survey-result.vue 中的 getMerchants() 接口
router.get('/merchants', async (req, res) => {
    const { demand_id } = req.query;
    try {
        const [demandRows] = await db.query('SELECT category FROM `demand` WHERE id = ?', [demand_id]);
        const categoryId = demandRows && demandRows.length > 0 ? demandRows[0].category : 1;

        const [merchantRows] = await db.query(
            'SELECT id, uid, merchant_name, service_tags, logo, rating, response_rate FROM `merchant` WHERE status = 1 ORDER BY rating DESC LIMIT 5'
        );

        res.json({
            code: 200,
            data: merchantRows || []
        });
    } catch (err) {
        res.status(500).json({ code: 500, error: err.message });
    }
});

module.exports = router;