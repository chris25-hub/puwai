-- 平台自营：轮播图与商品表，图片等数据存库由接口返回（与头像一致）
-- 执行前请备份。MySQL: source 本文件路径

USE puwai_db;

-- 轮播图
CREATE TABLE IF NOT EXISTS `self_banner` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `img_url` varchar(512) NOT NULL DEFAULT '' COMMENT '图片地址：相对路径如 /uploads/xxx.jpg 或完整 URL',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '排序，越小越靠前',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台自营轮播图';

-- 自营商品（按分类 Tab 展示）
CREATE TABLE IF NOT EXISTS `self_product` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `category` varchar(32) NOT NULL DEFAULT 'hot' COMMENT '分类：hot/visa/study/life/estate/public',
  `label` varchar(128) NOT NULL DEFAULT '' COMMENT '展示名称，如 签证-美国签证',
  `price` int NOT NULL DEFAULT 0 COMMENT '价格（元），0 表示免费/公益',
  `img_url` varchar(512) NOT NULL DEFAULT '' COMMENT '商品图：相对路径或完整 URL',
  `sort_order` int NOT NULL DEFAULT 0 COMMENT '排序',
  `status` tinyint NOT NULL DEFAULT 1 COMMENT '1=上架 0=下架',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category_status` (`category`, `status`),
  KEY `idx_sort` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='平台自营商品';

-- 可选：插入默认轮播占位（上传后把 img_url 改为 /uploads/xxx）
-- INSERT INTO self_banner (img_url, sort_order) VALUES ('/uploads/banner1.jpg', 0), ('/uploads/banner2.jpg', 1), ('/uploads/banner3.jpg', 2);

-- 可选：插入默认商品（上传后把 img_url 改为实际地址）
-- INSERT INTO self_product (category, label, price, img_url, sort_order) VALUES
-- ('visa', '签证-美国签证', 800, '/uploads/visa-us.jpg', 0),
-- ('visa', '签证-申根多国', 699, '/uploads/visa-schengen.jpg', 1),
-- ('study', '留学-英国硕士申请', 12800, '/uploads/study-uk.jpg', 0),
-- ('study', '留学-日本语言学校', 6800, '/uploads/study-jp.jpg', 1),
-- ('life', '海外生活-就医陪同', 1200, '/uploads/life-medical.jpg', 0),
-- ('estate', '房产-迪拜看房团', 4999, '/uploads/estate-dubai.jpg', 0),
-- ('public', '公益-华人互助讲座', 0, '/uploads/public-event.jpg', 0);
