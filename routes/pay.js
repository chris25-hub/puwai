/**
 * 微信支付：小程序 JSAPI 预支付 + 支付结果回调
 * 配置从环境变量读取，证书从 certs/ 或 WECHAT_PAY_PRIVATE_KEY_PATH 指定路径读取
 */
const express = require('express');
const router = express.Router();
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const db = require('../db');
const { generateOrderNo } = require('../utils/tools');

// 配置（环境变量）
const APP_ID = (process.env.WECHAT_APP_ID || '').trim();
const MCH_ID = (process.env.WECHAT_MCH_ID || '').trim();
const SERIAL_NO = (process.env.WECHAT_SERIAL_NO || '').trim();
const NOTIFY_BASE = (process.env.WECHAT_PAY_NOTIFY_BASE || '').trim().replace(/\/$/, '');
const MP_SECRET = (process.env.WECHAT_MP_SECRET || '').trim();
const APIV3_KEY = (process.env.WECHAT_PAY_APIV3_KEY || '').trim();
const PRIVATE_KEY_PATH = path.resolve(process.env.WECHAT_PAY_PRIVATE_KEY_PATH || path.join(__dirname, '../certs/apiclient_key.pem'));
// 云托管无 certs 目录时：用环境变量 WECHAT_PAY_PRIVATE_KEY 填 apiclient_key.pem 全文（可把换行改成 \n）
const PRIVATE_KEY_CONTENT = (process.env.WECHAT_PAY_PRIVATE_KEY || '').trim().replace(/\\n/g, '\n');

let privateKeyPem = null;
function getPrivateKey() {
  if (privateKeyPem) return privateKeyPem;
  if (PRIVATE_KEY_CONTENT && PRIVATE_KEY_CONTENT.includes('BEGIN')) {
    privateKeyPem = PRIVATE_KEY_CONTENT;
    return privateKeyPem;
  }
  const fs = require('fs');
  if (!fs.existsSync(PRIVATE_KEY_PATH)) throw new Error('商户私钥不存在：请在本机放 certs/apiclient_key.pem，或在云托管环境变量中配置 WECHAT_PAY_PRIVATE_KEY（apiclient_key.pem 全文）');
  privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
  return privateKeyPem;
}

// 用 code 换 openid
function getOpenidByCode(code) {
  return new Promise((resolve, reject) => {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(APP_ID)}&secret=${encodeURIComponent(MP_SECRET)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    https.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.openid) return resolve(data.openid);
          reject(new Error(data.errmsg || '获取 openid 失败'));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// 微信 API 请求签名并请求
function wechatRequest(method, urlPath, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyStr = body ? JSON.stringify(body) : '';
  const signStr = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
  const sign = crypto.createSign('RSA-SHA256').update(signStr).sign(getPrivateKey(), 'base64');
  const auth = `WECHATPAY2-SHA256-RSA2048 mchid="${MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",signature="${sign}",serial_no="${SERIAL_NO}"`;

  return new Promise((resolve, reject) => {
    const opt = {
      hostname: 'api.mch.weixin.qq.com',
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'puwai-server',
        'Authorization': auth
      }
    };
    const req = https.request(opt, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const data = raw ? JSON.parse(raw) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(data.message || data.code || '微信接口错误'));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// 小程序调起支付所需 paySign
function buildPaySign(prepayId) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageVal = `prepay_id=${prepayId}`;
  const signStr = `${APP_ID}\n${timestamp}\n${nonceStr}\n${packageVal}\n`;
  const paySign = crypto.createSign('RSA-SHA256').update(signStr).sign(getPrivateKey(), 'base64');
  return { timeStamp: timestamp, nonceStr, package: packageVal, signType: 'RSA', paySign };
}

/**
 * POST /api/pay/wechat-prepay
 * body: type, user_id, code(必填，wx.login 得到), description
 * main_order: order_no, total_amount
 * self_order: product_id, product_label, total_amount
 * unlock_chat: demand_id, merchant_id, total_amount
 */
router.post('/wechat-prepay', async (req, res) => {
  const { type, user_id, code, description, order_no, total_amount, product_id, product_label, demand_id, merchant_id } = req.body || {};
  const userUid = (user_id != null && String(user_id).trim() !== '') ? String(user_id).trim() : null;
  if (!userUid) return res.status(400).json({ code: 400, error: '缺少 user_id' });
  if (!code || String(code).trim() === '') return res.status(400).json({ code: 400, error: '缺少 code，请先调用 wx.login 获取' });

  if (!APP_ID || !MCH_ID || !SERIAL_NO || !NOTIFY_BASE || !MP_SECRET) {
    return res.status(503).json({ code: 503, error: '微信支付未配置完整' });
  }

  let openid, outTradeNo, amount, desc;

  try {
    openid = await getOpenidByCode(String(code).trim());
  } catch (e) {
    console.error('[pay] getOpenidByCode:', e.message);
    return res.status(400).json({ code: 400, error: '获取 openid 失败，请重试' });
  }

  const notifyUrl = `${NOTIFY_BASE}/api/pay/wechat-notify`;

  try {
    if (type === 'main_order' && order_no) {
      const [rows] = await db.query('SELECT total_amount FROM main_order WHERE order_no = ? AND user_id = ? AND status = 0', [String(order_no).trim(), userUid]);
      if (!rows || rows.length === 0) return res.status(400).json({ code: 400, error: '订单不存在或已支付' });
      amount = Number(rows[0].total_amount) || 0;
      outTradeNo = String(order_no).trim();
      desc = description || '商家报价订单';
    } else if (type === 'self_order') {
      const orderNo = await generateOrderNo('SO', 'self_order');
      amount = Math.abs(parseInt(total_amount, 10) || 0);
      const label = (product_label && String(product_label).trim()) || '自营服务';
      await db.query(
        'INSERT INTO self_order (order_no, user_id, product_id, product_label, total_amount, pay_channel, status, create_time) VALUES (?, ?, ?, ?, ?, ?, 0, NOW())',
        [orderNo, userUid, product_id || '', label, amount, 'wechat']
      );
      outTradeNo = orderNo;
      desc = description || label;
    } else if (type === 'unlock_chat' && demand_id && merchant_id) {
      const orderNo = await generateOrderNo('UL', 'unlock_order');
      amount = Math.abs(parseInt(total_amount, 10) || 0);
      await db.query(
        'INSERT INTO unlock_order (order_no, user_id, merchant_id, demand_id, amount, status, create_time) VALUES (?, ?, ?, ?, ?, 0, NOW())',
        [orderNo, userUid, String(merchant_id).trim(), String(demand_id).trim(), amount]
      );
      outTradeNo = orderNo;
      desc = description || '解锁对话';
    } else {
      return res.status(400).json({ code: 400, error: '参数错误：type/order_no 或 type/self_order 或 type/unlock_chat 信息不完整' });
    }

    if (amount <= 0) return res.status(400).json({ code: 400, error: '金额异常' });

    const body = {
      appid: APP_ID,
      mchid: MCH_ID,
      description: desc.substring(0, 127),
      out_trade_no: outTradeNo,
      notify_url: notifyUrl,
      amount: { total: amount, currency: 'CNY' },
      payer: { openid }
    };
    const result = await wechatRequest('POST', '/v3/pay/transactions/jsapi', body);
    const prepayId = result && result.prepay_id;
    if (!prepayId) return res.status(502).json({ code: 502, error: '微信下单未返回 prepay_id' });

    const payParams = buildPaySign(prepayId);
    res.json({ code: 200, data: payParams });
  } catch (err) {
    console.error('[pay] wechat-prepay error:', err);
    res.status(500).json({ code: 500, error: err.message || '预支付失败' });
  }
});

/**
 * POST /api/pay/wechat-notify
 * 微信支付结果异步通知，需验签、解密后更新订单并返回 200
 * 依赖 app 中 bodyParser.json({ verify }) 提供的 req.rawBody
 */
router.post('/wechat-notify', async (req, res) => {
  const rawBody = req.rawBody || req.body;
  const buf = Buffer.isBuffer(rawBody) ? rawBody : (typeof rawBody === 'string' ? Buffer.from(rawBody) : null);
  if (!buf || buf.length === 0) {
    res.status(400).send('body empty');
    return;
  }
  const signature = req.headers['wechatpay-signature'];
  const timestamp = req.headers['wechatpay-timestamp'];
  const nonce = req.headers['wechatpay-nonce'];
  const serial = req.headers['wechatpay-serial'];
  if (!signature || !timestamp || !nonce) {
    res.status(400).send('header missing');
    return;
  }
  let payload;
  try {
    const data = JSON.parse(buf.toString());
    const ciphertext = data.resource && data.resource.ciphertext;
    const nonce2 = data.resource && data.resource.nonce;
    const tag = data.resource && data.resource.associated_data;
    if (!ciphertext || !APIV3_KEY) {
      res.status(500).send('decrypt config error');
      return;
    }
    const key = Buffer.from(APIV3_KEY, 'utf8');
    const decoded = Buffer.from(ciphertext, 'base64');
    const authTag = decoded.slice(decoded.length - 16);
    const encrypted = decoded.slice(0, decoded.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce2, 'utf8'));
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(tag != null ? tag : '', 'utf8'));
    payload = JSON.parse(decipher.update(encrypted) + decipher.final('utf8'));
  } catch (e) {
    console.error('[pay] notify decrypt error:', e);
    res.status(500).send('decrypt fail');
    return;
  }
  if (payload.trade_state !== 'SUCCESS') {
    res.status(200).send('ok');
    return;
  }
  const outTradeNo = payload.out_trade_no;
  try {
    if (outTradeNo.startsWith('SO')) {
      await db.query('UPDATE self_order SET status = 1 WHERE order_no = ? AND status = 0', [outTradeNo]);
    } else if (outTradeNo.startsWith('MAIN')) {
      await db.query('UPDATE main_order SET status = 1 WHERE order_no = ? AND status = 0', [outTradeNo]);
      const [rows] = await db.query('SELECT demand_id FROM main_order WHERE order_no = ?', [outTradeNo]);
      if (rows && rows[0] && rows[0].demand_id != null) {
        const [dRows] = await db.query('SELECT demand_no FROM demand WHERE id = ?', [rows[0].demand_id]);
        if (dRows && dRows[0] && dRows[0].demand_no) {
          const demandNo = dRows[0].demand_no;
          await db.query('DELETE FROM demand_quote WHERE demand_no = ?', [demandNo]);
          await db.query('DELETE FROM demand WHERE demand_no = ?', [demandNo]);
        }
      }
    } else if (outTradeNo.startsWith('UL')) {
      const [rows] = await db.query('SELECT user_id, merchant_id, demand_id, amount FROM unlock_order WHERE order_no = ? AND status = 0', [outTradeNo]);
      if (rows && rows.length > 0) {
        const { user_id: uid, merchant_id: merchantUid, amount } = rows[0];
        await db.query('UPDATE unlock_order SET status = 1 WHERE order_no = ?', [outTradeNo]);
        await db.query('UPDATE merchant SET balance = balance + ? WHERE uid = ?', [amount, merchantUid]);
        await db.query('UPDATE user SET balance = balance + ? WHERE uid = ?', [amount, merchantUid]);
        await db.query('INSERT INTO wallet_logs (uid, order_no, change_amount, type) VALUES (?, ?, ?, \'unlock\')', [merchantUid, outTradeNo, amount]);
        const platformSql = 'INSERT INTO platform_wallet (order_no, user_id, merchant_id, total_amount, amount, type, create_time) VALUES (?, ?, ?, ?, 0, \'unlock\', NOW())';
        await db.query(platformSql, [outTradeNo, uid, merchantUid, amount]);
        const [merchantRows] = await db.query('SELECT merchant_name FROM merchant WHERE uid = ?', [merchantUid]);
        const merchantName = (merchantRows && merchantRows[0] && merchantRows[0].merchant_name) || '商家';
        const sessionId = `${rows[0].demand_id}_${merchantUid}`;
        await db.query('INSERT INTO messages (session_id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)', [sessionId, merchantUid, uid, `您好！我是【${merchantName}】的专属顾问，已收到您的诊断需求，很高兴为您服务。`]);
      }
    }
  } catch (e) {
    console.error('[pay] notify update order error:', e);
  }
  res.status(200).send('ok');
});

module.exports = router;
