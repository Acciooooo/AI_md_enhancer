# AI Markdown Enhancer

[English](./README.md) | **中文**

轻量级 Chrome / Edge（Manifest V3）扩展：在常见 AI 对话网站上叠加 Markdown 编辑器，支持实时预览与 LaTeX 公式。

**支持站点：** [DeepSeek](https://chat.deepseek.com) · [ChatGPT](https://chatgpt.com) · [豆包](https://www.doubao.com) · [Gemini](https://gemini.google.com) · [Kimi](https://www.kimi.com)

## 功能

- **展开按钮** — 在原生输入区旁显示扩展图标
- **Markdown 编辑器** — 高度约为原输入框的约 3 倍，左侧编辑、右侧实时预览
- **LaTeX 公式（KaTeX）** — 支持行内 `$E=mc^2$` 与块级 `$$...$$`，本地打包，不依赖 CDN
- **快捷键（与多数站点默认相反）**
  - `Enter` → 换行
  - `Ctrl+Enter` / `⌘+Enter` → 发送
- **预览防抖** — 停笔约 500 ms 后刷新预览（Markdown + KaTeX）
- **格式工具栏** — 快速插入代码块、表格、标题等片段
- **原生提交同步** — 将内容写回站点原生输入框并触发发送

## 项目结构

```
deepseek-md-enhancer/
├── manifest.json
├── background.js
├── content.js
├── styles.css
├── marked.min.js
├── katex/
│   ├── katex.min.js
│   ├── katex.min.css
│   └── fonts/
├── icons/
├── README.md
└── README_zh.md
```

## 公式示例

```md
行内：$E = mc^2$

块级：
$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$
```

代码块（\`\`\`）内的 `$` 不会被当成公式渲染。

## 安装（Chrome）

1. 打开 `chrome://extensions`
2. 打开右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本仓库中的 `deepseek-md-enhancer` 文件夹
5. 打开 [chat.deepseek.com](https://chat.deepseek.com)、[chatgpt.com](https://chatgpt.com)、[doubao.com](https://www.doubao.com)、[gemini.google.com](https://gemini.google.com) 或 [kimi.com](https://www.kimi.com)，点击输入框旁的展开（⛶）图标即可使用

修改代码后，请在扩展管理页点击 **重新加载**，并硬刷新对应网页。

## 安装（Edge）

1. 打开 `edge://extensions`
2. 打开 **开发人员模式**
3. 点击 **加载解压缩的扩展**
4. 选择 `deepseek-md-enhancer` 文件夹

## 使用方法

1. 点击原生输入框旁的 **展开** 按钮
2. 在左侧编写 Markdown，右侧约 500 ms 后更新预览
3. 可用工具栏插入代码块 / 表格 / 标题
4. 按 **Ctrl+Enter**（或 **⌘+Enter**），或点击编辑器内的 **发送**
5. 发送后或关闭编辑器时，会恢复站点原生输入框

## 技术说明

- **主机权限：** `chat.deepseek.com`、`chatgpt.com`、`chat.openai.com`、`doubao.com`、`gemini.google.com`、`kimi.com`、`kimi.moonshot.cn`
- **站点适配：** `content.js` 内按域名自动选择 adapter（DeepSeek / ChatGPT / 豆包 / Gemini / Kimi；Claude 接口已预留）
- **样式隔离：** 注入 UI 使用 `md-enhancer-*` 类名前缀
- **离线依赖：** `marked.min.js` 与 `katex/` 均本地打包，不加载远程脚本
- **KaTeX 字体：** 运行时用 `chrome.runtime.getURL` 注入 CSS，保证 MV3 下字体路径正确

## 许可证

MIT
