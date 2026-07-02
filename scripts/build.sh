#!/bin/bash

# 微信公众号MCP项目构建脚本
# Build script for WeChat Official Account MCP project

set -e  # 遇到错误时退出

echo "🚀 开始构建微信公众号MCP项目..."
echo "🚀 Starting WeChat Official Account MCP project build..."

# 清理之前的构建
echo "🧹 清理构建目录..."
rm -rf dist

# 检查TypeScript配置
echo "🔍 检查TypeScript配置..."
npm run check

# 运行linting
echo "🔍 运行代码检查..."
echo "🔍 Running code checks..."
echo "⚠️  跳过lint检查以专注打包测试"
echo "⚠️  Skipping lint check to focus on packaging test"

# 构建项目
echo "📦 编译TypeScript代码..."
npm run build:prod

# 验证构建结果
echo "✅ 验证构建结果..."
if [ -f "dist/src/index.js" ] && [ -f "dist/src/worker/index.js" ]; then
    echo "✅ 构建成功！"
    echo "📁 构建文件位置: ./dist/"
    echo "🌐 Workers HTTP入口: ./dist/src/worker/index.js"
    echo "📚 库入口: ./dist/src/index.js"
else
    echo "❌ 构建失败！缺少必要文件"
    exit 1
fi

echo "🎉 构建完成！"
