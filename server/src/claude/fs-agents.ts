import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../lib/paths.js';

// Filesystem agent definitions (.claude/agents/*.md). The CLI already loads these itself —
// buildOptions ships settingSources ['user','project','local'], so anything under the session
// HOME or the project cwd is invocable via the Task tool without the server's involvement.
// The server's only job here is to ENUMERATE them so the UI can show what exists on disk
// (e.g. agents Claude itself wrote during a session). Read-only: managing them = editing files.

export interface FsAgent {
  name: string;
  description: string;
  model?: string;
  tools?: string;
  source: 'home' | 'project';
  projectId?: string;
  file: string; // relative display path, e.g. '.claude/agents/reviewer.md'
}

// minimal YAML frontmatter reader: only flat `key: value` lines between the leading '---' fences
function frontmatter(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!md.startsWith('---')) return out;
  const end = md.indexOf('\n---', 3);
  if (end < 0) return out;
  for (const line of md.slice(3, end).split('\n')) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line.trim());
    if (m) out[m[1].toLowerCase()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function scanDir(dir: string, source: FsAgent['source'], projectId?: string): FsAgent[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { return []; }
  const out: FsAgent[] = [];
  for (const f of names) {
    try {
      const md = fs.readFileSync(path.join(dir, f), 'utf8');
      const fm = frontmatter(md);
      out.push({
        name: fm.name || f.replace(/\.md$/, ''),
        description: fm.description || '',
        ...(fm.model ? { model: fm.model } : {}),
        ...(fm.tools ? { tools: fm.tools } : {}),
        source, ...(projectId ? { projectId } : {}),
        file: `.claude/agents/${f}`,
      });
    } catch { /* unreadable file — skip */ }
  }
  return out;
}

// Everything on disk that the CLI would load for this user: their HOME agents plus the
// .claude/agents of every project they can see.
export function listFsAgents(userId: string, visibleProjects: { id: string; path: string }[]): FsAgent[] {
  const out = scanDir(path.join(paths.userClaude(userId), 'agents'), 'home');
  for (const p of visibleProjects) out.push(...scanDir(path.join(p.path, '.claude', 'agents'), 'project', p.id));
  return out;
}
