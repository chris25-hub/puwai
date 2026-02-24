# 普外后端 Node 服务 - 微信云托管 / 通用 Docker 构建
# 使用 Node 18 LTS
FROM node:18-alpine

# 工作目录
WORKDIR /app

# 先只复制依赖文件，利用镜像缓存
COPY package.json package-lock.json* ./

# 安装生产依赖（无 devDependencies 时等同于 npm install）
RUN npm install --production --no-optional

# 复制应用代码
COPY . .

# 上传目录（若不存在可留空，运行时挂载或云存储）
RUN mkdir -p uploads

# 暴露端口（微信云托管会注入 PORT，见 app.js）
EXPOSE 3000

# 启动命令
CMD ["node", "app.js"]
