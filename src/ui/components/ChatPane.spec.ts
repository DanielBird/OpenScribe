import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../providers/errors';
import { setAgentProviderFactoryForTests } from '../../providers/index';
import type { AgentConversation, AgentRunRequest, AgentRunResult } from '../../providers/llm/types';
import type { ChatFile } from '../../domain/chat';
import { FolderError } from '../../storage/folder';
import { CHAT_MESSAGES, useChatStore } from '../../stores/chat';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { COLLEAGUE, makeChatFile, makeProjectFile } from '../../testing/projectSeed';
import { makeProjectSession, makeSessionText } from '../../testing/projectSessions';
import { resetProjectUi, useProjectUi } from '../composables/useProjectUi';
import ChatPane from './ChatPane.vue';

type Run = (req: AgentRunRequest) => Promise<AgentRunResult>;

const usage = { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
const done =
  (text: string): Run =>
  async (req) => {
    req.onEvent({ type: 'text', delta: text });
    return { text, conversation: {} as never, usage, stopped: 'done' };
  };

let runs: Run[] = [];
let held: ((result: AgentRunResult) => void) | null = null;
/** The providers the chat made: which one, and for which model. */
let made: { id: string; model: string }[] = [];
/** A run that streams `text`, then waits for `held` (or an abort). */
const holds =
  (text: string): Run =>
  (req) => {
    req.onEvent({ type: 'text', delta: text });
    return new Promise((resolve, reject) => {
      held = resolve;
      req.signal.addEventListener('abort', () => reject(new ProviderError('aborted', 'Stopped.')));
    });
  };

describe('ChatPane', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setActivePinia(createPinia());
    resetProjectUi();
    runs = [];
    held = null;
    made = [];
    let n = 0;
    setAgentProviderFactoryForTests((id, _key, model) => {
      made.push({ id, model });
      return {
        model,
        run: (req) => runs[n++]!(req),
        resume: () => ({ model }) as unknown as AgentConversation,
      };
    });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const project = useProjectStore();
    const texts = [makeSessionText(1), makeSessionText(2)];
    project.project = makeProjectFile();
    project.sessions = texts.map((t) => makeProjectSession(t));
    project.corpus = texts;
    // The folder: saves work unless a test says otherwise.
    project.saveChat = vi.fn(async (file: ChatFile) => ({
      file,
      name: 'chat.chat.json',
      stat: { size: 1, lastModified: 1 },
    }));
    useSettingsStore().setKey('claude', 'test-key');
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    setAgentProviderFactoryForTests(null);
    vi.unstubAllGlobals();
  });

  const show = () => {
    wrapper = mount(ChatPane, { attachTo: document.body });
    return wrapper;
  };
  const box = () => wrapper!.get('textarea');
  /** A button by its text, or by its label for icon buttons (Send, Stop). */
  const button = (name: string) =>
    wrapper!.findAll('button').find((b) => (b.attributes('aria-label') ?? b.text()) === name);
  const status = () => wrapper!.get('p[role="status"]').text();
  async function ask(question: string): Promise<void> {
    await box().setValue(question);
    await box().trigger('keydown', { key: 'Enter' });
    await flushPromises();
  }

  it('starts empty: the box and Send, no New chat, no notices', () => {
    show();
    expect(button('New chat')).toBeUndefined();
    expect(wrapper!.find('.notice').exists()).toBe(false);
    expect(wrapper!.findAll('.chat-message')).toHaveLength(0);
    expect(status()).toBe('');
  });

  it('asks, says "Answering…" then "Answer ready", and keeps focus in the box', async () => {
    runs = [holds('People charge')];
    show();
    box().element.focus();
    await ask('Who charges?');
    expect(status()).toBe('Answering…');
    expect(button('Stop')).toBeDefined();
    await vi.waitFor(() => expect(wrapper!.text()).toContain('People charge'));
    held!({ text: 'People charge at night.', conversation: {} as never, usage, stopped: 'done' });
    await flushPromises();
    expect(status()).toBe('Answer ready');
    expect(wrapper!.text()).toContain('People charge at night.');
    expect(document.activeElement).toBe(box().element);
    // New chat is in the sidebar's Chats tab (ChatList), not here.
    expect(button('New chat')).toBeUndefined();
  });

  it('Stop ends the answer and says so', async () => {
    runs = [holds('Half')];
    show();
    await ask('Who charges?');
    await button('Stop')!.trigger('click');
    await flushPromises();
    expect(status()).toBe('Stopped');
    expect(wrapper!.get('.answer .status').text()).toBe('Stopped');
    expect(button('Send')).toBeDefined();
  });

  it('shows an error with Try again, which asks again', async () => {
    runs = [
      async () => {
        throw new ProviderError('rate_limit', 'Too many requests. Wait a minute, then try again.');
      },
      done('Now it works.'),
    ];
    show();
    await ask('Who charges?');
    expect(status()).toBe('Too many requests. Wait a minute, then try again.');
    await button('Try again')!.trigger('click');
    await flushPromises();
    expect(wrapper!.text()).toContain('Now it works.');
    expect(wrapper!.findAll('.chat-message')).toHaveLength(2);
  });

  it('with a Gemini model, asks Gemini: the box shows and no notice', async () => {
    const settings = useSettingsStore();
    settings.setKey('gemini', 'gemini-key');
    settings.projectModel = 'gemini-3.8-flash';
    runs = [done('Answered by Gemini.')];
    show();
    expect(wrapper!.find('.notice').exists()).toBe(false);
    await ask('Who charges?');
    expect(wrapper!.text()).toContain('Answered by Gemini.');
    expect(made).toEqual([{ id: 'gemini', model: 'gemini-3.8-flash' }]);
  });

  it('keeps a Claude chat going after a switch to Gemini, until New chat', async () => {
    runs = [done('Answered.'), done('Gemini now.')];
    useSettingsStore().setKey('gemini', 'gemini-key');
    show();
    await ask('Who charges?');
    useSettingsStore().projectModel = 'gemini-4-argon';
    await flushPromises();
    expect(wrapper!.text()).toContain('The model change applies to your next chat.');
    useChatStore().newChat();
    await flushPromises();
    expect(wrapper!.find('.notice').exists()).toBe(false);
    await ask('And now?');
    expect(made.map((m) => m.id)).toEqual(['claude', 'gemini']);
  });

  it('asks for a missing key first, then sends', async () => {
    useSettingsStore().setKey('claude', '');
    runs = [done('Answered.')];
    show();
    await ask('Who charges?');
    expect(wrapper!.findAll('.chat-message')).toHaveLength(0);
    const dialog = wrapper!.get('dialog');
    expect(dialog.text()).toContain('Claude (Anthropic) API key');
    await dialog.get('input').setValue('test-key');
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Ask')!
      .trigger('click');
    await flushPromises();
    expect(wrapper!.text()).toContain('Answered.');
  });

  it('asks for a missing Gemini key with a Gemini model, and names Google', async () => {
    useSettingsStore().projectModel = 'gemini-3.8-flash';
    runs = [done('Answered.')];
    show();
    await ask('Who charges?');
    const dialog = wrapper!.get('dialog');
    expect(dialog.text()).toContain('Gemini (Google) API key');
    expect(dialog.text()).toContain('are sent to Google, with the transcript passages');
    expect(dialog.text()).not.toContain('Anthropic');
    await dialog.get('input').setValue('gemini-key');
    await dialog
      .findAll('button')
      .find((b) => b.text() === 'Ask')!
      .trigger('click');
    await flushPromises();
    expect(wrapper!.text()).toContain('Answered.');
    expect(useSettingsStore().keyFor('gemini')).toBe('gemini-key');
  });

  it("says when the chat couldn't be saved, and Try again saves it", async () => {
    const project = useProjectStore();
    const save = vi.mocked(project.saveChat);
    save.mockRejectedValueOnce(new FolderError('io', 'Failed.'));
    runs = [done('One.')];
    show();
    await ask('Who charges?');
    await vi.waitFor(() => expect(wrapper!.find('[role="alert"]').exists()).toBe(true));
    expect(wrapper!.get('[role="alert"]').text()).toContain(CHAT_MESSAGES.notSaved);

    await wrapper!.get('[role="alert"] button').trigger('click');
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(2);
    expect(wrapper!.find('[role="alert"]').exists()).toBe(false);
  });

  it("says whose chat is open when it's a colleague's", async () => {
    show();
    expect(wrapper!.find('.owner').exists()).toBe(false);
    useChatStore().open({
      file: makeChatFile(),
      name: 'chat.chat.json',
      stat: { size: 1, lastModified: 1 },
    });
    await flushPromises();
    expect(wrapper!.get('.owner').text()).toBe(
      `${COLLEAGUE.name}’s chat. Asking saves a copy as yours.`,
    );
    expect(wrapper!.findAll('.chat-message')).toHaveLength(2);
  });

  it('shows each notice only when it applies', async () => {
    runs = [done('One.')];
    show();
    await ask('Who charges?');
    expect(wrapper!.find('.notice').exists()).toBe(false);

    const project = useProjectStore();
    const three = makeSessionText(3);
    const four = makeSessionText(4);
    project.sessions = [...project.sessions, makeProjectSession(three), makeProjectSession(four)];
    await flushPromises();
    expect(wrapper!.get('.notice').text()).toContain('2 new sessions since this chat started.');

    useSettingsStore().projectModel = 'claude-opus-5-5';
    await flushPromises();
    expect(wrapper!.text()).toContain('The model change applies to your next chat.');

    // New chat in the notice clears the chat, and with it every notice.
    await wrapper!.get('.notice button').trigger('click');
    await flushPromises();
    expect(wrapper!.find('.notice').exists()).toBe(false);
    expect(useChatStore().messages).toHaveLength(0);
  });

  it('says a session in the singular, and notices a long chat', async () => {
    runs = [
      async (req) => {
        req.onEvent({
          type: 'usage',
          usage: { inputTokens: 700_000, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        });
        return { text: 'Ok.', conversation: {} as never, usage, stopped: 'done' };
      },
    ];
    show();
    await ask('Everything?');
    expect(wrapper!.text()).toContain(
      'This chat is long. Type /compact to summarise it, or start a new chat.',
    );
    expect(wrapper!.get('.notice kbd').text()).toBe('/compact');
    const project = useProjectStore();
    project.sessions = [...project.sessions, makeProjectSession(makeSessionText(3))];
    await flushPromises();
    expect(wrapper!.text()).toContain('1 new session since this chat started.');
  });

  describe('/compact', () => {
    const SUMMARY = 'You asked who charges: people charge at night.';

    it('says when there is nothing to compact yet', async () => {
      show();
      await ask('/compact');
      expect(wrapper!.get('.note').text()).toBe(CHAT_MESSAGES.nothingToCompact);
      expect(status()).toBe(CHAT_MESSAGES.nothingToCompact);
      expect(wrapper!.find('.chat-compaction').exists()).toBe(false);
    });

    it('summarises the chat: a divider while it runs, then the summary behind it, and no long notice', async () => {
      runs = [
        async (req) => {
          req.onEvent({
            type: 'usage',
            usage: { ...usage, inputTokens: 700_000 },
          });
          return { text: 'At night.', conversation: {} as never, usage, stopped: 'done' };
        },
        holds(''),
      ];
      show();
      await ask('Who charges?');
      expect(wrapper!.find('.notice').exists()).toBe(true);

      await ask('/compact keep the quotes');
      expect(status()).toBe('Compacting…');
      expect(wrapper!.get('.chat-compaction').attributes('aria-busy')).toBe('true');
      expect(wrapper!.get('.chat-compaction').text()).toBe('Compacting…');
      expect(button('Stop')).toBeDefined();
      expect(wrapper!.findAll('.chat-message')).toHaveLength(2);

      held!({ text: SUMMARY, conversation: {} as never, usage, stopped: 'done' });
      await flushPromises();
      expect(status()).toBe('Chat compacted');
      const divider = wrapper!.get('.chat-compaction');
      expect(divider.attributes('aria-busy')).toBe('false');
      expect(divider.get('summary').text()).toBe('Earlier messages summarised');
      expect(divider.get('details').attributes('open')).toBeUndefined();
      expect(divider.get('.summary').text()).toContain(SUMMARY);
      expect(wrapper!.find('.notice').exists()).toBe(false);
      // The earlier messages stay on screen.
      expect(wrapper!.findAll('.chat-message')).toHaveLength(2);
    });

    it('shows a failed compaction with Try again, which compacts again', async () => {
      runs = [
        done('At night.'),
        async () => {
          throw new ProviderError('server', 'The service is busy. Try again in a minute.');
        },
        done(SUMMARY),
      ];
      show();
      await ask('Who charges?');
      await ask('/compact');
      expect(status()).toBe('The service is busy. Try again in a minute.');
      expect(wrapper!.get('.chat-compaction .error').text()).toContain('The service is busy.');

      await button('Try again')!.trigger('click');
      await flushPromises();
      expect(status()).toBe('Chat compacted');
      expect(wrapper!.findAll('.chat-compaction')).toHaveLength(1);
      expect(wrapper!.get('.chat-compaction .summary').text()).toContain(SUMMARY);
    });

    it('Stop takes the compaction away', async () => {
      runs = [done('At night.'), holds('')];
      show();
      await ask('Who charges?');
      await ask('/compact');
      await button('Stop')!.trigger('click');
      await flushPromises();
      expect(wrapper!.find('.chat-compaction').exists()).toBe(false);
      expect(button('Send')).toBeDefined();
    });
  });

  describe('Chat | Search', () => {
    const search = () => wrapper!.get<HTMLInputElement>('input[type="search"]');
    const pressed = () =>
      wrapper!
        .get('.modes')
        .findAll('button')
        .map((b) => `${b.text()} ${b.attributes('aria-pressed')}`);

    it('opens on Chat, with the toggle under the box', () => {
      show();
      expect(wrapper!.get('.modes').attributes('role')).toBe('group');
      expect(pressed()).toEqual(['Chat true', 'Search false']);
      expect(box().isVisible()).toBe(true);
      expect(search().isVisible()).toBe(false);
      expect(wrapper!.get('h2').text()).toBe('Chat');
    });

    it('Search takes the chat’s place, with focus in its box; Chat brings the chat back', async () => {
      runs = [done('Answered.')];
      show();
      await ask('Who charges?');
      useSettingsStore().projectModel = 'claude-opus-5-5';
      await flushPromises();
      expect(wrapper!.find('.notice').isVisible()).toBe(true);

      await button('Search')!.trigger('click');
      await flushPromises();
      expect(useProjectUi().chatPaneMode).toBe('search');
      expect(pressed()).toEqual(['Chat false', 'Search true']);
      expect(search().isVisible()).toBe(true);
      expect(document.activeElement).toBe(search().element);
      expect(box().isVisible()).toBe(false);
      expect(wrapper!.get('.messages').isVisible()).toBe(false);
      expect(wrapper!.find('.notice').isVisible()).toBe(false);
      expect(wrapper!.get('h2').text()).toBe('Search');

      await button('Chat')!.trigger('click');
      await flushPromises();
      expect(pressed()).toEqual(['Chat true', 'Search false']);
      expect(document.activeElement).toBe(box().element);
      expect(wrapper!.text()).toContain('Answered.');
    });

    it('keeps a search across a switch to Chat and back', async () => {
      show();
      await button('Search')!.trigger('click');
      await search().setValue('charger');
      await search().trigger('keydown', { key: 'Enter' });
      expect(wrapper!.findAll('li.result')).toHaveLength(2);

      await button('Chat')!.trigger('click');
      await button('Search')!.trigger('click');
      await flushPromises();
      expect(search().element.value).toBe('charger');
      expect(wrapper!.findAll('li.result')).toHaveLength(2);
    });

    it('focusInput() focuses the box of the mode shown', async () => {
      show();
      const pane = wrapper!.vm as unknown as { focusInput: () => void };
      pane.focusInput();
      expect(document.activeElement).toBe(box().element);
      useProjectUi().chatPaneMode = 'search';
      await flushPromises();
      pane.focusInput();
      expect(document.activeElement).toBe(search().element);
    });

    it('still announces an answer that ends during a search', async () => {
      runs = [holds('People charge')];
      show();
      await ask('Who charges?');
      await button('Search')!.trigger('click');
      held!({ text: 'People charge at night.', conversation: {} as never, usage, stopped: 'done' });
      await flushPromises();
      expect(status()).toBe('Answer ready');
      expect(wrapper!.get('p[role="status"]').isVisible()).toBe(true);
    });
  });

  it('follows the answer to the bottom, unless the user has scrolled up', async () => {
    runs = [done('One.'), done('Two.')];
    show();
    const list = wrapper!.get('.messages').element as HTMLElement;
    let height = 1000;
    Object.defineProperty(list, 'scrollHeight', { get: () => height });
    Object.defineProperty(list, 'clientHeight', { get: () => 400 });

    await ask('One?');
    expect(list.scrollTop).toBe(1000);

    // Scrolled up: the list stays where the user put it.
    list.scrollTop = 100;
    await wrapper!.get('.messages').trigger('scroll');
    height = 1500;
    useChatStore().messages = [...useChatStore().messages];
    await flushPromises();
    expect(list.scrollTop).toBe(100);

    // Sending follows again.
    height = 2000;
    await ask('Two?');
    expect(list.scrollTop).toBe(2000);
  });
});
