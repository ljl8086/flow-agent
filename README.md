# Flow Agent (⚡ flow-agent)

> A modern, lightweight, non-invasive automation bridge & cinematic pipeline for Google Flow (`flow.google.com`).
> 专为影视工业管线与大模型 Agent 打造的 Google Flow 自动化交互控制与分镜资产同步引擎。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Go Version](https://img.shields.io/badge/Go-1.22+-00ADD8?logo=go)](https://golang.org)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Extension%20MV3-4285F4?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/)

---

## 🌟 核心特性 (Key Features)

- **Zero API Lockout / 零 API 阻断**：绕过已关闭的后端 API-Key 授权，通过 Chrome 原生扩展直接对接已登录的 `flow.google.com` 页面，安全抗风控。
- **Physical Pointer Emulation / 真实物理指针模拟**：彻底解决 Angular / Web Components 框架中合成 `click()` 事件失效的问题，模拟真实人手点击序列（`pointerdown` → `mousedown` → `pointerup` → `mouseup` → `click`）。
- **Smart Viewport & Semantic Anchoring / 智能语义锚定**：精准过滤顶部全局搜索栏，自适应锁定视口底部的创作输入栏。
- **Race-Condition Free / 防双发与空白错误卡片**：按钮点击与回车提交互斥控制，杜绝空提示词导致的生成失败。
- **Standardized Asset Ingestion / 工业化资产落盘与重命名**：一键静默下载生成资源，自动按影视分镜编号（如 `V01_candidate.png`）规范命名存入本地候选池。

---

## 🏗️ 系统架构 (Architecture)

```
[ Antigravity / AI Agent / CLI ]
             │
             ▼ (HTTP POST /v1/dispatch_prompt)
┌──────────────────────────────────────────────┐
│  Flow Agent Daemon (Go Lightweight Server)   │
│  - Port 8001 (WS & REST API)                 │
└──────────────────────────────────────────────┘
             │
             ▼ (WebSocket Bidirectional Bridge)
┌──────────────────────────────────────────────┐
│  Chrome MV3 Extension (Background Worker)    │
└──────────────────────────────────────────────┘
             │
             ▼ (Tabs Messaging)
┌──────────────────────────────────────────────┐
│  Content Script (flow.google.com Active DOM) │
│  - Semantic Input Selection                  │
│  - Physical Pointer Event Dispatch           │
│  - Silent Download & Asset Tagging           │
└──────────────────────────────────────────────┘
```

---

## 🚀 快速开始 (Quick Start)

### 1. 编译并启动本地桥接服务 (Daemon)

```bash
cd cmd
go build -o ../bin/flow-agent main.go
../bin/flow-agent --port 8001
```

### 2. 加载 Chrome 扩展

1. 打开 Chrome 浏览器，访问 `chrome://extensions`；
2. 开启右上角 **开发者模式 (Developer mode)**；
3. 点击 **加载已解压的扩展程序 (Load unpacked)**，选择本项目下的 `extension/` 目录；
4. 打开并在 Chrome 中登录 [flow.google.com](https://flow.google.com)。

### 3. 执行分镜提示词自动化注入

```bash
# 提交分镜生图任务（遵循 Title: VXX。[提示词] 规范控制 Google Flow 节点命名）
python3 pipeline/pipeline.py --shot-id "V01" --agent --prompt "特写镜头，神农在晨光中仔细端详手中的一株散发微光的金色草药..."

# 显式使用 Title 格式的完整史诗分镜
python3 pipeline/pipeline.py --shot-id "V01" --agent --prompt "Title: V01。[特写镜头，神农在晨光中仔细端详草药...【视听底座】35mm电影宽银幕镜头质感...]"

# 仅填入提示词供肉眼预览（不自动点击生成）
python3 pipeline/pipeline.py --shot-id "V01" --prompt "测试文字" --no-submit

# 静默下载生成好的媒体并指定文件名
python3 pipeline/pipeline.py --shot-id "V01" --download-url "https://..." --output-name "V01-0.jpeg"
```

### 4. 命名规范与画布管理 (Canvas Naming Standard)

Google Flow 画布支持通过开头声明 **`Title: <镜头编号>。[<分镜详细提示词>]`** 精确控制生成卡片节点名称，实现自动化流水线节点与影视工程资产（如 `V01-0.jpeg`）的 1:1 严格对齐：
- **格式标准**：`Title: VXX。[主体动作、构图机位、视听底座、角色资产与负向约束]`
- **自动化支持**：`pipeline.py` 在开启 `--agent` 时会自动检测并规范化为 `Title: VXX。[...]` 结构。

---

## 📄 开源许可证 (License)

本项目采用 [MIT License](LICENSE) 开源。
Copyright (c) 2026 ljl8086. All rights reserved.
