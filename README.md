# Simple Claude GUI

A desktop app for managing multiple [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions across different projects in a single window.

Stop juggling terminal tabs. Simple Claude GUI lets you run Claude Code on multiple projects simultaneously, instantly resume past conversations, and switch between sessions with a click. Paste images directly, track tasks with Beads integration, and customize with 9 themes.

![GitHub Release](https://img.shields.io/github/v/release/DonutsDelivery/simple-claude-gui)
![Downloads](https://img.shields.io/github/downloads/DonutsDelivery/simple-claude-gui/total)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![AUR](https://img.shields.io/aur/version/simple-claude-gui)

![Screenshot](assets/screenshot.png)

## Features

### Session Management
- **Tabbed Interface** - Multiple Claude sessions open simultaneously
- **Session Resume** - Pick up conversations where you left off
- **Session Discovery** - Auto-finds existing sessions from `~/.claude`
- **Tiled View** - See multiple terminals side-by-side (toggle with grid button)
- **Workspace Persistence** - Restores your open tabs and layout on restart

### Project Organization
- **Project Sidebar** - Save and organize project folders for quick access
- **Create Projects** - Make new project directories without leaving the app
- **Session History** - Expand projects to see all past sessions with timestamps
- **Project Icons** - Custom emoji icons for each project
- **Run Executable** - Launch your app directly from the sidebar

### Terminal
- **Image & File Paste** - Paste screenshots and copied files with Ctrl+V
- **Drag & Drop** - Drop files from file manager into terminal
- **Smart Ctrl+C** - Copies selection if text selected, sends SIGINT otherwise
- **Right-Click Menu** - Copy selection or paste with right-click
- **Full Color Support** - xterm-256color with 10,000 line scrollback

### Customization
- **9 Color Themes** - Including RGB Gamer mode with animations
- **Settings Panel** - Configure themes and default project directory
- **Window Memory** - Remembers size and position

<p>
<img src="assets/settings.png" width="400" alt="Settings">
<img src="assets/screenshot-gamer.png" width="400" alt="RGB Gamer Theme">
</p>

### Task Tracking (Beads Integration)
- **Task Panel** - Manage project tasks without leaving the app
- **Create Tasks** - Add tasks with title, description, and priority
- **Track Progress** - Start, complete, and delete tasks
- **Auto-Refresh** - Task list updates automatically

### Setup & Updates
- **Auto-Install Dependencies** - Installs Claude Code, Node.js, Git if missing
- **Auto Updates** - Downloads and installs updates automatically
- **Cross-Platform** - Windows, macOS (Apple Silicon), and Linux

## Installation

### Windows / macOS / Linux

Download from [GitHub Releases](https://github.com/DonutsDelivery/simple-claude-gui/releases):

| Platform | Download |
|----------|----------|
| Windows | `.exe` installer or portable |
| macOS | `.dmg` (Apple Silicon) |
| Linux | `.AppImage` or `.deb` |

### Arch Linux (AUR)

```bash
yay -S simple-claude-gui
```

### From Source

```bash
git clone https://github.com/DonutsDelivery/simple-claude-gui.git
cd simple-claude-gui
npm install
npm run dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+C` | Copy selection (or SIGINT if no selection) |
| `Ctrl+V` | Paste text, files, or images |
| `Ctrl+Shift+C` | Copy from terminal |
| `Ctrl+Shift+V` | Paste to terminal |
| `F12` | Toggle DevTools |

## License

MIT
