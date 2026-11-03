import { describe, expect, it } from 'vitest';
import { memoryFolder } from '../testing/memoryFolder';
import { chatFileText, chatPath, makeChatFile, withFutureChatFields } from '../testing/projectSeed';
import { chatFileNameOf, listChatFiles, readChatFile, writeChatFile } from './chatFiles';

describe('chat files', () => {
  it('writes a new chat under its start and id, and reads it back', async () => {
    const folder = memoryFolder();
    const file = makeChatFile();
    const { name, stat } = await writeChatFile(folder, file, null);
    expect(name).toBe('2026-10-20-1402--3f9a1c2e.chat.json');
    expect(chatPath(file)).toBe(`chats/${name}`);
    expect(folder.text(`chats/${name}`)).toBe(chatFileText(file));
    await expect(readChatFile(folder, name)).resolves.toEqual({ file, stat });
  });

  it('reads a compacted chat back, and rejects a compaction without its summary', async () => {
    const compacted = makeChatFile();
    compacted.messages.push({
      role: 'compaction',
      id: 'c1',
      at: '2026-10-20T14:04:00.000Z',
      summary: 'They charge overnight.',
      focus: 'charging',
      costUsd: 0.05,
      model: 'claude-sonnet-5-5',
    });
    const folder = memoryFolder();
    const { name, stat } = await writeChatFile(folder, compacted, null);
    await expect(readChatFile(folder, name)).resolves.toEqual({ file: compacted, stat });

    const broken = JSON.parse(chatFileText(compacted)) as { messages: Record<string, unknown>[] };
    delete broken.messages[2]!.summary;
    folder.put(`chats/${name}`, JSON.stringify(broken));
    await expect(readChatFile(folder, name)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('keeps fields a newer build added, at every level (D38)', async () => {
    const base = makeChatFile();
    base.messages.push({
      role: 'compaction',
      id: 'c1',
      at: '2026-10-20T14:04:00.000Z',
      summary: 'They charge overnight.',
      focus: '',
      costUsd: null,
      model: 'claude-sonnet-5-5',
    });
    const file = withFutureChatFields(base);
    const folder = memoryFolder('P', { [chatPath(file)]: chatFileText(file) });
    const { file: read } = await readChatFile(folder, chatFileNameOf(file));
    expect(read).toEqual(file);
  });

  it('keeps the name when the chat goes on', async () => {
    const folder = memoryFolder();
    const file = makeChatFile();
    const first = await writeChatFile(folder, file, null);
    const longer = makeChatFile({ updatedAt: '2026-10-21T08:00:00.000Z', title: 'Another title' });
    const second = await writeChatFile(folder, longer, first.stat);
    expect(second.name).toBe(first.name);
    expect(chatFileNameOf(longer)).toBe(first.name);
  });

  it('refuses a new chat whose file exists, and a write over a file that changed', async () => {
    const file = makeChatFile();
    const folder = memoryFolder('P', { [chatPath(file)]: chatFileText(file) });
    await expect(writeChatFile(folder, file, null)).rejects.toMatchObject({ kind: 'changed' });

    const { stat } = await readChatFile(folder, chatFileNameOf(file));
    folder.put(chatPath(file), chatFileText(makeChatFile({ title: 'Changed elsewhere' })));
    await expect(writeChatFile(folder, file, stat)).rejects.toMatchObject({ kind: 'changed' });
    expect(folder.writes).toEqual([]);
  });

  it('reports a file that is not a chat, or not JSON, as invalid', async () => {
    const folder = memoryFolder('P', {
      'chats/a.chat.json': '{"kind":"describe.chat","schemaVersion":2}',
      'chats/b.chat.json': 'not json',
    });
    await expect(readChatFile(folder, 'a.chat.json')).rejects.toMatchObject({
      kind: 'invalid',
      path: 'chats/a.chat.json',
    });
    await expect(readChatFile(folder, 'b.chat.json')).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('lists chat files and conflict copies, sorted, ignoring everything else', async () => {
    const folder = memoryFolder('P', {
      'chats/b.chat.json': '{}',
      'chats/a.chat-LAPTOP-1.json': '{}',
      'chats/a.chat.json': '{}',
      'chats/a.chat.json.crswap': '',
      'chats/notes.txt': '',
      'chats/sub/c.chat.json': '{}',
    });
    const files = await listChatFiles(folder);
    expect(files.map((f) => [f.name, f.base, f.conflictCopy])).toEqual([
      ['a.chat-LAPTOP-1.json', 'a', true],
      ['a.chat.json', 'a', false],
      ['b.chat.json', 'b', false],
    ]);
    expect(files[0]!.stat).toEqual(await folder.stat('chats/a.chat-LAPTOP-1.json'));
  });

  it('lists none when the project has no chats folder yet', async () => {
    await expect(listChatFiles(memoryFolder())).resolves.toEqual([]);
  });
});
