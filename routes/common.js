const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 1. 配置存储引擎
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// 2. 定义上传接口
router.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ code: 400, msg: '未选择文件' });
    
    const fileUrl = `http://localhost:3000/uploads/${req.file.filename}`;
    res.json({
        code: 200,
        msg: '上传成功',
        url: fileUrl
    });
});

module.exports = router;