import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface ClaudeSession {
  sessionId: string
  slug: string
  lastModified: number
  cwd: string
  fileSize: number
}

// Message types that indicate actual conversation content (not just summaries)
const CONVERSATION_TYPES = ['user', 'assistant']

function encodeProjectPath(projectPath: string): string {
  // Claude encodes paths by:
  // 1. Removing trailing slashes/backslashes
  // 2. Replacing / and \ with -
  // 3. Replacing _ with -
  // 4. Replacing spaces with -
  // 5. Replacing : with - (Windows drive letters)
  // /home/user/my_project/ becomes -home-user-my-project
  // C:\Users\bob\project becomes -C-Users-bob-project
  return projectPath
    .replace(/[/\\]+$/, '')  // Remove trailing slashes/backslashes
    .replace(/[/\\]/g, '-')  // Replace / and \ with -
    .replace(/:/g, '-')      // Replace : with - (Windows drive letters)
    .replace(/_/g, '-')      // Replace _ with -
    .replace(/ /g, '-')      // Replace spaces with -
}

export function discoverSessions(projectPath: string): ClaudeSession[] {
  const claudeDir = join(homedir(), '.claude', 'projects')
  const encodedPath = encodeProjectPath(projectPath)
  const projectSessionsDir = join(claudeDir, encodedPath)

  if (!existsSync(projectSessionsDir)) {
    return []
  }

  const sessions: ClaudeSession[] = []

  try {
    const files = readdirSync(projectSessionsDir)

    for (const file of files) {
      // Session files are UUID.jsonl, skip agent files
      if (!file.endsWith('.jsonl') || file.startsWith('agent-')) {
        continue
      }

      const sessionId = file.replace('.jsonl', '')
      const filePath = join(projectSessionsDir, file)

      try {
        const stat = statSync(filePath)
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n').filter(line => line.trim())

        // Look for slug and check if session has actual conversation
        let slug = sessionId.slice(0, 8)
        let cwd = projectPath
        let hasConversation = false

        for (const line of lines) {
          try {
            const data = JSON.parse(line)
            if (data.slug) slug = data.slug
            if (data.cwd) cwd = data.cwd
            // Check if this is an actual conversation message
            if (data.type && CONVERSATION_TYPES.includes(data.type)) {
              hasConversation = true
            }
          } catch {
            // Skip non-JSON lines
          }
        }

        // Skip sessions without actual conversation content
        if (!hasConversation) {
          continue
        }

        sessions.push({
          sessionId,
          slug,
          lastModified: stat.mtimeMs,
          cwd,
          fileSize: stat.size
        })
      } catch (e) {
        // Skip invalid session files
        console.error(`Failed to parse session ${file}:`, e)
      }
    }
  } catch (e) {
    console.error('Failed to read sessions directory:', e)
  }

  // Sort by most recent first
  sessions.sort((a, b) => b.lastModified - a.lastModified)

  return sessions
}
