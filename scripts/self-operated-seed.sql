-- 平台自营：插入 3 条轮播 + 7 条商品（需先执行 self-operated-tables.sql 建表）
-- 图片路径按你当前目录：uploads/elf-operated/banners/ 和 uploads/elf-operated/products/
-- 若你用的是 self-operated 文件夹，把下面路径里的 elf-operated 改成 self-operated 即可
-- 执行：mysql -u root -p puwai_db < 本文件

USE puwai_db;

-- 3 条轮播（请确保 uploads/elf-operated/banners/ 下有 banner-1.jpg, banner-2.jpg, banner-3.jpg）
INSERT INTO `self_banner` (`img_url`, `sort_order`) VALUES
('/uploads/elf-operated/banners/banner-1.jpg', 0),
('/uploads/elf-operated/banners/banner-2.jpg', 1),
('/uploads/elf-operated/banners/banner-3.jpg', 2);

-- 7 条自营商品（请确保 uploads/elf-operated/products/ 下有对应图片，或执行后到库里改 img_url）
INSERT INTO `self_product` (`category`, `label`, `price`, `img_url`, `sort_order`, `status`) VALUES
('visa', '签证-美国签证', 800, '/uploads/elf-operated/products/visa-us.jpg', 0, 1),
('visa', '签证-申根多国', 699, '/uploads/elf-operated/products/visa-schengen.jpg', 1, 1),
('study', '留学-英国硕士申请', 12800, '/uploads/elf-operated/products/study-uk.jpg', 0, 1),
('study', '留学-日本语言学校', 6800, '/uploads/elf-operated/products/study-jp.jpg', 1, 1),
('life', '海外生活-就医陪同', 1200, '/uploads/elf-operated/products/life-medical.jpg', 0, 1),
('estate', '房产-迪拜看房团', 4999, '/uploads/elf-operated/products/estate-dubai.jpg', 0, 1),
('public', '公益-华人互助讲座', 0, '/uploads/elf-operated/products/public-event.jpg', 0, 1);
