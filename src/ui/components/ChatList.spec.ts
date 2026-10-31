import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatFile } from '../../domain/chat';
import { formatDateTime } from '../../domain/transcript';
import { useChatStore } from '../../stores/chat';
import { useProjectStore, type ProjectChat } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { COLLEAGUE, makeChatFile, makeProjectFile } from '../../testing/projectSeed';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import ChatList from './ChatList.vue';

const entry = (n: number, overrides: Partial<ChatFile> = {}): ProjectChat => ({
  file: makeChatFile({
    id: `chat-${n}`,
    title: `Chat ${n}`,
    updatedAt: `2026-10-2${n}T10:00:00.000Z`,
    ...overrides,
  }),
  name: `chat-${n}.chat.json`,
  stat: { size: n, lastModified: n },
});

describe('ChatList', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    resetProjectUi();
    useProjectStore().project = makeProjectFile();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  function withChats(...chats: ProjectChat[]) {
    const project = useProjectStore();
    project.chats = chats;
    project.chatsLoaded = true;
    return project;
  }

  const options = () => wrapper!.findAll('[role="option"]');

  it('shows each chat with its title, who saved it and when, in the given order', () => {
    const me = useSettingsStore().chatAuthor;
    withChats(entry(3, { author: { ...me } }), entry(2));
    wrapper = mount(ChatList);
    expect(wrapper.get('h2').text()).toBe('Chats 2');
    expect(wrapper.get('h2').classes()).toContain('visually-hidden');
    expect(options().map((o) => o.get('.title').text())).toEqual(['Chat 3', 'Chat 2']);
    expect(options().map((o) => o.get('.who').text())).toEqual(['You', COLLEAGUE.name]);
    const when = formatDateTime('2026-10-22T10:00:00.000Z');
    expect(options()[1]!.get('.meta .when').text()).toBe(when);
    expect(options()[1]!.get('.meta .who').text()).toBe(COLLEAGUE.name);
    expect(options()[1]!.get('.meta').attributes('aria-hidden')).toBe('true');
    expect(options()[1]!.get('.visually-hidden').text()).toBe(`${COLLEAGUE.name}, ${when}.`);
  });

  it('says there are none only once the chats have been read', async () => {
    const project = useProjectStore();
    wrapper = mount(ChatList);
    expect(wrapper.find('.empty').exists()).toBe(false);
    project.chatsLoaded = true;
    await flushPromises();
    expect(wrapper.get('.empty').text()).toBe('No chats yet.');
  });

  it('opens a chat by click or by Enter after the arrow keys, closing a summary and a search', async () => {
    withChats(entry(3), entry(2), entry(1));
    const ui = useProjectUi();
    const chat = useChatStore();
    ui.selected = 'session-1';
    ui.chatPaneMode = 'search';
    wrapper = mount(ChatList, { attachTo: document.body });
    expect(options().map((o) => o.attributes('tabindex'))).toEqual(['0', '-1', '-1']);

    await options()[1]!.trigger('click');
    expect(chat.chatId).toBe('chat-2');
    expect(ui.selected).toBeNull();
    expect(ui.chatPaneMode).toBe('chat');
    expect(options()[1]!.attributes('aria-selected')).toBe('true');
    expect(options()[1]!.classes()).toContain('selected');

    await options()[1]!.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(document.activeElement).toBe(options()[2]!.element);
    await options()[2]!.trigger('keydown', { key: 'Enter' });
    expect(chat.chatId).toBe('chat-1');
    expect(chat.messages).toHaveLength(2);
  });

  it('New chat clears the open chat, closing a summary and a search, and says so', async () => {
    withChats(entry(1));
    const ui = useProjectUi();
    const chat = useChatStore();
    wrapper = mount(ChatList);
    await options()[0]!.trigger('click');
    expect(chat.chatId).toBe('chat-1');
    ui.selected = 'session-1';
    ui.chatPaneMode = 'search';

    await wrapper.get('button.new-chat').trigger('click');
    expect(wrapper.get('button.new-chat').text()).toBe('New chat');
    expect(chat.chatId).toBeNull();
    expect(chat.messages).toHaveLength(0);
    expect(ui.selected).toBeNull();
    expect(ui.chatPaneMode).toBe('chat');
    expect(wrapper.emitted('new')).toHaveLength(1);
    expect(options()[0]!.attributes('aria-selected')).toBe('false');
  });

  it("lists chat files that couldn't be read", () => {
    const project = withChats(entry(1));
    project.chatProblems = [
      { file: 'broken.chat.json', message: "DeScribe can't read this file." },
    ];
    wrapper = mount(ChatList);
    expect(wrapper.get('.problems summary').text()).toBe("1 file couldn't be read");
    expect(wrapper.get('.problems li').text()).toBe(
      "broken.chat.json: DeScribe can't read this file.",
    );
  });
});
