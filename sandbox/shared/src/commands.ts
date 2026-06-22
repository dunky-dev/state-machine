import type { Command } from './types'

/** A small, realistic command set for the demo — the kind every ⌘K palette has. */
export const DEMO_COMMANDS: Command[] = [
  { id: 'home', label: 'Go to Dashboard', hint: 'g h', group: 'Navigation' },
  { id: 'issues', label: 'Go to Issues', hint: 'g i', group: 'Navigation' },
  { id: 'prs', label: 'Go to Pull Requests', hint: 'g p', group: 'Navigation' },
  { id: 'settings', label: 'Open Settings', hint: ',', group: 'Navigation' },
  { id: 'new-issue', label: 'Create New Issue', hint: 'c i', group: 'Actions' },
  { id: 'new-pr', label: 'Open a Pull Request', hint: 'c p', group: 'Actions' },
  { id: 'invite', label: 'Invite Teammate', group: 'Actions' },
  { id: 'theme-light', label: 'Theme: Light', group: 'Preferences' },
  { id: 'theme-dark', label: 'Theme: Dark', group: 'Preferences' },
  { id: 'theme-system', label: 'Theme: System', group: 'Preferences' },
  { id: 'logout', label: 'Log Out', group: 'Account' },
]

/**
 * Substrate-agnostic fuzzy filter: a subsequence match on the lowercased label,
 * so "gpr" matches "Go to Pull Requests". Empty query returns everything. Kept
 * deliberately tiny — the point is the machine + bindings, not the matcher.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands
  return commands.filter(c => isSubsequence(q, c.label.toLowerCase()))
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++
  }
  return i === needle.length
}
