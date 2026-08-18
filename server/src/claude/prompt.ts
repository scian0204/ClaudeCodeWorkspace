// What a turn actually sends the CLI, as opposed to what the workspace stores as the message.
//
// The stored message is always the plain text the person typed; this adds the context the CLI cannot
// see by itself — who is speaking in a multi-party room, the team chat it should catch up on, where
// the uploaded files landed on disk.
//
// The one exception is a slash command. That is an instruction to the CLI, not a message to the
// model, and the CLI only recognises one when the text STARTS with "/". Every decoration below puts
// something in front of it, so in a room `/clear` arrived as "[name]: /clear" and the model just read
// it as a sentence — it would even answer "Context cleared." while the conversation was untouched.
// Verified against the CLI: `/clear` bare spends 0 input tokens and hands back a NEW session id;
// `[tester]: /clear` spends a model turn, keeps the session id, and re-reads the whole history.
// Every command was affected, not only /clear, and attaching a file broke them in any session kind.
//
// Lives in its own module so it can be checked without loading the DB and the SDK (see prompt.test.ts).
export interface PromptParts {
  text: string;                 // exactly what the person typed, already trimmed
  kind: 'user' | 'room';
  authorName: string;
  contextChat?: { name: string; text: string }[];   // room "include chat" catch-up
  attachments?: { abs: string; isImage: boolean }[];
}

// True when the CLI will treat this as a command rather than a message.
export const isSlashCommand = (text: string): boolean => text.startsWith('/');

export function composePrompt(p: PromptParts): string {
  // A command goes through exactly as typed. Attachments and the chat catch-up are dropped for that
  // turn, which is what the CLI itself does when a command is entered with a file pasted in.
  if (isSlashCommand(p.text)) return p.text;

  let prompt = p.kind === 'room' ? `[${p.authorName}]: ${p.text}` : p.text;
  if (p.contextChat?.length) {
    const convo = p.contextChat.map((c) => `[${c.name}]: ${c.text}`).join('\n');
    prompt = `[이전 대화]\n${convo}\n\n[${p.authorName}]: ${p.text}`;
  }
  // absolute paths so the agent can Read the uploads / pasted screenshots (images render visually)
  if (p.attachments?.length) {
    const list = p.attachments.map((a) => `- ${a.abs}${a.isImage ? ' (이미지)' : ''}`).join('\n');
    prompt = `[첨부 파일]\n${list}\n\n${prompt}`;
  }
  return prompt;
}
