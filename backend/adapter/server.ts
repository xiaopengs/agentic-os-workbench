/**
 * 本地 / 自托管后端入口（完全不依赖 EdgeOne 平台）
 *
 * 用法：
 *   npx tsx backend/adapter/server.ts
 *   PORT=8787 LOCAL_STORE=file npx tsx backend/adapter/server.ts
 *
 * 环境变量：
 *   PORT              监听端口（默认 8787）
 *   LOCAL_STORE=file  使用本地 JSON 文件持久化（默认 .data/store.json）
 *   LOCAL_STORE_PATH  自定义数据文件路径
 *   JWT_SECRET         JWT 签名密钥（非生产未设置时使用固定开发值并告警）
 */
import { startServer } from './node';

startServer();
